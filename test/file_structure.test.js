import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { describe, test, before, beforeEach, after } from "node:test";
import klaw from "klaw-sync";
import { canCreateSymlinks, init } from "./helpers.js";

const { tmpdir, destination, reset, cleanup } = init("file_structure");
const __dirname = import.meta.dirname;

import unzip from "./unzip.js";

import * as bestzip from "../lib/bestzip.js";

const cli = path.join(__dirname, "../bin/cli.js");

const symlinksAvailable = canCreateSymlinks();

const testCases = [
  { cwd: "test/fixtures/", source: "*" }, // no .dotfiles
  { cwd: "test/fixtures/", source: "./" }, // include .dotfiles
  { cwd: "test/", source: "fixtures/*" },
  { cwd: "test/", source: "fixtures/" },
  { cwd: "test/fixtures", source: "obama.jpg" },
  { cwd: "test/fixtures", source: ["file.txt", "obama.jpg"] },
  { cwd: "test/fixtures", source: ["file.txt", ".dotfile"] },
  { cwd: "test/fixtures", source: ["file.txt", "subdir"] },
  { cwd: "test/fixtures", source: "subdir/subfile.txt" },
  { cwd: "test/", source: "fixtures/subdir/subfile.txt" },
  { cwd: "test/", source: "fixtures/*/*.txt" },
  { cwd: "test/fixtures/subdir", source: "../file.txt" },
  { cwd: "test/fixtures/", source: "file-symlink.txt" },
  { cwd: "test/fixtures", source: "file.txt" },
];

// Test cases whose expected output includes symlink entries; they only run when
// symlinks can actually be created on the host.
const symlinkKey = (source, cwd) => JSON.stringify({ cwd, source });
const symlinkDependent = new Set(
  [
    { source: "*", cwd: "test/fixtures/" },
    { source: "./", cwd: "test/fixtures/" },
    { source: "fixtures/*", cwd: "test/" },
    { source: "fixtures/", cwd: "test/" },
    { source: "fixtures/*/*.txt", cwd: "test/" },
    { source: "file-symlink.txt", cwd: "test/fixtures/" },
  ].map(({ source, cwd }) => symlinkKey(source, cwd))
);
const isSymlinkDependent = (source, cwd) =>
  symlinkDependent.has(symlinkKey(source, cwd));

const getStructure = (tmpdir) => {
  // strip the tmp dir and convert to unix-style file paths on windows
  return klaw(tmpdir).map(({ path }) =>
    path.replace(tmpdir, "").replace(/\\/g, "/")
  );
};

const createSymlink = () => {
  if (!symlinksAvailable) {
    return;
  }
  if (!fs.existsSync(path.resolve("test/fixtures/subdir-symlink"))) {
    try {
      fs.symlinkSync(
        path.resolve("test/fixtures/subdir/"),
        path.resolve("test/fixtures/subdir-symlink"),
        "dir"
      );
    } catch (e) {
      if (e.code !== "EEXIST") {
        throw e;
      }
    }
  }
  if (!fs.existsSync(path.resolve("test/fixtures/file-symlink.txt"))) {
    try {
      fs.symlinkSync(
        path.resolve("test/fixtures/file.txt"),
        path.resolve("test/fixtures/file-symlink.txt"),
        "file"
      );
    } catch (e) {
      if (e.code !== "EEXIST") {
        throw e;
      }
    }
  }
};

const symlinkOpts = (testCase) =>
  isSymlinkDependent(testCase.source, testCase.cwd) && !symlinksAvailable
    ? { skip: true }
    : undefined;

const symlinkStyles = [
  {
    name: "default follow symlinks",
    cli,
    testCases,
  },
  {
    name: "no follow symlinks",
    cli: `${cli} --no-follow-sym-links`,
    testCases: testCases.map((testCase) => ({
      ...testCase,
      followSymLinks: false,
    })),
  },
  {
    name: "follow symlinks",
    cli: `${cli} --follow-sym-links`,
    testCases: testCases.map((testCase) => ({
      ...testCase,
      followSymLinks: true,
    })),
  },
];

