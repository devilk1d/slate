#!/bin/sh
set -e

node server/signaling.ts &
WS_PID=$!

node server.js &
NEXT_PID=$!

cleanup() {
  kill "$WS_PID" "$NEXT_PID" 2>/dev/null || true
  wait "$WS_PID" "$NEXT_PID" 2>/dev/null || true
}

trap cleanup INT TERM

while kill -0 "$WS_PID" 2>/dev/null && kill -0 "$NEXT_PID" 2>/dev/null; do
  sleep 1
done

cleanup
exit 1
