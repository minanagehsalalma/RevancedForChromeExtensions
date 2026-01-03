import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { ensureDir, listAllFiles } from "./fs.js";
import { ensureSafeRelPath, safeJoin, toPosixPath } from "./paths.js";

const FIXED_ZIP_MTIME = new Date("2000-01-01T00:00:00Z");

export async function extractZip(zipPath: string, outDir: string): Promise<void> {
  await ensureDir(outDir);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr || !zipfile) {
        reject(openErr ?? new Error(`Unable to open zip: ${zipPath}`));
        return;
      }

      const onError = (err: Error) => {
        zipfile.close();
        reject(err);
      };

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const entryName = toPosixPath(entry.fileName);
        if (entryName.endsWith("/")) {
          try {
            ensureSafeRelPath(entryName.slice(0, -1));
          } catch (err) {
            onError(err as Error);
            return;
          }
          const dirPath = safeJoin(outDir, entryName.slice(0, -1));
          ensureDir(dirPath)
            .then(() => zipfile.readEntry())
            .catch(onError);
          return;
        }

        try {
          ensureSafeRelPath(entryName);
        } catch (err) {
          onError(err as Error);
          return;
        }

        const destPath = safeJoin(outDir, entryName);
        ensureDir(path.dirname(destPath))
          .then(() => {
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr || !readStream) {
                onError(streamErr ?? new Error(`Unable to read entry ${entryName}`));
                return;
              }
              const writeStream = createWriteStream(destPath);
              pipeline(readStream, writeStream)
                .then(() => zipfile.readEntry())
                .catch(onError);
            });
          })
          .catch(onError);
      });

      zipfile.on("end", () => {
        zipfile.close();
      });
      zipfile.on("close", resolve);
      zipfile.on("error", onError);
    });
  });
}

export async function createZipFromDir(sourceDir: string, outZipPath: string): Promise<void> {
  await ensureDir(path.dirname(outZipPath));
  const zipfile = new yazl.ZipFile();
  const outputStream = createWriteStream(outZipPath);
  const outputPromise = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.pipe(outputStream).on("close", resolve).on("error", reject);
  });

  const files = await listAllFiles(sourceDir);
  for (const relPath of files) {
    ensureSafeRelPath(relPath);
    const absPath = safeJoin(sourceDir, relPath);
    zipfile.addFile(absPath, relPath, { mtime: FIXED_ZIP_MTIME, mode: 0o644 });
  }

  zipfile.end();
  await outputPromise;
}
