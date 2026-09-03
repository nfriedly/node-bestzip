import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
import { canCreateSymlinks, init, readZipEntries } from "./helpers.js";

const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

// readlink() and archiver return symlink targets with platform-specific
// separators (Windows may use "/" even though the filesystem uses "\"), so
// normalize when comparing raw target paths.
const normalizeSlashes = (p) => p.replaceAll("\\", "/");

const { tmpdir } = init("symlink_option");
const cwd = path.join(tmpdir, "cwd");
const targetFile = path.join(cwd, "target.txt");
const vendorDir = path.join(cwd, "vendor");
const archiveDir = path.join(cwd, "archive-me");
const linkToFile = path.join(archiveDir, "link.txt");
const linkToDir = path.join(archiveDir, "vendor");
const topLink = path.join(cwd, "top-link.txt");
const topDirLink = path.join(cwd, "vendor-link");
const destination = path.join(cwd, "out.zip");
const cli = path.join(import.meta.dirname, "../bin/cli.js");

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
    fs.symlinkSync(targetFile, linkToFile);
  } catch (e) {
    // already exists
  }
  try {
    fs.symlinkSync(vendorDir, linkToDir, "dir");
  } catch (e) {
    // already exists
  }
  try {
    fs.symlinkSync(vendorDir, topDirLink, "dir");
  } catch (e) {
    // already exists
  }
};

describe("symlink option", { skip: !canCreateSymlinks() }, () => {
  const hasNativeZip = bestzip.hasNativeZip();
  const nativeStoresLinks = bestzip.nativeZipSupportsSymlinks();

  beforeEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    setup();
  });
  after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

  test("followSymLinks: true follows symlinks (nodeZip)", async () => {
    await bestzip.nodeZip({
      cwd,
      source: "archive-me/",
      destination,
      followSymLinks: true,
    });
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/link.txt"].type, S_IFREG);
    assert.equal(
      entries["archive-me/link.txt"].data.toString(),
      TARGET_CONTENTS
    );
    assert.ok(entries["archive-me/vendor/vendored.txt"]);
  });

  test("followSymLinks: false stores symlinks as links (nodeZip)", async () => {
    await bestzip.nodeZip({
      cwd,
      source: "archive-me/",
      destination,
      followSymLinks: false,
    });
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/link.txt"].type, S_IFLNK);
    assert.equal(entries["archive-me/vendor"].type, S_IFLNK);
    // link data is the raw target path, not the file contents
    assert.equal(
      normalizeSlashes(entries["archive-me/link.txt"].data.toString()),
      normalizeSlashes(targetFile)
    );
    assert.equal(entries["archive-me/target.txt"], undefined);

    // the target itself is not included via the symlink
    assert.deepEqual(entries["archive-me/vendor/vendored.txt"], undefined);
  });

  // FollowSymLinks is honored for a top-level symlink source, not just for
  // symlinks encountered while walking a directory.
  test("followSymLinks: false stores a top-level symlink source as a link (nodeZip)", async () => {
    await bestzip.nodeZip({
      cwd,
      source: "top-link.txt",
      destination,
      followSymLinks: false,
    });
    const entries = readZipEntries(destination);
    assert.equal(entries["top-link.txt"].type, S_IFLNK);
    assert.equal(
      normalizeSlashes(entries["top-link.txt"].data.toString()),
      normalizeSlashes(targetFile)
    );
  });

  test("followSymLinks: false stores a top-level symlinked dir as a link (nodeZip)", async () => {
    await bestzip.nodeZip({
      cwd,
      source: "vendor-link",
      destination,
      followSymLinks: false,
    });
    const entries = readZipEntries(destination);
    assert.equal(entries["vendor-link"].type, S_IFLNK);
    assert.deepEqual(entries["vendor-link/vendored.txt"], undefined);
  });

  test("followSymLinks: true follows a top-level symlink source (nodeZip)", async () => {
    await bestzip.nodeZip({
      cwd,
      source: "top-link.txt",
      destination,
      followSymLinks: true,
    });
    const entries = readZipEntries(destination);
    assert.equal(entries["top-link.txt"].type, S_IFREG);
    assert.equal(entries["top-link.txt"].data.toString(), TARGET_CONTENTS);
  });

  test(
    "followSymLinks: false stores symlinks as links (nativeZip)",
    { skip: !hasNativeZip || !nativeStoresLinks },
    async () => {
      await bestzip.nativeZip({
        cwd,
        source: "archive-me/",
        destination,
        followSymLinks: false,
      });
      const entries = readZipEntries(destination);
      assert.equal(entries["archive-me/link.txt"].type, S_IFLNK);
      assert.deepEqual(entries["archive-me/vendor/vendored.txt"], undefined);
    }
  );

  test(
    "the main bestzip() entry point routes to nodeZip when the native zip can't store symlinks",
    { skip: process.platform === "win32" },
    async () => {
      const out = runWithIncapableZip("route");
      assert.equal(out.supports, false);
      assert.equal(out.linkType, S_IFLNK);
      assert.equal(out.vendorType, S_IFLNK);
      assert.equal(out.linkTarget, targetFile);
    }
  );

  test(
    "nativeZip throws when the native zip can't store symlinks and followSymLinks: false",
    { skip: process.platform === "win32" },
    async () => {
      const out = runWithIncapableZip("throw");
      assert.equal(out.supports, false);
      assert.equal(out.threw, true);
      assert.ok(out.message.includes("cannot store symlinks as links"));
    }
  );

  // Runs bestzip in a fresh process where PATH is prepended with a fake `zip`
  // that rejects --symlinks, so nativeZipSupportsSymlinks() reports false.
  const runWithIncapableZip = (mode) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-fakezip-"));
    fs.writeFileSync(
      path.join(bin, "zip"),
      `#!/bin/sh\necho "zip error: --symlinks not supported" >&2\nexit 1\n`
    );
    fs.chmodSync(path.join(bin, "zip"), 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = bin + path.delimiter + oldPath;
    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(import.meta.dirname, "../symlink_option_fixture.mjs"),
          cwd,
          mode,
        ],
        { cwd: import.meta.dirname, encoding: "utf8" }
      );
      assert.equal(
        result.status,
        0,
        `fixture failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );
      return JSON.parse(result.stdout);
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(bin, { recursive: true, force: true });
    }
  };

  test("cli: --no-follow-sym-links stores symlinks as links", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "--no-follow-sym-links", destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/link.txt"].type, S_IFLNK);
    assert.deepEqual(entries["archive-me/vendor/vendored.txt"], undefined);
  });

  // Note: there's intentionally no "default (no flag)" CLI assertion here. The
  // unset default diverges by backend: the native zip follows symlinks, while
  // the node implementation stores an in-directory symlink as a link. That
  // mismatch is being reconciled separately and shouldn't be locked in by this
  // test suite. The explicit flags below are deterministic on every platform.

  test("cli: --follow-sym-links follows symlinks", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "--follow-sym-links", destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/link.txt"].type, S_IFREG);
    assert.ok(entries["archive-me/vendor/vendored.txt"]);
  });
});
