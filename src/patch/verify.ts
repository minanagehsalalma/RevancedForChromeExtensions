import path from "node:path";
import { createTempDir, removeDir } from "../utils/fs.js";
import { loadPatchBundle, prepareInputSource, validateTargetAndFingerprints } from "./validate.js";

interface VerifyOptions {
  patchZip: string;
  input: string;
}

export async function verifyPatch(options: VerifyOptions): Promise<void> {
  const patchZip = path.resolve(options.patchZip);
  const input = path.resolve(options.input);
  const tempRoot = await createTempDir("extpatcher-verify-");

  try {
    const { patch } = await loadPatchBundle(patchZip, tempRoot);
    const { inputDir } = await prepareInputSource(input, tempRoot);
    await validateTargetAndFingerprints(patch, inputDir);
  } finally {
    await removeDir(tempRoot);
  }
}
