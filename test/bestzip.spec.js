"use strict";
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");
const rimraf = require("rimraf");
const klaw = require("klaw-sync");

var unzip = require("./unzip");

const bestzip = require("../lib/bestzip");

const cli = path.join(__dirname, "../bin/cli.js");

const tmpdir = path.join(__dirname, "tmp");
const zipfile = path.join(tmpdir, "test.zip");

const testCases = [
  { cwd: "test/fixtures/", args: "*" },
  { cwd: "test/", args: "fixtures/*" },
  { cwd: "test/", args: "fixtures/" },
  { cwd: "test/fixtures", args: "file.txt" },
  { cwd: "test/fixtures", args: "obama.jpg" },
  { cwd: "test/fixtures", args: "file.txt obama.jpg" },
  { cwd: "test/fixtures", args: "file.txt .dotfile" },
  { cwd: "test/fixtures", args: "file.txt subdir" },
  { cwd: "test/fixtures", args: "subdir/subfile.txt" },
  { cwd: "test/", args: "fixtures/subdir/subfile.txt" },
  { cwd: "test/", args: "fixtures/*/*.txt" },
  { cwd: "test/fixtures/subdir", args: "../file.txt" }
];

const cleanup = () =>
  new Promise((resolve, reject) => {
    rimraf(tmpdir, err => {
      if (err) {
        return reject(err);
      }
      fs.mkdir(tmpdir, err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });

const getStructure = tmpdir => {
  // strip the tmp dir and convert to unix-style file paths on windows
  return klaw(tmpdir).map(({ path }) =>
    path.replace(tmpdir, "").replace(/\\/g, "/")
  );
};

describe("file structure", () => {
  const hasNativeZip = bestzip.hasNativeZip();

  beforeEach(cleanup);

  // these tests have known good snapshots
  // so, it's run once for bestzip against the snapshot
  // and, if bestzip used
  test.each(testCases)(
    "correct structure with relative paths: %j",
    async testCase => {
      child_process.execSync(`node ${cli} ${zipfile} ${testCase.args}`, {
        cwd: path.join(__dirname, "../", testCase.cwd)
      });

      await unzip(zipfile, tmpdir);
      const structure = getStructure(tmpdir);

      expect(structure).toMatchSnapshot();

      if (hasNativeZip) {
        await cleanup();

        // on systems *with* a native zip, this validates that both methods output the same thing (mac, linux)

        // note: this was initially two tests, but we want to match them against the same snapshot -
        // but jest doesn't allow multiple expect's to target the same snapshot, so we match the first to the snapshot
        // and match the second to the first
        child_process.execSync(
          `node ${cli} --force=node ${zipfile} ${testCase.args}`,
          { cwd: path.join(__dirname, "../", testCase.cwd) }
        );

        await unzip(zipfile, tmpdir);
        const forcedNodeStructure = getStructure(tmpdir);

        expect(forcedNodeStructure).toEqual(structure);
      }
    }
  );

  const testIfHasNativeZip = hasNativeZip ? test : test.skip;

  // we can't use snapshots here, because the absolute paths will change from one system to another
  // but, when native zip is available, we want to compare it to node zip to ensure that the outputs match
  const absolutePathTestCases = testCases.map(testCase =>
    testCase.args
      .split(" ")
      .map(arg => path.join(__dirname, "../", testCase.cwd, arg))
      .join(" ")
  );

  testIfHasNativeZip.each(absolutePathTestCases)(
    "same output between native and node zip with absolute file paths: %s",
    async args => {
      child_process.execSync(`node ${cli} --force=node ${zipfile} ${args}`);

      await unzip(zipfile, tmpdir);
      const nodeStructure = getStructure(tmpdir);

      await cleanup();

      child_process.execSync(`node ${cli} --force=native ${zipfile} ${args}`);

      await unzip(zipfile, tmpdir);
      const nativeStructure = getStructure(tmpdir);

      expect(nodeStructure).toEqual(nativeStructure);
    }
  );
});
