import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { makePatch } from "../src/patch/make.js";
import { applyPatch } from "../src/patch/apply.js";
import { listAllFiles } from "../src/utils/fs.js";
import { hashFile } from "../src/utils/hash.js";
import { safeJoin } from "../src/utils/paths.js";

async function writeFile(filePath: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function assertDirsEqual(expectedDir: string, actualDir: string): Promise<void> {
  const expectedFiles = await listAllFiles(expectedDir);
  const actualFiles = await listAllFiles(actualDir);
  assert.deepEqual(actualFiles, expectedFiles, "File lists differ");
  for (const relPath of expectedFiles) {
    const expectedPath = safeJoin(expectedDir, relPath);
    const actualPath = safeJoin(actualDir, relPath);
    const [expectedHash, actualHash] = await Promise.all([hashFile(expectedPath), hashFile(actualPath)]);
    assert.equal(actualHash, expectedHash, `File differs: ${relPath}`);
  }
}

test("make and apply patch bundle", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "extpatcher-test-"));
  const originalDir = path.join(tempRoot, "original");
  const modifiedDir = path.join(tempRoot, "modified");
  const outputDir = path.join(tempRoot, "output");
  const patchZip = path.join(tempRoot, "patch.zip");

  try {
    await fs.mkdir(originalDir, { recursive: true });
    await fs.mkdir(modifiedDir, { recursive: true });

    await writeFile(
      path.join(originalDir, "manifest.json"),
      JSON.stringify({ manifest_version: 3, version: "1.0.0", name: "Sample" }, null, 2)
    );
    await writeFile(path.join(originalDir, "script.js"), "console.log('original');");
    await writeFile(path.join(originalDir, "assets", "old.txt"), "old");

    await writeFile(
      path.join(modifiedDir, "manifest.json"),
      JSON.stringify({ manifest_version: 3, version: "1.0.0", name: "Sample" }, null, 2)
    );
    await writeFile(path.join(modifiedDir, "script.js"), "console.log('modified');");
    await writeFile(path.join(modifiedDir, "assets", "new.txt"), "new");

    await makePatch({ originalDir, modifiedDir, outFile: patchZip });
    await applyPatch({ patchZip, input: originalDir, output: outputDir });

    await assertDirsEqual(modifiedDir, outputDir);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
