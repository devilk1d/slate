"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useFileTransfer } from "@/hooks/useFileTransfer";
import { usePeerSession } from "@/hooks/usePeerSession";
import { useScratchpad } from "@/hooks/useScratchpad";
import { useWakeLock } from "@/hooks/useWakeLock";
import { isValidRoomCode } from "@/lib/generateRoomCode";
import { DropzonePanel } from "@/components/DropzonePanel";
import { IceSettingsModal } from "@/components/IceSettingsModal";
import { PairingModal } from "@/components/PairingModal";
import { ScratchpadPanel } from "@/components/ScratchpadPanel";
import { SessionHeader } from "@/components/SessionHeader";
import { TransferQueue } from "@/components/TransferQueue";

export function SlateWorkspace() {
  const session = usePeerSession();
  const scratchpad = useScratchpad(session);
  const transfer = useFileTransfer(session);
  const wakeLockActive = useWakeLock(transfer.activeCount > 0);

  const [pairingOpen, setPairingOpen] = useState(false);
  const [iceModalOpen, setIceModalOpen] = useState(false);

  const { joinRoom } = session;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam && isValidRoomCode(roomParam)) {
      joinRoom(roomParam);
    }
  }, [joinRoom]);

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#0A0A0A]">
      <SessionHeader
        connectionState={session.connectionState}
        roomCode={session.roomCode}
        localLabel={session.localLabel}
        remotePeer={session.remotePeer}
        onUpdateLabel={session.updateLocalLabel}
        onCreateRoom={() => {
          session.createRoom();
          setPairingOpen(true);
        }}
        onOpenPairing={() => setPairingOpen(true)}
        onOpenIceSettings={() => setIceModalOpen(true)}
        onDisconnect={session.disconnect}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 space-y-5">
        {session.error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-sm border border-[#991B1B] bg-[#FEF2F2] px-4 py-2.5 text-xs text-[#991B1B]"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{session.error}</span>
            </div>
            <button
              type="button"
              onClick={session.clearError}
              aria-label="Dismiss error"
              className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-sm hover:bg-[#FEE2E2] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <DropzonePanel
            connectionState={session.connectionState}
            storageBackend={transfer.storageBackend}
            wakeLockActive={wakeLockActive}
            onFilesSelected={transfer.enqueueFiles}
            onOpenPairing={() => setPairingOpen(true)}
          />

          <ScratchpadPanel
            connectionState={session.connectionState}
            entries={scratchpad.entries}
            lastClearedBy={scratchpad.lastClearedBy}
            onSendEntry={scratchpad.sendEntry}
            onClearSession={scratchpad.clearSession}
          />
        </div>

        <TransferQueue
          transfers={transfer.transfers}
          onPause={transfer.pauseTransfer}
          onResume={transfer.resumeTransfer}
          onCancel={transfer.cancelTransfer}
          onClearFinished={transfer.clearFinished}
        />
      </main>

      <footer className="border-t border-[#E5E5E5] bg-[#FAFAFA]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 text-xs text-[#525252]">
          <span>
            Zero-database WebRTC DTLS transport. Files and notes never touch a server.
          </span>
          <span className="font-mono text-[11px]">
            Chunk: 64 KB / Storage: {transfer.storageBackend}
          </span>
        </div>
      </footer>

      <PairingModal
        open={pairingOpen}
        onClose={() => setPairingOpen(false)}
        roomCode={session.roomCode}
        onCreateRoom={() => session.createRoom()}
        onJoinRoom={(code) => session.joinRoom(code)}
      />

      <IceSettingsModal
        open={iceModalOpen}
        onClose={() => setIceModalOpen(false)}
        onConfigSaved={session.refreshIceConfig}
      />
    </div>
  );
}
