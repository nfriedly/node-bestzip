// https://github.com/nfriedly/node-bestzip/issues/48 — `cd dist && bestzip ../dist.zip .`
// produced entries named `./index.js`, `./build/...` instead of `index.js`, `build/...`.
// The reporter saw it on Windows (cmd/powershell) but not msys2/cygwin; it is not
// platform-specific — nodeZip uses the source string verbatim as the archive-name
// prefix, so a source of `.` leaks into every entry. Native zip emits clean names.
//
// Native zip is the reference here: these tests assert the entry names it produces,
// so they also run on platforms with no native zip (e.g. Windows CI) with the
// nativeZip cases skipped.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
import { readZipEntries } from "./helpers.js";

const RUNS_NATIVE = bestzip.hasNativeZip();
const NATIVE_SKIP = !RUNS_NATIVE;
// See destination_in_source.test.js: nativeZip() throws on platforms whose zip
// cannot store symlinks as links (the Windows build of Info-ZIP) unless
// followSymLinks is set. These fixtures have no symlinks, so this just keeps the
// native comparison running everywhere it can run at all.
const NATIVE_OPTIONS = { followSymLinks: true };

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-dot-prefix-"));
const cwd = path.join(tmpdir, "dist");
const destination = path.join(tmpdir, "out.zip");
const cli = path.join(import.meta.dirname, "../bin/cli.js");

// readZipEntries drops directory entries (names ending in "/"), so this lists
// the files only — enough to catch a leading "./" on every entry.
const EXPECTED_FILES = ["build/a.js", "index.js"];

const setup = () => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
  fs.mkdirSync(path.join(cwd, "build"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "index.js"), "index\n");
  fs.writeFileSync(path.join(cwd, "build/a.js"), "aaa\n");
};

// Asserts on entry names rather than extracted output, because extracting
// "./index.js" and "index.js" both produce dist/index.js on disk — the redundant
// prefix is only visible in the archive itself (and in 7-Zip's "./" entry, which
// is what the reporter in #48 saw).
const assertCleanNames = (zipPath) => {
  const entries = readZipEntries(zipPath);
  assert.deepEqual(Object.keys(entries).sort(), EXPECTED_FILES);
  for (const name of Object.keys(entries)) {
    assert.ok(
      !name.startsWith("./"),
      `entry name should not start with "./": ${JSON.stringify(name)}`
    );
  }
  assert.equal(entries["index.js"].data.toString(), "index\n");
  assert.equal(entries["build/a.js"].data.toString(), "aaa\n");
};

describe("#48: a source of . should not add a ./ prefix to entry names", () => {
  beforeEach(setup);
  after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

  for (const source of [".", "./"]) {
    test(`nodeZip: source ${JSON.stringify(source)}`, async () => {
      await bestzip.nodeZip({ cwd, source, destination });
      assertCleanNames(destination);
    });

    test(
      `nativeZip: source ${JSON.stringify(source)}`,
      { skip: NATIVE_SKIP },
      async () => {
        await bestzip.nativeZip({
          cwd,
          source,
          destination,
          ...NATIVE_OPTIONS,
        });
        assertCleanNames(destination);
      }
    );
  }

  // The repro from #48 through the CLI. (The report shows `bestzip . ../dist.zip`,
  // but bestzip takes the destination first; source first is parsed as a
  // destination and fails outright, which is a separate thing.)
  test("cli --force=node: cd dist && bestzip ../dist.zip .", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "--force=node", path.relative(cwd, destination), "."],
      { cwd, encoding: "utf8", timeout: 20 * 1000 }
    );
    assert.equal(result.status, 0, result.stderr);
    assertCleanNames(destination);
  });

  // Regression guard: an explicitly named directory keeps its name as the
  // prefix, so a fix for #48 must not strip prefixes that are real. `./dist` is
  // the same directory and must land in the same place, since native zip
  // normalizes the leading "./" rather than storing it.
  for (const source of ["dist", "./dist", "./dist/"]) {
    test(`nodeZip: source ${JSON.stringify(
      source
    )} still prefixes entries`, async () => {
      await bestzip.nodeZip({ cwd: tmpdir, source, destination });
      assert.deepEqual(Object.keys(readZipEntries(destination)).sort(), [
        "dist/build/a.js",
        "dist/index.js",
      ]);
    });

    test(
      `nativeZip: source ${JSON.stringify(source)} still prefixes entries`,
      { skip: NATIVE_SKIP },
      async () => {
        await bestzip.nativeZip({
          cwd: tmpdir,
          source,
          destination,
          ...NATIVE_OPTIONS,
        });
        assert.deepEqual(Object.keys(readZipEntries(destination)).sort(), [
          "dist/build/a.js",
          "dist/index.js",
        ]);
      }
    );
  }
});
