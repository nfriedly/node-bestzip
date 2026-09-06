import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
import which from "which";
import { canCreateSymlinks, init, readZipEntries } from "./helpers.js";

const { tmpdir } = init("symlink_security");
const cwd = path.join(tmpdir, "cwd");
const archiveDir = path.join(cwd, "archive-me");
const secretFile = path.join(tmpdir, "victim-secret.txt");
const privateDir = path.join(tmpdir, "private");
const linkToFile = path.join(archiveDir, "leak.txt");
const linkToDir = path.join(archiveDir, "vendor");
const normalFile = path.join(archiveDir, "normal.txt");
const destination = path.join(cwd, "out.zip");
const cli = path.join(import.meta.dirname, "../bin/cli.js");

const SECRET_CONTENTS = "SECRET=hunter2";
const CREDS_CONTENTS = "AWS_SECRET=ACCESS";

const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

const setup = () => {
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(secretFile, SECRET_CONTENTS);
  fs.writeFileSync(path.join(privateDir, "creds.env"), CREDS_CONTENTS);
  fs.writeFileSync(normalFile, "normal");
  try {
    fs.symlinkSync(secretFile, linkToFile);
  } catch (e) {
    // already exists
  }
  try {
    fs.symlinkSync(privateDir, linkToDir);
  } catch (e) {
    // already exists
  }
};

