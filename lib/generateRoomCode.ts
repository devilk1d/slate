const ROOM_CODE_LENGTH = 6;

export function normalizeRoomCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, ROOM_CODE_LENGTH);
}

export function formatRoomCode(rawCode: string): string {
  const digits = normalizeRoomCode(rawCode);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function isValidRoomCode(input: string): boolean {
  return /^\d{6}$/.test(normalizeRoomCode(input));
}

export function generateRoomCode(): string {
  const bytes = new Uint32Array(1);
  // Rejection sampling avoids modulo bias across the 1,000,000-code space.
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  let value = 0;

  do {
    crypto.getRandomValues(bytes);
    value = bytes[0];
  } while (value >= limit);

  const raw = String(value % 1_000_000).padStart(ROOM_CODE_LENGTH, "0");
  return formatRoomCode(raw);
}