for (const { name, cli, testCases } of symlinkStyles) {
  describe("file structure - " + name, () => {
    const hasNativeZip = bestzip.hasNativeZip();

    before(createSymlink);
    beforeEach(reset);
    after(cleanup);

    // these tests have known good snapshots
    // so, it's run once for bestzip against the snapshot
    // and, if bestzip used
    for (const testCase of testCases) {
      test(
        `cli: ${JSON.stringify(testCase)}`,
        symlinkOpts(testCase),
        async (t) => {
          const sourceArgs =
            typeof testCase.source === "string"
              ? testCase.source
              : testCase.source.join(" ");

          child_process.execSync(`node ${cli} ${destination} ${sourceArgs}`, {
            cwd: path.join(__dirname, "../", testCase.cwd),
          });

          await unzip(destination, tmpdir);
          const structure = getStructure(tmpdir);

          t.assert.snapshot(structure);

          // because multiple tests aren't allowed to match the same snapshot,
          // but we do want to ensure that they all create the same output
          testCase.structure = structure;
        }
      );
    }

    for (const testCase of testCases) {
      test(
        `cli with --force=node: ${JSON.stringify(testCase)}`,
        symlinkOpts(testCase),
        async (t) => {
          const sourceArgs =
            typeof testCase.source === "string"
              ? testCase.source
              : testCase.source.join(" ");

          child_process.execSync(
            `node ${cli} --force=node ${destination} ${sourceArgs}`,
            { cwd: path.join(__dirname, "../", testCase.cwd) }
          );

          await unzip(destination, tmpdir);
          const structure = getStructure(tmpdir);

          t.assert.snapshot(structure);

          // on systems *with* a native zip, this validates that both methods output the same thing (mac, linux)
          if (testCase.structure) {
            assert.deepEqual(structure, testCase.structure);
          } else {
            // the structure is defined in the first test run, so it may not be defined when running subsets of tests
            console.log("skipping structure match");
          }
        }
      );
    }

    for (const testCase of testCases) {
      test(
        `programmatic: ${JSON.stringify(testCase)}`,
        symlinkOpts(testCase),
        async (t) => {
          await bestzip.zip(
            Object.assign(
              { destination, cwd: path.join(__dirname, "../", testCase.cwd) },
              testCase
            )
          );
          await unzip(destination, tmpdir);
          const structure = getStructure(tmpdir);

          t.assert.snapshot(structure);

          if (testCase.structure) {
            assert.deepEqual(structure, testCase.structure);
          } else {
            // the structure is defined in the first test run, so it may not be defined when running subsets of tests
            console.log("skipping structure match");
          }
        }
      );
    }

    for (const testCase of testCases) {
      test(
        `programmatic with nodeZip: ${JSON.stringify(testCase)}`,
        symlinkOpts(testCase),
        async (t) => {
          await bestzip.nodeZip(
            Object.assign(
              { destination, cwd: path.join(__dirname, "../", testCase.cwd) },
              testCase
            )
          );
          await unzip(destination, tmpdir);
          const structure = getStructure(tmpdir);

          t.assert.snapshot(structure);

          // on systems *with* a native zip, this validates that both methods output the same thing (mac, linux)
          if (testCase.structure) {
            assert.deepEqual(structure, testCase.structure);
          } else {
            // the structure is defined in the first test run, so it may not be defined when running subsets of tests
            console.log("skipping structure match");
          }
        }
      );
    }

    // we can't use snapshots here, because the absolute paths will change from one system to another
    // but, when native zip is available, we want to compare it to node zip to ensure that the outputs match
    const absolutePathTestCases = testCases.map((testCase) => ({
      args: (Array.isArray(testCase.source)
        ? testCase.source
        : [testCase.source]
      )
        .map((arg) => path.join(testCase.cwd, arg))
        .join(" "),
      symlink: isSymlinkDependent(testCase.source, testCase.cwd),
    }));

    // The native-vs-node comparison only works when the native zip can actually
    // participate — it must support --symlinks (or followSymLinks must be set).
    // On platforms like Windows where Info-ZIP lacks --symlinks, nativeZip will
    // throw, so skip every case.
    const nativeUnsupported = !bestzip.nativeZipSupportsSymlinks();

    for (const { args, symlink } of absolutePathTestCases) {
      test(
        `same output between native and node zip with absolute file paths: ${args}`,
        {
          skip:
            !hasNativeZip ||
            nativeUnsupported ||
            (symlink && !symlinksAvailable),
        },
        async () => {
          child_process.execSync(
            `node ${cli} --force=node ${destination} ${args}`
          );

          await unzip(destination, tmpdir);
          const nodeStructure = getStructure(tmpdir);

          await reset();

          child_process.execSync(
            `node ${cli} --force=native ${destination} ${args}`
          );

          await unzip(destination, tmpdir);
          const nativeStructure = getStructure(tmpdir);

          assert.deepEqual(nodeStructure, nativeStructure);
        }
      );
    }
  });
}
