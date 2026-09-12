import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";

const fixture = path.join(
  import.meta.dirname,
  "js-fixtures/search-path-fixture.mjs"
);
const RUNS_NATIVE = bestzip.hasNativeZip();

// The planted fake `zip` is a POSIX script and Windows executable lookup
// doesn't follow the same chdir+execvp behavior, so these regressions only
// make sense where bestzip would use the native zip command on POSIX.
const posixSkip = { skip: !RUNS_NATIVE || process.platform === "win32" };

// A fake `zip` that records execution by touching PWNED.txt in the cwd and
// exits 0 without producing an archive.
const writeFakeZip = (dir) => {
  const zip = path.join(dir, "zip");
  fs.writeFileSync(zip, "#!/bin/sh\ntouch PWNED.txt\nexit 0\n");
  fs.chmodSync(zip, 0o755);
  return zip;
};

let tmpdir = "";
const reset = () => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-srch-"));
  return tmpdir;
};

const runFixture = (cwd, dest, env) => {
  const result = spawnSync(process.execPath, [fixture, dest], {
    cwd,
    env,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `fixture failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );
  return JSON.parse(result.stdout);
};

describe("untrusted search path and silent failures", () => {
  after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

  test(
    "ignores a `zip` planted in the archive directory even with an empty PATH element",
    posixSkip,
    () => {
      const root = reset();
      const buildDir = path.join(root, "build");
      fs.mkdirSync(buildDir, { recursive: true });
      fs.writeFileSync(path.join(buildDir, "app.js"), "console.log('app')");
      // The attacker's entire contribution: one committed executable named
      // `zip` in the directory being archived.
      writeFakeZip(buildDir);

      const out = runFixture(buildDir, path.join(root, "out.zip"), {
        ...process.env,
        // Empty leading PATH element: with the bare command name, execvp
        // would resolve `zip` from buildDir (the child's cwd) ahead of the
        // real one.
        PATH: path.delimiter + process.env.PATH,
      });

      // The real native zip must have run, not the planted one...
      assert.equal(out.pwnedExists, false);
      // ...and it must actually have produced the archive.
      assert.equal(out.rejected, false, out.message);
      assert.equal(out.archiveExists, true);
      assert.ok(out.archiveSize > 0);
    }
  );

  test(
    "ignores a dependency-supplied node_modules/.bin/zip shim (npm script PATH)",
    posixSkip,
    () => {
      const root = reset();
      const repo = path.join(root, "repo");
      const binDir = path.join(repo, "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(repo, "app.js"), "console.log('app')");
      // What `npm install` of a dependency declaring "bin": { "zip": ... }
      // leaves behind: an executable shim, no install script involved.
      writeFakeZip(binDir);

      const out = runFixture(repo, path.join(root, "out.zip"), {
        ...process.env,
        // Exactly what npm prepends when running a script in this repo.
        PATH: binDir + path.delimiter + process.env.PATH,
      });

      // The shim must not run; the OS/system zip (or nodeZip fallback) does.
      assert.equal(out.pwnedExists, false);
      assert.equal(out.rejected, false, out.message);
      assert.equal(out.archiveExists, true);
    }
  );

  test(
    "falls back to nodeZip when PATH only offers a node_modules/.bin/zip shim",
    posixSkip,
    () => {
      const root = reset();
      const repo = path.join(root, "repo");
      const binDir = path.join(repo, "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(repo, "app.js"), "console.log('app')");
      writeFakeZip(binDir);

      const out = runFixture(repo, path.join(root, "out.zip"), {
        ...process.env,
        // All that bestzip sees is npm's node_modules/.bin entry.
        PATH: binDir,
      });

      // No dependency-supplied zip was found, so bestzip builds the archive
      // with its own node implementation instead of running the shim.
      assert.equal(out.pwnedExists, false);
      assert.equal(out.rejected, false, out.message);
      assert.equal(out.archiveExists, true);
      assert.ok(out.archiveSize > 0);
    }
  );

  test(
    "rejects a 0 exit that produced no archive instead of reporting success",
    posixSkip,
    () => {
      const root = reset();
      const workDir = path.join(root, "work");
      const binDir = path.join(root, "bin");
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");
      // A "zip" that claims success but produces nothing.
      writeFakeZip(binDir);

      const out = runFixture(workDir, path.join(root, "out.zip"), {
        ...process.env,
        PATH: binDir + path.delimiter + process.env.PATH,
      });

      assert.equal(out.rejected, true);
      assert.ok(out.message.includes("did not create the archive"));
      assert.equal(out.archiveExists, false);
    }
  );
});
