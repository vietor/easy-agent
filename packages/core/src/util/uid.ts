import { randomInt, randomUUID } from "node:crypto";

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

const SNOWFLAKE_EPOCH = 1704067200000n;
const MACHINE_BITS = 10n;
const SEQUENCE_BITS = 12n;
const TIMESTAMP_SHIFT = MACHINE_BITS + SEQUENCE_BITS;
const MACHINE_SHIFT = SEQUENCE_BITS;
const MAX_MACHINE_ID = (1n << MACHINE_BITS) - 1n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;

export class Snowflake {
  private readonly machineId: bigint;
  private lastTimestamp = -1n;
  private sequence = 0n;

  constructor(machineId: number = 1) {
    const id = BigInt(machineId);
    if (id < 0n || id > MAX_MACHINE_ID) {
      throw new Error(`machineId 必须在 0 ~ ${MAX_MACHINE_ID} 之间`);
    }
    this.machineId = id;
  }

  nextId(): bigint {
    let timestamp = BigInt(Date.now()) - SNOWFLAKE_EPOCH;

    if (timestamp < this.lastTimestamp) {
      timestamp = this.lastTimestamp;
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        while (BigInt(Date.now()) - SNOWFLAKE_EPOCH <= this.lastTimestamp) {}
        timestamp = BigInt(Date.now()) - SNOWFLAKE_EPOCH;
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    return (
      (timestamp << TIMESTAMP_SHIFT) |
      (this.machineId << MACHINE_SHIFT) |
      this.sequence
    );
  }
}

const defaultSnowflake = new Snowflake(randomInt(0, 1024));

export function nextUid(): string {
  return toSortableBase62(defaultSnowflake.nextId());
}

export function nextUuid(): string {
  return randomUUID();
}
