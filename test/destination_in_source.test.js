// https://github.com/nfriedly/node-bestzip/issues/94 — zipping a directory into
// an archive inside that same directory produced a corrupt archive containing
// a truncated copy of itself.
// https://github.com/nfriedly/node-bestzip/issues/39 — bestZip (probably nodeZip) never
// terminated, because it kept reading the archive it was still writing.
// Same root cause: the destination is created before the sources are walked,
// and nothing stopped the destination from being one of those sources.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
import { readZipEntries } from "./helpers.js";

const RUNS_NATIVE = bestzip.hasNativeZip();
// nativeZip() throws when the platform's zip can't store symlinks as links and
// followSymLinks is unset — which would skip these cases on the Windows build
// of Info-ZIP, i.e. exactly where #39 was reported. None of the fixtures here
// contain symlinks, so passing followSymLinks: true satisfies the check and
// keeps the native cases running everywhere.
const NATIVE_SKIP = !RUNS_NATIVE;
const NATIVE_OPTIONS = { followSymLinks: true };

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-destination-"));
const cwd = path.join(tmpdir, "app");
const nestedCwd = path.join(cwd, "dist", "app");
const outsideDestination = path.join(tmpdir, "outside.zip");
const cli = path.join(import.meta.dirname, "../bin/cli.js");

// A file that shares the destination's basename but is not the destination.
// Excluding the destination has to be an exact path match, not a name match.
const DECOY = "dist/nested/app.zip";
const DECOY_CONTENTS = "this is not an archive";

const setup = () => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
  fs.mkdirSync(nestedCwd, { recursive: true });
  fs.mkdirSync(path.dirname(path.join(cwd, DECOY)), { recursive: true });
  fs.writeFileSync(path.join(cwd, "a.txt"), "aaa\n");
  fs.writeFileSync(path.join(cwd, "b.txt"), "bbbbbbbb\n");
  fs.writeFileSync(path.join(cwd, DECOY), DECOY_CONTENTS);
  fs.writeFileSync(path.join(nestedCwd, "c.txt"), "ccc\n");
  fs.writeFileSync(path.join(nestedCwd, "d.txt"), "dddd\n");
};

// #94 grew the archive without bound and #39 never returned, so every zip call
// gets a deadline rather than being trusted to finish.
const DEADLINE_MS = 20 * 1000;
const withDeadline = (promise, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () =>
          reject(new Error(`${what} did not finish within ${DEADLINE_MS}ms`)),
        DEADLINE_MS
      ).unref();
    }),
  ]);

const readArchive = (destination, expected, contents) => {
  // Throws if the archive is truncated/corrupt, which is the #94 symptom.
  const entries = readZipEntries(destination);
  assert.deepEqual(Object.keys(entries).sort(), [...expected].sort());
  for (const [name, data] of Object.entries(contents)) {
    assert.equal(entries[name].data.toString(), data);
  }
};

const everything = [
  "a.txt",
  "b.txt",
  DECOY,
  "dist/app/c.txt",
  "dist/app/d.txt",
];
const appDir = ["dist/app/c.txt", "dist/app/d.txt"];

const testCases = [
  {
    name: "destination matched directly by the source glob",
    source: "*",
    destination: "app.zip",
    expected: everything,
    contents: { "a.txt": "aaa\n", [DECOY]: DECOY_CONTENTS },
  },
  {
    name: "destination matched by a directory glob",
    source: "dist/app/*",
    destination: "dist/app/app.zip",
    expected: appDir,
    contents: { "dist/app/c.txt": "ccc\n" },
  },
  {
    name: "destination reached by directory recursion",
    source: "dist/app",
    destination: "dist/app/app.zip",
    expected: appDir,
    contents: { "dist/app/d.txt": "dddd\n" },
  },
  {
    name: "destination spelled with a leading ./",
    source: "*",
    destination: "./app.zip",
    expected: everything,
    contents: { "b.txt": "bbbbbbbb\n" },
  },
  {
    name: "destination spelled with .. segments from a nested cwd",
    cwd: nestedCwd,
    source: "*",
    destination: "../app/app.zip",
    expected: ["c.txt", "d.txt"],
    contents: { "c.txt": "ccc\n" },
  },
  {
    name: "destination beside the source directory",
    source: "dist/app/*",
    destination: "dist/app.zip",
    expected: appDir,
    contents: { "dist/app/d.txt": "dddd\n" },
  },
  {
    // Regression guard: an ordinary zip, with the destination nowhere near the
    // sources, must still archive everything it is pointed at.
    name: "destination outside the source directory",
    source: "dist/app/*",
    destination: outsideDestination,
    expected: appDir,
    contents: { "dist/app/c.txt": "ccc\n", "dist/app/d.txt": "dddd\n" },
  },
];

const implementations = [
  { name: "nodeZip", skip: false, zip: bestzip.nodeZip },
  { name: "nativeZip", skip: NATIVE_SKIP, zip: bestzip.nativeZip },
];

describe("destination inside the source directory", () => {
  beforeEach(setup);
  after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

  for (const { name, skip, zip } of implementations) {
    for (const testCase of testCases) {
      test(`${name}: ${testCase.name}`, { skip }, async () => {
        const options = {
          cwd: testCase.cwd || cwd,
          source: testCase.source,
          destination: testCase.destination,
          ...(name === "nativeZip" ? NATIVE_OPTIONS : {}),
        };
        // Twice: the first run creates the destination, so the second run's
        // source walk finds an archive to mistake for a source. That is the
        // run that hung on the native path (#39) and produced the truncated
        // copy of the archive (#94).
        for (const attempt of [1, 2]) {
          await withDeadline(
            zip(options),
            `${name} (${JSON.stringify(options)}, attempt ${attempt})`
          );
          readArchive(
            path.resolve(options.cwd, options.destination),
            testCase.expected,
            testCase.contents
          );
        }
      });
    }
  }

  // The repro from #39, run through the CLI, with a hard deadline: a native zip
  // that is allowed to read its own output does not return, so kill it rather
  // than let it hang the suite.
  test(
    "cli --force=native: destination inside the source directory terminates",
    { skip: NATIVE_SKIP, timeout: 4 * DEADLINE_MS },
    () => {
      for (const attempt of [1, 2]) {
        const result = spawnSync(
          process.execPath,
          [cli, "--force=native", "--follow-sym-links", "app.zip", "*"],
          {
            cwd,
            encoding: "utf8",
            timeout: DEADLINE_MS,
          }
        );
        assert.equal(
          result.error,
          undefined,
          `attempt ${attempt}: ${result.error && result.error.message}`
        );
        assert.equal(result.status, 0, result.stderr);
        readArchive(path.join(cwd, "app.zip"), everything, {
          "a.txt": "aaa\n",
          [DECOY]: DECOY_CONTENTS,
        });
      }
    }
  );
});
