import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function verifyFileHash(filePath: string, expected: string): Promise<void> {
  const actual = await hashFile(filePath);
  if (actual !== expected) {
    throw new Error(`Hash mismatch for ${filePath}: expected ${expected}, got ${actual}`);
  }
}
