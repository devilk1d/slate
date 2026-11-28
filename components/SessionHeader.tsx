"use client";

import { useState, type FormEvent } from "react";
import {
  Check,
  Laptop,
  Pencil,
  Plus,
  QrCode,
  ShieldCheck,
  SlidersHorizontal,
  Unplug,
} from "lucide-react";
import type { PeerConnectionState, RemotePeerInfo } from "@/core/protocol";
import { SlateMark } from "@/components/SlateMark";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";

export interface SessionHeaderProps {
  connectionState: PeerConnectionState;
  roomCode: string | null;
  localLabel: string;
  peers: RemotePeerInfo[];
  onUpdateLabel: (next: string) => void;
  onCreateRoom: () => void;
  onOpenPairing: () => void;
  onOpenIceSettings: () => void;
  onDisconnect: () => void;
}

const STATE_META: Record<
  PeerConnectionState,
  { label: string; tone: BadgeTone }
> = {
  idle: { label: "Offline", tone: "neutral" },
  "waiting-for-peer": { label: "Waiting for peer", tone: "warning" },
  connecting: { label: "Negotiating DTLS", tone: "active" },
  connected: { label: "Connected (DTLS)", tone: "solid" },
  reconnecting: { label: "Reconnecting", tone: "warning" },
  disconnected: { label: "Disconnected", tone: "neutral" },
};

export function SessionHeader({
  connectionState,
  roomCode,
  localLabel,
  peers,
  onUpdateLabel,
  onCreateRoom,
  onOpenPairing,
  onOpenIceSettings,
  onDisconnect,
}: SessionHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(localLabel);

  const stateMeta = STATE_META[connectionState];

  const startEditing = (): void => {
    setDraftLabel(localLabel);
    setEditing(true);
  };

  const commitLabel = (event?: FormEvent): void => {
    event?.preventDefault();
    onUpdateLabel(draftLabel);
    setEditing(false);
  };

  return (
    <header className="border-b border-[#E5E5E5] bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2.5 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2.5 shrink-0">
              <SlateMark className="h-7 w-7" />
              <h1 className="text-base font-semibold tracking-tight text-[#0A0A0A]">
                Slate
              </h1>
            </div>

            <span className="h-4 w-px bg-[#E5E5E5] shrink-0" aria-hidden="true" />

            {editing ? (
              <form onSubmit={commitLabel} className="flex items-center gap-1.5">
                <label htmlFor="local-device-label" className="sr-only">
                  Device identifier
                </label>
                <input
                  id="local-device-label"
                  type="text"
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  onBlur={() => commitLabel()}
                  maxLength={32}
                  autoFocus
                  className="h-7 w-32 sm:w-36 rounded-sm border border-[#0A0A0A] bg-white px-2 font-mono text-xs text-[#0A0A0A]"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="primary"
                  aria-label="Save device identifier"
                  className="min-h-7 min-w-7 p-1"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={startEditing}
                className="group inline-flex min-h-7 items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-0.5 text-xs text-[#525252] hover:border-[#E5E5E5] hover:bg-[#FAFAFA] hover:text-[#0A0A0A] cursor-pointer min-w-0"
                aria-label={`Edit device identifier ${localLabel}`}
              >
                <Laptop className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono font-medium text-[#0A0A0A]">
                  {localLabel}
                </span>
                <Pencil
                  className="h-3 w-3 shrink-0 opacity-60 group-hover:opacity-100"
                  aria-hidden="true"
                />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={stateMeta.tone} dot>
              {connectionState === "connected" && (
                <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              {stateMeta.label}
            </Badge>

            {peers.map((peer) => (
              <Badge
                key={peer.peerId}
                tone={peer.state === "connected" ? "active" : "warning"}
                dot
                className="max-w-[155px] sm:max-w-none"
              >
                <span className="truncate font-mono">{peer.label}</span>
              </Badge>
            ))}

            {roomCode && (
              <div className="inline-flex items-center gap-1.5 rounded-sm border border-[#E5E5E5] bg-[#FAFAFA] pl-2.5 pr-1 py-0.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#525252]">
                  Room
                </span>
                <span className="font-mono text-xs font-semibold tabular-nums text-[#0A0A0A]">
                  {roomCode}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#525252]">
                  {peers.length + 1}/6
                </span>
                <CopyButton
                  text={roomCode.replace(/-/g, "")}
                  ariaLabel={`Copy room code ${roomCode}`}
                  variant="ghost"
                  className="min-h-6 min-w-6 px-1"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!roomCode && (
              <Button variant="primary" size="sm" onClick={onCreateRoom}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New Room
              </Button>
            )}

            <Button variant="secondary" size="sm" onClick={onOpenPairing}>
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
              {roomCode ? "Share / Join" : "Pair / Join"}
            </Button>

            <Button
              variant="secondary"
              size="icon"
              onClick={onOpenIceSettings}
              aria-label="Configure STUN and TURN servers"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>

            {roomCode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDisconnect}
                aria-label="Leave room and disconnect"
              >
                <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Leave</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
