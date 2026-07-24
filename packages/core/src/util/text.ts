export function getContentBytes(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}
