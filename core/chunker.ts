export const CHUNK_SIZE = 64 * 1024;
const UUID_BYTE_LENGTH = 36;
const FRAME_HEADER_BYTES = UUID_BYTE_LENGTH + 4;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface QueuedInputFile {
  file: File;
  relativePath: string;
}

export interface DecodedChunkFrame {
  fileId: string;
  chunkIndex: number;
  payload: Uint8Array;
}

export function encodeChunkFrame(
  fileId: string,
  chunkIndex: number,
  chunkPayload: ArrayBuffer
): ArrayBuffer {
  const idBytes = textEncoder.encode(fileId);
  if (idBytes.byteLength !== UUID_BYTE_LENGTH) {
    throw new Error(`Expected 36-byte UUID fileId, got ${idBytes.byteLength}`);
  }

  const frame = new Uint8Array(FRAME_HEADER_BYTES + chunkPayload.byteLength);
  frame.set(idBytes, 0);
  const view = new DataView(frame.buffer);
  view.setUint32(UUID_BYTE_LENGTH, chunkIndex, false);
  frame.set(new Uint8Array(chunkPayload), FRAME_HEADER_BYTES);
  return frame.buffer;
}

export function decodeChunkFrame(buffer: ArrayBuffer): DecodedChunkFrame | null {
  if (buffer.byteLength < FRAME_HEADER_BYTES) return null;

  const bytes = new Uint8Array(buffer);
  const fileId = textDecoder.decode(bytes.subarray(0, UUID_BYTE_LENGTH));
  const view = new DataView(buffer);
  const chunkIndex = view.getUint32(UUID_BYTE_LENGTH, false);
  const payload = bytes.subarray(FRAME_HEADER_BYTES);

  return { fileId, chunkIndex, payload };
}

export function calculateTotalChunks(size: number, chunkSize = CHUNK_SIZE): number {
  if (size <= 0) return 0;
  return Math.ceil(size / chunkSize);
}

async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  const collected: FileSystemEntry[] = [];

  // Chromium's readEntries returns batches of at most 100 entries until an empty array.
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    collected.push(...batch);
  }

  return collected;
}

async function traverseEntry(
  entry: FileSystemEntry,
  parentPath: string
): Promise<QueuedInputFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    const relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
    return [{ file, relativePath }];
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children = await readAllDirectoryEntries(reader);
    const nextParent = parentPath ? `${parentPath}/${dirEntry.name}` : dirEntry.name;
    const nested = await Promise.all(
      children.map((child) => traverseEntry(child, nextParent))
    );
    return nested.flat();
  }

  return [];
}

export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<QueuedInputFile[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length > 0) {
    const groups = await Promise.all(entries.map((entry) => traverseEntry(entry, "")));
    return groups.flat();
  }

  return extractFilesFromFileList(dataTransfer.files);
}

export function extractFilesFromFileList(fileList: FileList | null): QueuedInputFile[] {
  if (!fileList) return [];
  return Array.from(fileList).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}
