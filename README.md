<div align="center">
  <img src="public/logo.svg" alt="Slate logo" width="88" height="88" />
  <h1>Slate</h1>
  <p>Zero-database multi-peer file transfer and live ephemeral scratchpad over WebRTC.</p>

  <p>
    <img src="https://img.shields.io/badge/License-AGPL--3.0-0A0A0A?style=flat-square" alt="License: AGPL-3.0" />
    <img src="https://img.shields.io/badge/TypeScript-Strict-0A0A0A?style=flat-square" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Transport-WebRTC%20DTLS%20Mesh-0A0A0A?style=flat-square" alt="WebRTC" />
    <img src="https://img.shields.io/badge/Storage-OPFS%20%2F%20IndexedDB-0A0A0A?style=flat-square" alt="OPFS" />
    <img src="https://img.shields.io/badge/Database-Zero--Database-0A0A0A?style=flat-square" alt="Zero-Database" />
  </p>
</div>

---

## Overview

Slate is an open-source, privacy-first browser workspace for direct peer-to-peer file/folder streaming and real-time ephemeral text sharing across up to **6 devices per room**. No user files, clipboard snippets, or session histories ever touch a backend server or database.

A minimalist signaling broker (standalone Node.js `ws` or Cloudflare Workers Durable Objects with WebSocket Hibernation) coordinates 6-digit room codes and WebRTC SDP/ICE negotiation. Once DTLS-encrypted `RTCPeerConnection` links are established in a full mesh, all data flows directly between browsers over dual `RTCDataChannel` streams.

## Key Features

- **Multi-Peer Mesh & Selective Target Transfer:** Pair up to 6 devices in one room (`XXX-XXX`). Choose specific target devices before sending files so upload bandwidth only streams to selected peers.
- **Zero-Cloud Privacy:** Zero central database, zero server file storage, and automatic room cleanup on disconnect.
- **Live Ephemeral Scratchpad:** Real-time bidirectional feed broadcast across all connected room peers over ordered `control` DataChannels, with device labels, timestamps, one-click copy, reconnect sync, and synchronized session wipe.
- **OPFS-First Disk Streaming:** Incoming 64 KB chunks write directly to the browser Origin Private File System (`navigator.storage.getDirectory()`) with automatic IndexedDB fallback, keeping RAM usage minimal.
- **Manual & Bulk Download Control:** Completed incoming files stay staged in browser storage without unsolicited auto-downloads, with per-file **Download** and multi-select **Download Selected** bulk controls.
- **Pause, Speed/ETA & Auto-Resume:** Per-transfer throughput and ETA telemetry, manual Pause/Resume/Cancel, and automatic missing-chunk negotiation upon reconnect.
- **Direct Folder Drop & Mobile Ready:** Drag-and-drop nested folders (`webkitGetAsEntry` / `webkitdirectory`), Screen Wake Lock during active transfers, local SVG QR pairing (`?room=XXXXXX`), multi-STUN defaults, and custom STUN/TURN configuration in `localStorage`.

## Architecture

```text
+-------------------+                              +-------------------+
|     Device A      |                              |     Device B      |
|  Next.js Client   |                              |  Next.js Client   |
+---------+---------+                              +---------+---------+
          |                                                  |
          |  1. Room Code (XXX-XXX, up to 6 peers), SDP/ICE  |
          +---------------------->+  +<----------------------+
                                  |  |
                  +---------------+--+---------------+
                  |    Signaling Broker (Zero DB)    |
                  |  Node.js ws  |  CF Durable Obj.  |
                  +----------------------------------+
                                  ^
                                  | (Device C..F join same mesh)
                                  v
+----------------------------------------------------------------------+
|          2. Direct WebRTC DTLS Mesh (Per-Peer DataChannels)          |
|======================================================================|
|  control channel     : JSON (scratchpad broadcast, offer/ack, sync)  |
|  file-stream channel : 64 KB binary chunks (selective targets only)  |
+----------------------------------------------------------------------+
          |                                                  |
          v                                                  v
   [File Slice API]                              [OPFS / IndexedDB]
                                                 [Manual / Bulk Save]
```

