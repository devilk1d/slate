"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import QRCode from "qrcode";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  formatRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "@/lib/generateRoomCode";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Modal } from "@/components/ui/Modal";

export interface PairingModalProps {
  open: boolean;
  onClose: () => void;
  roomCode: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
}

const subscribeNoop = (): (() => void) => () => {};

function buildQrPath(url: string): { size: number; path: string } | null {
  try {
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const segments: string[] = [];

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(y, x)) {
          segments.push(`M${x},${y}h1v1h-1z`);
        }
      }
    }

    return { size, path: segments.join("") };
  } catch {
    return null;
  }
}

export function PairingModal({
  open,
  onClose,
  roomCode,
  onCreateRoom,
  onJoinRoom,
}: PairingModalProps) {
  const [joinInput, setJoinInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const origin = useSyncExternalStore(
    subscribeNoop,
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    () => ""
  );

  const joinUrl = useMemo(() => {
    if (!roomCode || !origin) return "";
    const raw = normalizeRoomCode(roomCode);
    return `${origin}/?room=${raw}`;
  }, [origin, roomCode]);

  const qrMatrix = useMemo(() => {
    if (!joinUrl) return null;
    return buildQrPath(joinUrl);
  }, [joinUrl]);

  const handleJoinSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!isValidRoomCode(joinInput)) {
      setValidationError("Enter a complete 6-digit room code.");
      return;
    }
    setValidationError(null);
    onJoinRoom(joinInput);
    setJoinInput("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pair Devices"
      description="Create a room to scan from another device, or enter a 6-digit code to connect directly."
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#0A0A0A]">
              Active Room
            </h2>
            <Button variant="secondary" size="sm" onClick={onCreateRoom}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {roomCode ? "Regenerate" : "Create Room"}
            </Button>
          </div>

          {roomCode && qrMatrix ? (
            <div className="flex flex-col sm:flex-row items-center gap-4 rounded-sm border border-[#E5E5E5] bg-[#FAFAFA] p-4">
              <div className="shrink-0 rounded-sm border border-[#E5E5E5] bg-white p-2">
                <svg
                  role="img"
                  aria-label={`QR code to join room ${roomCode}`}
                  viewBox={`-2 -2 ${qrMatrix.size + 4} ${qrMatrix.size + 4}`}
                  className="h-36 w-36 block"
                  shapeRendering="crispEdges"
                >
                  <rect
                    x={-2}
                    y={-2}
                    width={qrMatrix.size + 4}
                    height={qrMatrix.size + 4}
                    fill="#FFFFFF"
                  />
                  <path d={qrMatrix.path} fill="#0A0A0A" />
                </svg>
              </div>

              <div className="flex-1 min-w-0 space-y-3 text-center sm:text-left">
                <div>
                  <div className="text-xs text-[#525252]">Room Code</div>
                  <div className="mt-0.5 font-mono text-2xl font-semibold tracking-wider tabular-nums text-[#0A0A0A]">
                    {roomCode}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <CopyButton
                    text={joinUrl}
                    ariaLabel="Copy direct invite link"
                    label="Copy Invite URL"
                    size="md"
                  />
                  <CopyButton
                    text={normalizeRoomCode(roomCode)}
                    ariaLabel="Copy 6-digit room code"
                    label="Copy Code"
                    size="md"
                  />
                </div>
                <p className="font-mono text-[11px] text-[#525252] break-all">
                  {joinUrl}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-[#E5E5E5] bg-[#FAFAFA] p-5 text-center space-y-2">
              <p className="text-xs text-[#525252]">
                No active room. Generate a 6-digit code and QR link to pair a peer.
              </p>
              <Button variant="primary" size="sm" onClick={onCreateRoom}>
                Generate Room Code
              </Button>
            </div>
          )}
        </section>

        <div className="border-t border-[#E5E5E5]" />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[#0A0A0A]">
            Join Existing Room
          </h2>
          <form onSubmit={handleJoinSubmit} className="space-y-2">
            <label
              htmlFor="join-room-code"
              className="block text-xs text-[#525252]"
            >
              6-digit room code
            </label>
            <div className="flex gap-2">
              <input
                id="join-room-code"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="482-910"
                value={joinInput}
                onChange={(e) => {
                  setJoinInput(formatRoomCode(e.target.value));
                  if (validationError) setValidationError(null);
                }}
                aria-invalid={validationError ? "true" : undefined}
                aria-describedby={validationError ? "join-room-error" : undefined}
                className="min-w-0 flex-1 rounded-sm border border-[#E5E5E5] bg-white px-3 py-2 font-mono text-sm tracking-wider tabular-nums text-[#0A0A0A] placeholder:text-[#737373] focus:border-[#0A0A0A]"
              />
              <Button type="submit" variant="primary" size="md">
                Join
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {validationError && (
              <p id="join-room-error" className="text-xs text-[#991B1B]">
                {validationError}
              </p>
            )}
          </form>
        </section>
      </div>
    </Modal>
  );
}
