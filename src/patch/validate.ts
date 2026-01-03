import path from "node:path";
import fs from "node:fs/promises";
import { extractZip } from "../utils/zip.js";
import { assertDirectory, readJsonFile } from "../utils/fs.js";
import { ensureSafeRelPath, isZipPath, safeJoin } from "../utils/paths.js";
import { hashFile } from "../utils/hash.js";
import type { PatchBundle, PatchOp } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label}: expected string`);
  }
}

function assertNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number") {
    throw new Error(`Invalid ${label}: expected number`);
  }
}

function validateOp(op: PatchOp, index: number): void {
  ensureSafeRelPath(op.path);
  if (op.type === "add") {
    assertString(op.payloadPath, `ops[${index}].payloadPath`);
    assertString(op.sha256, `ops[${index}].sha256`);
    ensureSafeRelPath(op.payloadPath);
  } else if (op.type === "replace") {
    assertString(op.payloadPath, `ops[${index}].payloadPath`);
    assertString(op.fromSha256, `ops[${index}].fromSha256`);
    assertString(op.toSha256, `ops[${index}].toSha256`);
    ensureSafeRelPath(op.payloadPath);
  }
}

export function validatePatchShape(patch: unknown): asserts patch is PatchBundle {
  if (!isRecord(patch)) {
    throw new Error("Invalid patch.json: expected object");
  }
  assertNumber(patch.patchsetVersion, "patchsetVersion");
  assertString(patch.createdAt, "createdAt");
  if (!isRecord(patch.fingerprints)) {
    throw new Error("Invalid patch.json: fingerprints must be an object");
  }
  if (!("manifest.json" in patch.fingerprints)) {
    throw new Error("Invalid patch.json: fingerprints must include manifest.json");
  }
  if (!Array.isArray(patch.ops)) {
    throw new Error("Invalid patch.json: ops must be an array");
  }
  for (const [key, value] of Object.entries(patch.fingerprints)) {
    ensureSafeRelPath(key);
    assertString(value, `fingerprints.${key}`);
  }
  patch.ops.forEach((op: PatchOp, index: number) => {
    if (!isRecord(op) || typeof op.type !== "string" || typeof op.path !== "string") {
      throw new Error(`Invalid ops[${index}] entry`);
    }
    if (op.type !== "delete" && op.type !== "add" && op.type !== "replace") {
      throw new Error(`Invalid ops[${index}].type: ${op.type}`);
    }
    validateOp(op as PatchOp, index);
  });
}

export async function loadPatchBundle(patchZipPath: string, tempRoot: string): Promise<{ patch: PatchBundle; patchDir: string }> {
  const patchDir = path.join(tempRoot, "patch");
  await extractZip(patchZipPath, patchDir);
  const patchPath = path.join(patchDir, "patch.json");
  const patch = await readJsonFile<PatchBundle>(patchPath);
  validatePatchShape(patch);
  return { patch, patchDir };
}

export async function prepareInputSource(inputPath: string, tempRoot: string): Promise<{ inputDir: string; cleanup: boolean }> {
  const resolved = path.resolve(inputPath);
  if (isZipPath(resolved)) {
    const inputDir = path.join(tempRoot, "input");
    await extractZip(resolved, inputDir);
    return { inputDir, cleanup: true };
  }
  await assertDirectory(resolved, "Input");
  return { inputDir: resolved, cleanup: false };
}

export async function validateTargetAndFingerprints(patch: PatchBundle, inputDir: string): Promise<void> {
  const manifestPath = safeJoin(inputDir, "manifest.json");
  let manifest: { manifest_version?: number; version?: string };
  try {
    manifest = await readJsonFile(manifestPath);
  } catch {
    throw new Error("manifest.json is missing or invalid");
  }

  if (patch.target?.manifest_version !== undefined && manifest.manifest_version !== patch.target.manifest_version) {
    throw new Error(
      `manifest_version mismatch: expected ${patch.target.manifest_version}, got ${manifest.manifest_version ?? "missing"}`
    );
  }
  if (patch.target?.version !== undefined && manifest.version !== patch.target.version) {
    throw new Error(`version mismatch: expected ${patch.target.version}, got ${manifest.version ?? "missing"}`);
  }

  for (const [relPath, expectedHash] of Object.entries(patch.fingerprints)) {
    ensureSafeRelPath(relPath);
    const absPath = safeJoin(inputDir, relPath);
    let stat;
    try {
      stat = await fs.lstat(absPath);
    } catch {
      throw new Error(`Missing required file for fingerprint: ${relPath}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink not allowed in input: ${relPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Fingerprint target is not a file: ${relPath}`);
    }
    const actual = await hashFile(absPath);
    if (actual !== expectedHash) {
      throw new Error(`Fingerprint mismatch for ${relPath}: expected ${expectedHash}, got ${actual}`);
    }
  }
}
