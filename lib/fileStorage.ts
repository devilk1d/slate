export type StorageBackendKind = "OPFS" | "IndexedDB";

interface TransferMetaRecord {
  fileId: string;
  receivedChunks: number[];
}

const OPFS_DIR_NAME = "slate-transfers";
const IDB_NAME = "slate-ephemeral-storage";
const IDB_VERSION = 1;
const IDB_CHUNKS_STORE = "chunks";
const IDB_META_STORE = "meta";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_CHUNKS_STORE)) {
        db.createObjectStore(IDB_CHUNKS_STORE);
      }
      if (!db.objectStoreNames.contains(IDB_META_STORE)) {
        db.createObjectStore(IDB_META_STORE, { keyPath: "fileId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function idbTransactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed."));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted."));
  });
}

class TransferFileStorage {
  private backendPromise: Promise<StorageBackendKind> | null = null;
  private opfsDirPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private activeWriters = new Map<string, FileSystemWritableFileStream>();
  private receivedSets = new Map<string, Set<number>>();
  private writeChains = new Map<string, Promise<void>>();

  public async getBackendKind(): Promise<StorageBackendKind> {
    if (!this.backendPromise) {
      this.backendPromise = this.detectBackend();
    }
    return this.backendPromise;
  }

  public async initIncoming(fileId: string): Promise<StorageBackendKind> {
    const backend = await this.getBackendKind();
    if (!this.receivedSets.has(fileId)) {
      const persisted = await this.loadMetaReceived(fileId);
      this.receivedSets.set(fileId, new Set(persisted));
    }

    if (backend === "OPFS" && !this.activeWriters.has(fileId)) {
      const dir = await this.getOpfsDirectory();
      const fileHandle = await dir.getFileHandle(`${fileId}.bin`, { create: true });
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      this.activeWriters.set(fileId, writable);
    }

    return backend;
  }

  public async writeChunk(
    fileId: string,
    chunkIndex: number,
    byteOffset: number,
    data: Uint8Array
  ): Promise<void> {
    const previous = this.writeChains.get(fileId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const backend = await this.initIncoming(fileId);
      if (backend === "OPFS") {
        const writer = this.activeWriters.get(fileId);
        if (!writer) throw new Error("OPFS writer handle is missing.");
        const copy = new Uint8Array(data);
        await writer.write({ type: "write", position: byteOffset, data: copy });
      } else {
        const db = await this.getDb();
        const tx = db.transaction(IDB_CHUNKS_STORE, "readwrite");
        tx.objectStore(IDB_CHUNKS_STORE).put(
          data.slice().buffer,
          `${fileId}:${chunkIndex}`
        );
        await idbTransactionDone(tx);
      }

      const set = this.receivedSets.get(fileId) ?? new Set<number>();
      set.add(chunkIndex);
      this.receivedSets.set(fileId, set);

      // Persist chunk indices periodically (every 16 chunks) to minimize IDB overhead.
      if (set.size % 16 === 0) {
        await this.persistMetaReceived(fileId, set);
      }
    });

