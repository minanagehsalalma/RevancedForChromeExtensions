import path from "node:path";

export function toPosixPath(inputPath: string): string {
  return inputPath.replace(/\\/g, "/");
}

export function ensureSafeRelPath(relPath: string): void {
  const posixPath = toPosixPath(relPath);
  if (posixPath.includes("\0")) {
    throw new Error(`Invalid path contains null byte: ${relPath}`);
  }
  if (!posixPath || posixPath === ".") {
    throw new Error(`Empty paths are not allowed`);
  }
  if (posixPath.startsWith("/")) {
    throw new Error(`Absolute paths are not allowed: ${relPath}`);
  }
  if (/^[a-zA-Z]:/.test(posixPath)) {
    throw new Error(`Drive paths are not allowed: ${relPath}`);
  }
  const segments = posixPath.split("/");
  for (const segment of segments) {
    if (!segment) {
      throw new Error(`Invalid path segment in: ${relPath}`);
    }
    if (segment === "..") {
      throw new Error(`Path traversal is not allowed: ${relPath}`);
    }
  }
}

export function safeJoin(rootDir: string, relPosixPath: string): string {
  ensureSafeRelPath(relPosixPath);
  const relNative = toPosixPath(relPosixPath).split("/").join(path.sep);
  const rootResolved = path.resolve(rootDir);
  const targetResolved = path.resolve(rootResolved, relNative);
  const relative = path.relative(rootResolved, targetResolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root: ${relPosixPath}`);
  }
  return targetResolved;
}

export function isZipPath(targetPath: string): boolean {
  return path.extname(targetPath).toLowerCase() === ".zip";
}
