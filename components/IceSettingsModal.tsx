"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_ICE_SERVERS,
  isValidIceUrl,
  loadCustomIceServers,
  saveCustomIceServers,
  type CustomIceServerEntry,
} from "@/lib/iceConfig";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface IceSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onConfigSaved: () => void;
}

export function IceSettingsModal({
  open,
  onClose,
  onConfigSaved,
}: IceSettingsModalProps) {
  const [entries, setEntries] = useState<CustomIceServerEntry[]>(() =>
    loadCustomIceServers()
  );
  const [urlInput, setUrlInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [credentialInput, setCredentialInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = (event: FormEvent): void => {
    event.preventDefault();
    const cleanedUrl = urlInput.trim();
    if (!isValidIceUrl(cleanedUrl)) {
      setError("Enter a valid stun:, stuns:, turn:, or turns: server URL.");
      return;
    }

    const next: CustomIceServerEntry[] = [
      ...entries,
      {
        id: crypto.randomUUID(),
        urls: cleanedUrl,
        username: usernameInput.trim() || undefined,
        credential: credentialInput.trim() || undefined,
      },
    ];
    setEntries(next);
    saveCustomIceServers(next);
    onConfigSaved();
    setUrlInput("");
    setUsernameInput("");
    setCredentialInput("");
    setError(null);
  };

  const handleRemove = (id: string): void => {
    const next = entries.filter((item) => item.id !== id);
    setEntries(next);
    saveCustomIceServers(next);
    onConfigSaved();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Network & ICE Servers"
      description="Stored locally in your browser. Add custom STUN or TURN relays for symmetric NATs."
    >
      <div className="space-y-5">
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#525252]">
            Built-in Default
          </h2>
          <div className="rounded-sm border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-2 font-mono text-xs text-[#0A0A0A]">
            {String(DEFAULT_ICE_SERVERS[0].urls)}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#525252]">
            Custom Servers ({entries.length})
          </h2>
          {entries.length === 0 ? (
            <p className="rounded-sm border border-dashed border-[#E5E5E5] px-3 py-3 text-xs text-[#525252]">
              No custom STUN/TURN servers configured.
            </p>
          ) : (
            <ul className="divide-y divide-[#E5E5E5] rounded-sm border border-[#E5E5E5]">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-[#0A0A0A]">
                      {entry.urls}
                    </div>
                    {entry.username && (
                      <div className="truncate font-mono text-[11px] text-[#525252]">
                        user: {entry.username}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${entry.urls}`}
                    onClick={() => handleRemove(entry.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[#525252]" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={handleAdd} className="space-y-3 border-t border-[#E5E5E5] pt-4">
          <h2 className="text-sm font-semibold text-[#0A0A0A]">
            Add STUN / TURN Server
          </h2>
          <div className="space-y-2">
            <div>
              <label htmlFor="ice-url" className="block text-xs text-[#525252] mb-1">
                Server URL
              </label>
              <input
                id="ice-url"
                type="text"
                placeholder="turn:relay.example.com:3478"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full rounded-sm border border-[#E5E5E5] bg-white px-3 py-1.5 font-mono text-xs text-[#0A0A0A] placeholder:text-[#737373]"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="ice-username"
                  className="block text-xs text-[#525252] mb-1"
                >
                  Username (optional)
                </label>
                <input
                  id="ice-username"
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full rounded-sm border border-[#E5E5E5] bg-white px-3 py-1.5 font-mono text-xs text-[#0A0A0A]"
                />
              </div>
              <div>
                <label
                  htmlFor="ice-credential"
                  className="block text-xs text-[#525252] mb-1"
                >
                  Credential (optional)
                </label>
                <input
                  id="ice-credential"
                  type="password"
                  value={credentialInput}
                  onChange={(e) => setCredentialInput(e.target.value)}
                  className="w-full rounded-sm border border-[#E5E5E5] bg-white px-3 py-1.5 font-mono text-xs text-[#0A0A0A]"
                />
              </div>
            </div>
            {error && <p className="text-xs text-[#991B1B]">{error}</p>}
          </div>
          <Button type="submit" variant="primary" size="sm">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add Server
          </Button>
        </form>
      </div>
    </Modal>
  );
}
