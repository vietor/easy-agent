import { randomUUID } from "node:crypto";

export function nextUuid(): string {
  return randomUUID();
}
