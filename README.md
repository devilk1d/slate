<div align="center">
  <img src="public/logo.svg" alt="Slate logo" width="88" height="88" />
  <h1>Slate</h1>
  <p>Zero-database peer-to-peer file transfer and live ephemeral scratchpad over WebRTC.</p>

  <p>
    <img src="https://img.shields.io/badge/License-AGPL--3.0-0A0A0A?style=flat-square" alt="License: AGPL-3.0" />
    <img src="https://img.shields.io/badge/TypeScript-Strict-0A0A0A?style=flat-square" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Transport-WebRTC%20DTLS-0A0A0A?style=flat-square" alt="WebRTC" />
    <img src="https://img.shields.io/badge/Storage-OPFS%20%2F%20IndexedDB-0A0A0A?style=flat-square" alt="OPFS" />
    <img src="https://img.shields.io/badge/Database-Zero--Database-0A0A0A?style=flat-square" alt="Zero-Database" />
  </p>
</div>

---

## Overview

Slate is an open-source, privacy-first browser workspace for direct peer-to-peer file/folder streaming and real-time ephemeral text sharing. No user files, clipboard snippets, or session histories ever touch a backend server or database.

A minimalist Node.js WebSocket server brokers 6-digit room codes and WebRTC SDP/ICE negotiation. Once the DTLS-encrypted `RTCPeerConnection` is established, all data flows directly between browsers over dual `RTCDataChannel` streams.

## Key Features

- **Zero-Cloud Privacy:** Zero central database, zero file uploads, and automatic room purging when peers disconnect.
- **Live Ephemeral Scratchpad:** Real-time bidirectional feed over an ordered `control` DataChannel with sender labels, timestamps, one-click copy, and synchronized session wipe.
- **OPFS-First Disk Streaming:** Incoming 64 KB chunks stream directly to the browser Origin Private File System (`navigator.storage.getDirectory()`) with automatic fallback to IndexedDB on unsupported browsers, keeping RAM usage minimal.
- **Pause & Auto-Resume:** Manual Pause/Resume and automatic drop recovery negotiate missing chunk indices upon reconnect and resume from the exact last received byte.
- **Direct Folder Drop:** Drag-and-drop entire folders (`webkitGetAsEntry` and `webkitdirectory`) while preserving relative directory paths.
- **Mobile Wake Lock & QR Pairing:** Acquires Screen Wake Lock during active transfers and generates instant local QR codes (`?room=XXXXXX`) alongside custom STUN/TURN configuration in `localStorage`.

## Architecture

```text
+-------------------+                              +-------------------+
|     Browser A     |                              |     Browser B     |
|  Next.js Client   |                              |  Next.js Client   |
+---------+---------+                              +---------+---------+
          |                                                  |
          |  1. Room Code (XXX-XXX), SDP Offer/Answer, ICE   |
          +---------------------->+  +<----------------------+
                                  |  |
                        +---------+--+---------+
                        |  ws Signaling Server |
                        |   (Zero Persistence) |
                        +----------------------+
          |                                                  |
          |  2. Direct WebRTC DTLS PeerConnection            |
          |==================================================|
          |  control channel     : JSON (scratchpad, sync)   |
          |  file-stream channel : 64 KB binary chunks       |
          +--------------------------------------------------+
          |                                                  |
          v                                                  v
   [File Slice API]                              [OPFS / IndexedDB]
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

## Project Structure

```text
slate/
├── app/                   # Next.js App Router layout, global tokens, and entry page
├── components/
│   ├── ui/                # Reusable monochrome UI primitives (Button, Badge, Modal, ProgressBar, CopyButton)
│   ├── DropzonePanel.tsx  # Drag-and-drop file and directory selector
│   ├── IceSettingsModal.tsx
│   ├── PairingModal.tsx   # QR code generator and 6-digit room join form
│   ├── ScratchpadPanel.tsx
│   ├── SessionHeader.tsx  # Device identifier, DTLS status, room badge
│   ├── SlateMark.tsx      # Monochrome geometric brand mark
│   ├── SlateWorkspace.tsx
│   └── TransferQueue.tsx  # Real-time speed, ETA, and pause/resume controls
├── core/
│   ├── chunker.ts         # 64 KB binary framing and directory traversal
│   ├── protocol.ts        # Signaling and DataChannel message contracts
│   ├── scratchpad.ts      # Ephemeral scratchpad entry helpers
│   └── webrtc.ts          # RTCPeerConnection, dual DataChannels, SCTP flow control
├── hooks/
│   ├── useFileTransfer.ts # Chunked transfer engine with auto-resume
│   ├── usePeerSession.ts  # React lifecycle wrapper for WebRTC manager
│   ├── useScratchpad.ts   # Bidirectional scratchpad state sync
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
│   └── signaling.ts       # Minimalist ws signaling broker (< 200 lines)
├── Dockerfile
├── docker-compose.yml
└── LICENSE                # GNU AGPL-3.0
```

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).

Copyright (c) 2026 Ibnu Dwito Abimanyu.
