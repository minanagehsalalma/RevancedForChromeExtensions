#!/usr/bin/env node
import { Command } from "commander";
import { makePatch } from "./patch/make.js";
import { applyPatch } from "./patch/apply.js";
import { verifyPatch } from "./patch/verify.js";

const program = new Command();

program.name("extpatcher").description("ReVanced-style patch generator and patcher for unpacked Chrome extensions.").version("0.1.0");

program
  .command("make")
  .description("Generate a patch bundle from an original and modified extension.")
  .requiredOption("--original <dir>", "Original unpacked extension directory")
  .requiredOption("--modified <dir>", "Modified unpacked extension directory")
  .requiredOption("--out <patch-bundle.zip>", "Output patch bundle zip")
  .action(async (opts: { original: string; modified: string; out: string }) => {
    try {
      await makePatch({ originalDir: opts.original, modifiedDir: opts.modified, outFile: opts.out });
      console.log(`Patch bundle created at ${opts.out}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

program
  .command("apply")
  .description("Apply a patch bundle to an original extension directory or zip.")
  .requiredOption("--patch <patch-bundle.zip>", "Patch bundle zip")
  .requiredOption("--in <dir|zip>", "Input original directory or zip")
  .requiredOption("--out <dir|zip>", "Output directory or zip")
  .option("--check-against <dir>", "Compare output against a directory after applying")
  .action(
    async (opts: { patch: string; in: string; out: string; checkAgainst?: string }) => {
      try {
        await applyPatch({
          patchZip: opts.patch,
          input: opts.in,
          output: opts.out,
          checkAgainst: opts.checkAgainst
        });
        console.log(`Patch applied to ${opts.out}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    }
  );

program
  .command("verify")
  .description("Verify that a patch bundle matches an original extension input.")
  .requiredOption("--patch <patch-bundle.zip>", "Patch bundle zip")
  .requiredOption("--in <dir|zip>", "Input original directory or zip")
  .action(async (opts: { patch: string; in: string }) => {
    try {
      await verifyPatch({ patchZip: opts.patch, input: opts.in });
      console.log("Verification successful.");
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