## Quick Start

### Local Development

Prerequisites: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

This launches both the Next.js frontend on `http://localhost:3000` and the WebSocket signaling server on `ws://localhost:3001`.

### One-Command Docker Self-Hosting

```bash
docker compose up -d
```

Open `http://localhost:3000`. Configure `NEXT_PUBLIC_SIGNALING_URL` when deploying behind a reverse proxy or custom domain with TLS (`wss://`).

### Deploying to Vercel (Hybrid Setup)

Vercel runs the Next.js frontend, while signaling requires a persistent WebSocket host:

**Option A — Cloudflare Workers (Free Tier, No Credit Card, Zero Sleep):**

```bash
npx wrangler login
npx wrangler deploy --config workers/wrangler.jsonc
```

Copy the deployed `wss://slate-signaling.<your-subdomain>.workers.dev` URL into Vercel's `NEXT_PUBLIC_SIGNALING_URL` environment variable and deploy.

**Option B — Docker Host (VPS / Fly.io):**

1. Deploy the signaling broker using `Dockerfile.signaling` or `npm run start:ws` on Node.js 22+.
2. In your Vercel project **Environment Variables**, set `NEXT_PUBLIC_SIGNALING_URL=wss://your-signaling-host.example.com`.
3. Deploy the Next.js app to Vercel (`npm run build`).

## Project Structure

```text
slate/
├── app/                   # Next.js App Router layout, global tokens, icon.svg, and entry page
├── components/
│   ├── ui/                # Reusable monochrome UI primitives (Button, Badge, Modal, ProgressBar, CopyButton)
│   ├── DropzonePanel.tsx  # Target device selector + file and folder dropzone
│   ├── IceSettingsModal.tsx
│   ├── PairingModal.tsx   # Local SVG QR generator and 6-digit room join form
│   ├── ScratchpadPanel.tsx
│   ├── SessionHeader.tsx  # Device identifier, DTLS status, multi-peer badges, room capacity
│   ├── SlateMark.tsx      # Monochrome geometric brand mark
│   ├── SlateWorkspace.tsx
│   └── TransferQueue.tsx  # Speed, ETA, Pause/Resume, and selective bulk download
├── core/
│   ├── chunker.ts         # 64 KB binary framing and recursive directory traversal
│   ├── protocol.ts        # Signaling and DataChannel message contracts
│   ├── scratchpad.ts      # Ephemeral scratchpad entry helpers
│   └── webrtc.ts          # Multi-peer RTCPeerConnection mesh, SCTP flow control, ICE diagnostics
├── hooks/
│   ├── useFileTransfer.ts # Per-peer chunked transfer engine with auto-resume and bulk save
│   ├── usePeerSession.ts  # React lifecycle wrapper for WebRTC mesh manager
│   ├── useScratchpad.ts   # Broadcast scratchpad state sync
│   └── useWakeLock.ts     # Screen Wake Lock management
├── lib/
│   ├── cn.ts
│   ├── deviceIdentity.ts
│   ├── fileStorage.ts     # OPFS-first disk streaming with IndexedDB fallback
│   ├── formatBytes.ts
│   ├── generateRoomCode.ts
│   └── iceConfig.ts
├── public/
│   └── logo.svg           # High-contrast geometric Slate mark
├── server/
│   └── signaling.ts       # Minimalist Node.js ws signaling broker (< 200 lines)
├── workers/
│   ├── signaling.ts       # Cloudflare Workers Durable Object signaling adapter
│   └── wrangler.jsonc     # Wrangler configuration (SQLite-backed Durable Object)
├── .env.example
├── Dockerfile
├── Dockerfile.signaling
├── docker-compose.yml
├── docker-entrypoint.sh
└── LICENSE                # GNU AGPL-3.0
```

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

Copyright (c) 2026 Ibnu Dwito Abimanyu.
