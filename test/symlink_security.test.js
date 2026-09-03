import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
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
  const runOnBothZips = (title, body) => {
    test(`${title} (nodeZip)`, async (t) => body(bestzip.nodeZip, t));
    test(`${title} (nativeZip)`, async (t) => body(bestzip.nativeZip, t));
  };

  beforeEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    setup();
  });
  after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

  runOnBothZips(
    "default follows symlinks and archives their target contents",
    async (zipMethod) => {
      await zipMethod({ cwd, source: "archive-me/", destination });
      const entries = readZipEntries(destination);

      assert.equal(entries["archive-me/leak.txt"].type, S_IFREG);
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
    "warns the user when symlinks are present and followSymLinks is unset",
    async (zipMethod, t) => {
      const warn = t.mock.method(console, "warn", () => {});
      await zipMethod({ cwd, source: "archive-me/", destination });
      assert.ok(warn.mock.calls.length > 0);
      const message = warn.mock.calls
        .map((c) => c.arguments.join(" "))
        .join(" ");
      assert.ok(message.includes("Symbolic links are followed by default"));
      assert.ok(message.includes("leak.txt"));
      assert.ok(message.includes("set followSymLinks: true"));
      assert.ok(message.includes("set followSymLinks: false"));
      assert.ok(message.includes("v4"));
    }
  );

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

      assert.equal(entries["archive-me/leak.txt"].type, S_IFREG);
      assert.ok(
        entries["archive-me/leak.txt"].data.toString().includes(SECRET_CONTENTS)
      );
      assert.ok(entries["archive-me/vendor/creds.env"]);
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
    }
  );

  runOnBothZips(
    "honors followSymLinks: false and stores symlinks as links",
    async (zipMethod) => {
      await zipMethod({
        cwd,
        source: "archive-me/",
        destination,
        followSymLinks: false,
      });
      const entries = readZipEntries(destination);

      assert.equal(entries["archive-me/leak.txt"].type, S_IFLNK);
      assert.equal(entries["archive-me/vendor"].type, S_IFLNK);
      assert.equal(entries["archive-me/vendor/creds.env"], undefined);
    }
  );

  test("cli warns and follows symlinks by default", () => {
    const result = spawnSync(
      process.execPath,
      [cli, destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.ok(result.stderr.includes("Symbolic links are followed by default"));
    assert.ok(result.stderr.includes("pass --follow-sym-links"));
    assert.ok(result.stderr.includes("pass --no-follow-sym-links"));
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/leak.txt"].type, S_IFREG);
    assert.ok(
      entries["archive-me/leak.txt"].data.toString().includes(SECRET_CONTENTS)
    );
  });

  test("cli --follow-sym-links follows symlinks without warning", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "--follow-sym-links", destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.ok(
      !result.stderr.includes("Symbolic links are followed by default")
    );
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/leak.txt"].type, S_IFREG);
    assert.ok(
      entries["archive-me/leak.txt"].data.toString().includes(SECRET_CONTENTS)
    );
  });

  test("cli --no-follow-sym-links stores symlinks as links without warning", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "--no-follow-sym-links", destination, "archive-me/"],
      { cwd, encoding: "utf8" }
    );
    assert.ok(
      !result.stderr.includes("Symbolic links are followed by default")
    );
    const entries = readZipEntries(destination);
    assert.equal(entries["archive-me/leak.txt"].type, S_IFLNK);
    assert.equal(entries["archive-me/vendor/creds.env"], undefined);
  });

  test("nativeZipSupportsSymlinks returns a boolean", () => {
    assert.equal(typeof bestzip.nativeZipSupportsSymlinks(), "boolean");
  });
});