    this.writeChains.set(
      fileId,
      next.catch(() => {})
    );
    await next;
  }

  public async flushMeta(fileId: string): Promise<void> {
    const set = this.receivedSets.get(fileId);
    if (set) {
      await this.persistMetaReceived(fileId, set);
    }
  }

  public async getReceivedChunks(fileId: string): Promise<number[]> {
    const inMemory = this.receivedSets.get(fileId);
    if (inMemory) return Array.from(inMemory);
    return this.loadMetaReceived(fileId);
  }

  public async finalizeIncomingFile(
    fileId: string,
    totalChunks: number,
    mimeType: string
  ): Promise<Blob> {
    const pending = this.writeChains.get(fileId);
    if (pending) await pending;

    const backend = await this.getBackendKind();

    if (backend === "OPFS") {
      const writer = this.activeWriters.get(fileId);
      if (writer) {
        await writer.close();
        this.activeWriters.delete(fileId);
      }
      const dir = await this.getOpfsDirectory();
      if (totalChunks === 0) {
        return new Blob([], { type: mimeType || "application/octet-stream" });
      }
      const handle = await dir.getFileHandle(`${fileId}.bin`, { create: false });
      const file = await handle.getFile();
      return mimeType ? file.slice(0, file.size, mimeType) : file;
    }

    const db = await this.getDb();
    const parts: ArrayBuffer[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const tx = db.transaction(IDB_CHUNKS_STORE, "readonly");
      const chunk = (await idbRequest(
        tx.objectStore(IDB_CHUNKS_STORE).get(`${fileId}:${i}`)
      )) as ArrayBuffer | undefined;
      if (!chunk) {
        throw new Error(`Missing chunk ${i} during assembly.`);
      }
      parts.push(chunk);
    }
    return new Blob(parts, { type: mimeType || "application/octet-stream" });
  }

  public triggerBrowserDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 15_000);
  }

  public async purgeTransfer(fileId: string, totalChunks = 0): Promise<void> {
    this.receivedSets.delete(fileId);
    this.writeChains.delete(fileId);

    const writer = this.activeWriters.get(fileId);
    if (writer) {
      this.activeWriters.delete(fileId);
      try {
        await writer.abort();
      } catch {
        // Ignore already-closed stream errors.
      }
    }

    try {
      const backend = await this.getBackendKind();
      if (backend === "OPFS") {
        const dir = await this.getOpfsDirectory();
        await dir.removeEntry(`${fileId}.bin`).catch(() => {});
      } else if (totalChunks > 0) {
        const db = await this.getDb();
        const tx = db.transaction(IDB_CHUNKS_STORE, "readwrite");
        const store = tx.objectStore(IDB_CHUNKS_STORE);
        for (let i = 0; i < totalChunks; i++) {
          store.delete(`${fileId}:${i}`);
        }
        await idbTransactionDone(tx);
      }

      const db = await this.getDb();
      const metaTx = db.transaction(IDB_META_STORE, "readwrite");
      metaTx.objectStore(IDB_META_STORE).delete(fileId);
      await idbTransactionDone(metaTx);
    } catch {
      // Ignore cleanup errors on already-purged entries.
    }
  }

  private async detectBackend(): Promise<StorageBackendKind> {
    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== "function"
    ) {
      return "IndexedDB";
    }

    try {
      const dir = await this.getOpfsDirectory();
      const probe = await dir.getFileHandle("__slate_probe__", { create: true });
      const supportsWritable = typeof probe.createWritable === "function";
      await dir.removeEntry("__slate_probe__").catch(() => {});
      return supportsWritable ? "OPFS" : "IndexedDB";
    } catch {
      return "IndexedDB";
    }
  }

  private async getOpfsDirectory(): Promise<FileSystemDirectoryHandle> {
    if (!this.opfsDirPromise) {
      this.opfsDirPromise = navigator.storage
        .getDirectory()
        .then((root) => root.getDirectoryHandle(OPFS_DIR_NAME, { create: true }));
    }
    return this.opfsDirPromise;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase();
    }
    return this.dbPromise;
  }

  private async loadMetaReceived(fileId: string): Promise<number[]> {
    try {
      const db = await this.getDb();
      const tx = db.transaction(IDB_META_STORE, "readonly");
      const record = (await idbRequest(
        tx.objectStore(IDB_META_STORE).get(fileId)
      )) as TransferMetaRecord | undefined;
      return record?.receivedChunks ?? [];
    } catch {
      return [];
    }
  }

  private async persistMetaReceived(
    fileId: string,
    set: Set<number>
  ): Promise<void> {
    try {
      const db = await this.getDb();
      const tx = db.transaction(IDB_META_STORE, "readwrite");
      const record: TransferMetaRecord = {
        fileId,
        receivedChunks: Array.from(set),
      };
      tx.objectStore(IDB_META_STORE).put(record);
      await idbTransactionDone(tx);
    } catch {
      // Non-fatal if metadata checkpoint fails.
    }
  }
}

export const fileStorage = new TransferFileStorage();
