import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
import { canCreateSymlinks, init, readZipEntries } from "./helpers.js";

const S_IFREG = 0o100000;

const { tmpdir } = init("symlink_default_behavior");
const cwd = path.join(tmpdir, "cwd");
const targetFile = path.join(cwd, "target.txt");
const vendorDir = path.join(cwd, "vendor");
const archiveDir = path.join(cwd, "archive-me");
const linkToFile = path.join(archiveDir, "link.txt");
const linkToDir = path.join(archiveDir, "vendor");
const topLink = path.join(cwd, "top-link.txt");
const topDirLink = path.join(cwd, "vendor-link");
const destination = path.join(cwd, "out.zip");

const TARGET_CONTENTS = "the target file contents";

const setup = () => {
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.writeFileSync(targetFile, TARGET_CONTENTS);
  fs.writeFileSync(path.join(vendorDir, "vendored.txt"), "from vendor dir");
  try {
    fs.symlinkSync(targetFile, topLink);
  } catch (e) {
    // already exists
  }
  try {
    fs.symlinkSync(vendorDir, topDirLink, "dir");
  } catch (e) {
    // already exists
  }
  try {
    fs.symlinkSync(targetFile, linkToFile);
  } catch (e) {
    // already exists
  }
  try {
    fs.symlinkSync(vendorDir, linkToDir, "dir");
  } catch (e) {
    // already exists
  }
};

// The default (unset) nodeZip behavior must match the native zip
// implementation: symlinks are followed, so their target contents are
// archived and symlinked directories are recursed into. These tests lock in
// that parity, so nodeZip and nativeZip agree when followSymLinks is unset.
describe(
  "default (unset) nodeZip symlink behavior",
  { skip: !canCreateSymlinks() },
  () => {
    beforeEach(() => {
      fs.rmSync(tmpdir, { recursive: true, force: true });
      fs.mkdirSync(cwd, { recursive: true });
      setup();
    });
    after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

    test("follows a file symlink inside a walked directory", async (t) => {
      const warn = t.mock.method(console, "warn", () => {});
      await bestzip.nodeZip({ cwd, source: "archive-me/", destination });
      const entries = readZipEntries(destination);
      assert.equal(entries["archive-me/link.txt"].type, S_IFREG);
      assert.equal(
        entries["archive-me/link.txt"].data.toString(),
        TARGET_CONTENTS
      );
      assert.ok(entries["archive-me/vendor/vendored.txt"]);
      assert.ok(warn.mock.calls.length > 0);
      assert.ok(
        warn.mock.calls
          .map((c) => c.arguments.join(" "))
          .join(" ")
          .includes("Symbolic links are followed by default")
      );
    });

    test("follows a top-level symlink source", async (t) => {
      const warn = t.mock.method(console, "warn", () => {});
      await bestzip.nodeZip({ cwd, source: "top-link.txt", destination });
      const entries = readZipEntries(destination);
      assert.equal(entries["top-link.txt"].type, S_IFREG);
      assert.equal(entries["top-link.txt"].data.toString(), TARGET_CONTENTS);
      assert.ok(warn.mock.calls.length > 0);
    });

    test("recurses into a top-level symlinked directory", async (t) => {
      const warn = t.mock.method(console, "warn", () => {});
      await bestzip.nodeZip({ cwd, source: "vendor-link", destination });
      const entries = readZipEntries(destination);
      assert.equal(entries["vendor-link/vendored.txt"].type, S_IFREG);
      assert.equal(
        entries["vendor-link/vendored.txt"].data.toString(),
        "from vendor dir"
      );
      assert.ok(warn.mock.calls.length > 0);
    });
  }
);
