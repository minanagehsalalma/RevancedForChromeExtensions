import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import fg from "fast-glob";
import { ensureSafeRelPath, safeJoin, toPosixPath } from "./paths.js";

export const DEFAULT_IGNORE_PATTERNS = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  "*.map",
  "**/*.map",
  ".DS_Store",
  "Thumbs.db"
];

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function assertDirectory(dirPath: string, label: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(dirPath);
  } catch {
    throw new Error(`${label} is not a directory: ${dirPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${dirPath}`);
  }
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, payload, "utf8");
}

export async function listFiles(rootDir: string, ignore: string[] = []): Promise<string[]> {
  const entries = await fg("**/*", {
    cwd: rootDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore,
    unique: true
  });
  const files: string[] = [];
  for (const entry of entries) {
    const relPath = toPosixPath(entry);
    ensureSafeRelPath(relPath);
    const absPath = safeJoin(rootDir, relPath);
    const stat = await fs.lstat(absPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed: ${relPath}`);
    }
    if (stat.isFile()) {
      files.push(relPath);
    }
  }
  files.sort();
  return files;
}

export async function listAllFiles(rootDir: string): Promise<string[]> {
  return listFiles(rootDir, []);
}

export async function copyFileStream(srcPath: string, destPath: string): Promise<void> {
  await ensureDir(path.dirname(destPath));
  await pipeline(createReadStream(srcPath), createWriteStream(destPath));
}

export async function copyDir(srcDir: string, destDir: string): Promise<void> {
  await ensureDir(destDir);
  const files = await listAllFiles(srcDir);
  for (const relPath of files) {
    const srcPath = safeJoin(srcDir, relPath);
    const destPath = safeJoin(destDir, relPath);
    await copyFileStream(srcPath, destPath);
  }
}

export async function createTempDir(prefix: string): Promise<string> {
  const base = path.join(os.tmpdir(), prefix);
  return fs.mkdtemp(base);
}

export async function removeDir(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}
