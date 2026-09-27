import { randomUUID } from "node:crypto";

const BASE62_PAD_LEN = 11;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE62_RADIX = 62n;

function toSortableBase62(num: bigint): string {
  let result = "";
  while (num > 0n) {
    result = BASE62_CHARS[Number(num % BASE62_RADIX)] + result;
    num /= BASE62_RADIX;
  }
  return result.padStart(BASE62_PAD_LEN, "0");
}

const SEQUENCE_BITS = 10n;

let last = 0n;

export function nextUid(): string {
  const now = BigInt(Date.now()) << SEQUENCE_BITS;
  last = last < now ? now : last + 1n;
  return toSortableBase62(last);
}

export function nextUuid(): string {
  return randomUUID();
}
