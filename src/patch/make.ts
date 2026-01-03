import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DEFAULT_IGNORE_PATTERNS, assertDirectory, copyFileStream, createTempDir, removeDir, writeJsonFile, listFiles } from "../utils/fs.js";
import { hashFile } from "../utils/hash.js";
import { createZipFromDir } from "../utils/zip.js";
import { ensureSafeRelPath, safeJoin } from "../utils/paths.js";
import type { PatchBundle, PatchOp } from "./types.js";

interface MakeOptions {
  originalDir: string;
  modifiedDir: string;
  outFile: string;
}

async function stagePayloadFile(
  srcPath: string,
  payloadDir: string,
  hash: string,
  payloadCache: Set<string>
): Promise<string> {
  const payloadRelPath = `payload/${hash}`;
  const finalPath = path.join(payloadDir, hash);
  if (payloadCache.has(hash)) {
    return payloadRelPath;
  }

  try {
    await fs.access(finalPath);
    payloadCache.add(hash);
    return payloadRelPath;
  } catch {
    const tempName = `.tmp-${randomUUID()}`;
    const tempPath = path.join(payloadDir, tempName);
    await copyFileStream(srcPath, tempPath);
    try {
      await fs.rename(tempPath, finalPath);
    } catch (err) {
      const exists = await fs
        .access(finalPath)
        .then(() => true)
        .catch(() => false);
      await fs.rm(tempPath, { force: true });
      if (!exists) {
        throw err;
      }
    }
    payloadCache.add(hash);
    return payloadRelPath;
  }
}

export async function makePatch(options: MakeOptions): Promise<void> {
  const originalDir = path.resolve(options.originalDir);
  const modifiedDir = path.resolve(options.modifiedDir);
  const outFile = path.resolve(options.outFile);

  await assertDirectory(originalDir, "Original");
  await assertDirectory(modifiedDir, "Modified");

  const originalFiles = await listFiles(originalDir, DEFAULT_IGNORE_PATTERNS);
  const modifiedFiles = await listFiles(modifiedDir, DEFAULT_IGNORE_PATTERNS);

  const originalSet = new Set(originalFiles);
  const modifiedSet = new Set(modifiedFiles);

  const deleted = originalFiles.filter((file) => !modifiedSet.has(file));
  const added = modifiedFiles.filter((file) => !originalSet.has(file));
  const common = originalFiles.filter((file) => modifiedSet.has(file));

  const manifestPath = safeJoin(originalDir, "manifest.json");
  try {
    await fs.access(manifestPath);
  } catch {
    throw new Error("manifest.json not found in original directory");
  }

  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  let manifest: { manifest_version?: number; version?: string; name?: string };
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }

  const patchDir = await createTempDir("extpatcher-patch-");
  const payloadDir = path.join(patchDir, "payload");
  const payloadCache = new Set<string>();
  const fingerprintMap = new Map<string, string>();
  const ops: PatchOp[] = [];

  try {
    await fs.mkdir(payloadDir, { recursive: true });

    const manifestHash = await hashFile(manifestPath);
    fingerprintMap.set("manifest.json", manifestHash);

    for (const relPath of deleted) {
      ensureSafeRelPath(relPath);
      const absPath = safeJoin(originalDir, relPath);
      const hash = await hashFile(absPath);
      fingerprintMap.set(relPath, hash);
      ops.push({ type: "delete", path: relPath });
    }

    for (const relPath of common) {
      ensureSafeRelPath(relPath);
      const originalAbs = safeJoin(originalDir, relPath);
      const modifiedAbs = safeJoin(modifiedDir, relPath);
      const origHash = await hashFile(originalAbs);
      const modHash = await hashFile(modifiedAbs);
      if (origHash !== modHash) {
        fingerprintMap.set(relPath, origHash);
        const payloadRelPath = await stagePayloadFile(modifiedAbs, payloadDir, modHash, payloadCache);
        ops.push({
          type: "replace",
          path: relPath,
          payloadPath: payloadRelPath,
          fromSha256: origHash,
          toSha256: modHash
        });
      }
    }

    for (const relPath of added) {
      ensureSafeRelPath(relPath);
      const modifiedAbs = safeJoin(modifiedDir, relPath);
      const modHash = await hashFile(modifiedAbs);
      const payloadRelPath = await stagePayloadFile(modifiedAbs, payloadDir, modHash, payloadCache);
      ops.push({
        type: "add",
        path: relPath,
        payloadPath: payloadRelPath,
        sha256: modHash
      });
    }

    ops.sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type));

    const fingerprints: Record<string, string> = {};
    const sortedFingerprintKeys = Array.from(fingerprintMap.keys()).sort();
    for (const key of sortedFingerprintKeys) {
      fingerprints[key] = fingerprintMap.get(key) ?? "";
    }

    const target: PatchBundle["target"] = {};
    if (manifest.manifest_version !== undefined) {
      target.manifest_version = manifest.manifest_version;
    }
    if (manifest.version !== undefined) {
      target.version = manifest.version;
    }
    if (manifest.name !== undefined) {
      target.name = manifest.name;
    }

    const patch: PatchBundle = {
      patchsetVersion: 1,
      createdAt: new Date().toISOString(),
      target: Object.keys(target).length ? target : undefined,
      fingerprints,
      ops
    };

    await writeJsonFile(path.join(patchDir, "patch.json"), patch);
    await createZipFromDir(patchDir, outFile);
  } finally {
    await removeDir(patchDir);
  }
}
