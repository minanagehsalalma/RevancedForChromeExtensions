import path from "node:path";
import fs from "node:fs/promises";
import { copyDir, copyFileStream, createTempDir, listAllFiles, pathExists, removeDir } from "../utils/fs.js";
import { hashFile } from "../utils/hash.js";
import { createZipFromDir } from "../utils/zip.js";
import { ensureSafeRelPath, isZipPath, safeJoin } from "../utils/paths.js";
import type { PatchBundle } from "./types.js";
import { loadPatchBundle, prepareInputSource, validateTargetAndFingerprints } from "./validate.js";

interface ApplyOptions {
  patchZip: string;
  input: string;
  output: string;
  checkAgainst?: string;
}

async function validatePayloadFile(patchDir: string, payloadPath: string, opPath: string): Promise<string> {
  ensureSafeRelPath(payloadPath);
  const absPath = safeJoin(patchDir, payloadPath);
  let stat;
  try {
    stat = await fs.lstat(absPath);
  } catch {
    throw new Error(`Missing payload for ${opPath}: ${payloadPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Payload is not a file: ${payloadPath}`);
  }
  return absPath;
}

async function compareDirs(expectedDir: string, actualDir: string): Promise<void> {
  const expectedFiles = await listAllFiles(expectedDir);
  const actualFiles = await listAllFiles(actualDir);
  if (expectedFiles.length !== actualFiles.length || expectedFiles.join("|") !== actualFiles.join("|")) {
    throw new Error("Directory comparison failed: file lists do not match");
  }
  for (const relPath of expectedFiles) {
    const expectedPath = safeJoin(expectedDir, relPath);
    const actualPath = safeJoin(actualDir, relPath);
    const [expectedHash, actualHash] = await Promise.all([hashFile(expectedPath), hashFile(actualPath)]);
    if (expectedHash !== actualHash) {
      throw new Error(`Directory comparison failed: ${relPath} differs`);
    }
  }
}

async function applyOps(patch: PatchBundle, patchDir: string, outDir: string): Promise<void> {
  for (const op of patch.ops) {
    ensureSafeRelPath(op.path);
    const destPath = safeJoin(outDir, op.path);
    if (op.type === "delete") {
      let stat;
      try {
        stat = await fs.lstat(destPath);
      } catch {
        throw new Error(`Cannot delete missing file: ${op.path}`);
      }
      if (!stat.isFile()) {
        throw new Error(`Delete target is not a file: ${op.path}`);
      }
      await fs.rm(destPath, { force: true });
      continue;
    }

    if (op.type === "add") {
      const payloadAbs = await validatePayloadFile(patchDir, op.payloadPath, op.path);
      const exists = await fs
        .access(destPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        throw new Error(`Add target already exists: ${op.path}`);
      }
      await copyFileStream(payloadAbs, destPath);
      const actual = await hashFile(destPath);
      if (actual !== op.sha256) {
        throw new Error(`Added file hash mismatch for ${op.path}: expected ${op.sha256}, got ${actual}`);
      }
      continue;
    }

    if (op.type === "replace") {
      const payloadAbs = await validatePayloadFile(patchDir, op.payloadPath, op.path);
      let stat;
      try {
        stat = await fs.lstat(destPath);
      } catch {
        throw new Error(`Replace target missing: ${op.path}`);
      }
      if (!stat.isFile()) {
        throw new Error(`Replace target is not a file: ${op.path}`);
      }
      const currentHash = await hashFile(destPath);
      if (currentHash !== op.fromSha256) {
        throw new Error(`Replace source hash mismatch for ${op.path}: expected ${op.fromSha256}, got ${currentHash}`);
      }
      await copyFileStream(payloadAbs, destPath);
      const actual = await hashFile(destPath);
      if (actual !== op.toSha256) {
        throw new Error(`Replaced file hash mismatch for ${op.path}: expected ${op.toSha256}, got ${actual}`);
      }
    }
  }
}

export async function applyPatch(options: ApplyOptions): Promise<void> {
  const patchZip = path.resolve(options.patchZip);
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  const tempRoot = await createTempDir("extpatcher-apply-");

  try {
    const { patch, patchDir } = await loadPatchBundle(patchZip, tempRoot);
    const { inputDir } = await prepareInputSource(input, tempRoot);

    await validateTargetAndFingerprints(patch, inputDir);

    let workDir = output;
    if (isZipPath(output)) {
      workDir = path.join(tempRoot, "work");
      await copyDir(inputDir, workDir);
      await applyOps(patch, patchDir, workDir);
      await createZipFromDir(workDir, output);
    } else {
      if (await pathExists(output)) {
        const stat = await fs.stat(output);
        if (!stat.isDirectory()) {
          throw new Error(`Output path is not a directory: ${output}`);
        }
        const contents = await fs.readdir(output);
        if (contents.length > 0) {
          throw new Error(`Output directory is not empty: ${output}`);
        }
      }
      await copyDir(inputDir, output);
      await applyOps(patch, patchDir, output);
    }

    if (options.checkAgainst) {
      const checkDir = path.resolve(options.checkAgainst);
      await compareDirs(checkDir, isZipPath(output) ? workDir : output);
    }
  } finally {
    await removeDir(tempRoot);
  }
}