describe("symlink security", { skip: !canCreateSymlinks() }, () => {
  const hasNativeZip = bestzip.hasNativeZip();
  // The native zip on Windows (Info-ZIP) can't store symlinks as links, so the
  // not-follow nativeZip variants (which call nativeZip without followSymLinks,
  // or with followSymLinks: false) would throw there. Skip those variants on
  // such platforms; the follow-mode (followSymLinks: true) variants still run.
  const nativeStoresLinks = hasNativeZip && bestzip.nativeZipSupportsSymlinks();

  const runOnBothZips = (title, body, nativeSkip = !hasNativeZip) => {
    test(`${title} (nodeZip)`, async (t) => body(bestzip.nodeZip, t));
    test(`${title} (nativeZip)`, { skip: nativeSkip }, async (t) =>
      body(bestzip.nativeZip, t)
    );
  };

  beforeEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    setup();
  });
  after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

  runOnBothZips(
    "stores symlinks as symlink entries rather than following them by default",
    async (zipMethod) => {
      await zipMethod({ cwd, source: "archive-me/", destination });
      const entries = readZipEntries(destination);

      assert.equal(entries["archive-me/leak.txt"].type, S_IFLNK);
      assert.equal(entries["archive-me/vendor"].type, S_IFLNK);
      const linkData = entries["archive-me/leak.txt"].data.toString();
      assert.ok(!linkData.includes(SECRET_CONTENTS));
      assert.equal(path.basename(linkData), path.basename(secretFile));
      assert.equal(entries["archive-me/vendor/creds.env"], undefined);
    },
    !nativeStoresLinks
  );

  runOnBothZips(
    "warns the user when symlinks are present and followSymLinks is unset",
    async (zipMethod, t) => {
      const warn = t.mock.method(console, "warn", () => {});
      await zipMethod({ cwd, source: "archive-me/", destination });
      assert.ok(warn.mock.calls.length > 0);
      const message = warn.mock.calls
        .map((c) => c.arguments.join(" "))
        .join(" ");
      assert.ok(
        message.includes("Symbolic links are stored as the link itself")
      );
      assert.ok(message.includes("leak.txt"));
      assert.ok(message.includes("set followSymLinks: true"));
      assert.ok(message.includes("set followSymLinks: false"));
    },
    !nativeStoresLinks
  );

  test("stores the raw link target for symlinks, matching native zip", async () => {
    const rawTarget = fs.readlinkSync(linkToFile);
    const nodeZipDest = path.join(cwd, "node.zip");

    await bestzip.nodeZip({
      cwd,
      source: "archive-me/",
      destination: nodeZipDest,
    });
    const nodeZipLink = readZipEntries(nodeZipDest)[
      "archive-me/leak.txt"
    ].data.toString();

    assert.equal(nodeZipLink, rawTarget);

    if (nativeStoresLinks) {
      const nativeZipDest = path.join(cwd, "native.zip");
      await bestzip.nativeZip({
        cwd,
        source: "archive-me/",
        destination: nativeZipDest,
      });
      const nativeZipLink = readZipEntries(nativeZipDest)[
        "archive-me/leak.txt"
      ].data.toString();
      assert.equal(nodeZipLink, nativeZipLink);
    }
  });

  runOnBothZips(
    "honors followSymLinks: true and follows symlinks",
    async (zipMethod) => {
      await zipMethod({
        cwd,
        source: "archive-me/",
        destination,
        followSymLinks: true,
      });
      const entries = readZipEntries(destination);

      // The native zip on Windows doesn't write POSIX type bits even when
      // following symlinks, so only assert the exact type where it can express
      // it. Either way the target contents must be included.
      if (bestzip.nativeZipSupportsSymlinks()) {
        assert.equal(entries["archive-me/leak.txt"].type, S_IFREG);
      }
      assert.ok(
        entries["archive-me/leak.txt"].data.toString().includes(SECRET_CONTENTS)
      );
      assert.ok(entries["archive-me/vendor/creds.env"]);
      assert.ok(
        entries["archive-me/vendor/creds.env"].data
          .toString()
          .includes(CREDS_CONTENTS)
      );
    }
  );

  runOnBothZips(
    "suppresses the warning when followSymLinks is explicitly set",
    async (zipMethod, t) => {
      const warn = t.mock.method(console, "warn", () => {});
      await zipMethod({
        cwd,
        source: "archive-me/",
        destination,
        followSymLinks: true,
      });
      assert.equal(warn.mock.callCount(), 0);

      await zipMethod({
        cwd,
        source: "archive-me/",
        destination,
        followSymLinks: false,
      });
      assert.equal(warn.mock.callCount(), 0);
    },
    !nativeStoresLinks
  );

  test("secure by default through the main bestzip() entry point", async () => {
    await bestzip.default({
      cwd,
      source: "archive-me/",
      destination,
    });
    const entries = readZipEntries(destination);

    assert.equal(entries["archive-me/leak.txt"].type, S_IFLNK);
    assert.equal(entries["archive-me/vendor/creds.env"], undefined);
  });

  test("cli warns and stores symlinks as links by default", () => {
    const result = spawnSync(
      process.execPath,
      [cli, destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.ok(
      result.stderr.includes("Symbolic links are stored as the link itself")
    );
    assert.ok(result.stderr.includes("pass --follow-sym-links"));
    assert.ok(result.stderr.includes("pass --no-follow-sym-links"));
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/leak.txt"].type, S_IFLNK);
    assert.equal(entries["archive-me/vendor/creds.env"], undefined);
  });

  test("cli --follow-sym-links follows symlinks without warning", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "--follow-sym-links", destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.ok(
      !result.stderr.includes("Symbolic links are stored as the link itself")
    );
    const entries = readZipEntries(destination);
    // The CLI uses the native zip when available. On Windows its Info-ZIP build
    // doesn't write POSIX type bits even when following, so only assert the
    // exact type where it can express it. The target contents are included in
    // either case.
    if (bestzip.nativeZipSupportsSymlinks()) {
      assert.equal(entries["archive-me/leak.txt"].type, S_IFREG);
    }
    assert.ok(
      entries["archive-me/leak.txt"].data.toString().includes(SECRET_CONTENTS)
    );
    assert.ok(entries["archive-me/vendor/creds.env"]);
  });

  test("cli --no-follow-sym-links stores symlinks as links without warning", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "--no-follow-sym-links", destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.ok(
      !result.stderr.includes("Symbolic links are stored as the link itself")
    );
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/leak.txt"].type, S_IFLNK);
    assert.equal(entries["archive-me/vendor/creds.env"], undefined);
  });

  test("nativeZipSupportsSymlinks returns a boolean", () => {
    assert.equal(typeof bestzip.nativeZipSupportsSymlinks(), "boolean");
  });

  // Runs a bestzip scenario in a fresh process where PATH is prepended with a
  // fake `zip` that rejects --symlinks (simulating the Windows Info-ZIP build),
  // so nativeZipSupportsSymlinks() deterministically reports false. The fake
  // zip is a POSIX shell script, so these tests are skipped on win32 where
  // that wouldn't execute (the real Info-ZIP there is already incapable).
  const runWithIncapableZip = (mode) => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-fakezip-"));
    const realZip = which.sync("zip");
    fs.writeFileSync(
      path.join(bin, "zip"),
      `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "--symlinks" ]; then\n    echo "zip error: --symlinks not supported" >&2\n    exit 1\n  fi\ndone\nexec "${realZip}" "$@"\n`
    );
    fs.chmodSync(path.join(bin, "zip"), 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = bin + path.delimiter + oldPath;
    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(import.meta.dirname, "../incapable-zip-fixture.mjs"),
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

  test(
    "bestzip() uses nodeZip when the native zip can't store symlinks as links",
    { skip: !hasNativeZip || process.platform === "win32" },
    async () => {
      const out = runWithIncapableZip("route");
      assert.equal(out.supports, false);
      // The native zip can't store links, so bestzip() routes to nodeZip.
      assert.equal(out.leakType, S_IFLNK);
      assert.equal(out.vendorType, S_IFLNK);
      assert.equal(out.hasCreds, false);
      assert.equal(out.leakTarget, fs.readlinkSync(linkToFile));
    }
  );

  test(
    "nativeZip throws when the native zip can't store symlinks as links and followSymLinks unset",
    { skip: !hasNativeZip || process.platform === "win32" },
    async () => {
      const out = runWithIncapableZip("throw");
      assert.equal(out.supports, false);
      assert.equal(out.threw, true);
      assert.ok(out.message.includes("cannot store symlinks as links"));
    }
  );

  test(
    "nativeZip follows symlinks with followSymLinks: true even when the zip can't store symlinks as links",
    { skip: !hasNativeZip || process.platform === "win32" },
    async () => {
      const out = runWithIncapableZip("follow");
      assert.equal(out.supports, false);
      assert.equal(out.leakType, S_IFREG);
      assert.equal(out.hasSecret, true);
    }
  );
});
