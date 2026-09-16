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
    "falls back to nodeZip when no trusted zip is found even with an explicit location set",
    posixSkip,
    () => {
      const root = reset();
      const workDir = path.join(root, "work");
      const emptyBin = path.join(root, "empty-bin");
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(emptyBin, { recursive: true });
      fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");

      const out = runFixture(workDir, path.join(root, "out.zip"), {
        ...process.env,
        // An explicit zip location that contains no zip: bestzip must not run
        // anything, so it falls back to its node implementation. PATH is also
        // cleared, since resolution never consults it.
        BESTZIP_ZIP_PATH: emptyBin,
        PATH: path.join(root, "no-such-directory"),
      });

      assert.equal(out.pwnedExists, false);
      assert.equal(out.rejected, false, out.message);
      assert.equal(out.archiveExists, true);
      assert.ok(out.archiveSize > 0);
    }
  );

  test(
    "uses the system zip, never a `zip` reachable only through PATH",
    posixSkip,
    () => {
      const root = reset();
      const workDir = path.join(root, "work");
      const binDir = path.join(root, "bin");
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");
      writeFakeZip(binDir);

      const out = runFixture(workDir, path.join(root, "out.zip"), {
        ...process.env,
        // The fake zip is the only one reachable through PATH, but PATH is
        // never consulted: the system zip (or nodeZip fallback) must run.
        PATH: binDir,
      });

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
      // A "zip" that claims success but produces nothing. Such a file can only
      // run if the user explicitly opts into it; this test does that via
      // BESTZIP_ZIP_PATH so the silent-failure guard is exercised.
      writeFakeZip(binDir);

      const out = runFixture(workDir, path.join(root, "out.zip"), {
        ...process.env,
        BESTZIP_ZIP_PATH: binDir,
      });

      assert.equal(out.rejected, true);
      assert.ok(out.message.includes("did not create the archive"));
      assert.equal(out.archiveExists, false);
      // Confirms the fake zip really was the one executed.
      assert.equal(out.pwnedExists, true);
    }
  );

  test("never presents node_modules, relative, or empty PATH entries as trusted zips", () => {
    const root = reset();
    const nmBin = path.join(root, "node_modules", ".bin");
    const plainBin = path.join(root, "plain");
    fs.mkdirSync(nmBin, { recursive: true });
    fs.mkdirSync(plainBin, { recursive: true });
    writeFakeZip(nmBin);
    writeFakeZip(plainBin);

    assert.equal(bestzip.findZipCommandOnUntrustedPath(nmBin), null);
    assert.equal(bestzip.findZipCommandOnUntrustedPath("relative/bin"), null);
    assert.equal(bestzip.findZipCommandOnUntrustedPath(""), null);
    assert.equal(
      bestzip.findZipCommandOnUntrustedPath(plainBin),
      path.join(plainBin, "zip")
    );
  });

  test("warns about a refused zip with its path and how to opt in, once per path", () => {
    const root = reset();
    const binDir = path.join(root, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    writeFakeZip(binDir);

    const messages = [];
    const oldWarn = console.warn;
    console.warn = (...args) => messages.push(args.join(" "));
    try {
      const first = bestzip.maybeWarnAboutRefusedZip(binDir);
      assert.equal(first, path.join(binDir, "zip"));
      assert.equal(messages.length, 1);
      const message = messages[0];
      // The declined path and the way to trust it deliberately...
      assert.ok(message.includes(path.join(binDir, "zip")));
      assert.ok(message.includes("--zip-path"));
      assert.ok(message.includes("zipPath"));
      assert.ok(message.includes("BESTZIP_ZIP_PATH"));
      // ...and where to ask for a new default-trusted location.
      assert.ok(message.includes("pull request"));

      // The same path is never warned about twice in one process.
      assert.equal(bestzip.maybeWarnAboutRefusedZip(binDir), null);
      assert.equal(messages.length, 1);
    } finally {
      console.warn = oldWarn;
    }
  });

  test(
    "warns and falls back to nodeZip when the only zip is an untrusted PATH entry",
    { skip: process.platform === "win32" },
    () => {
      const root = reset();
      const workDir = path.join(root, "work");
      const binDir = path.join(root, "bin");
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");
      writeFakeZip(binDir);

      const result = spawnSync(
        process.execPath,
        [fixture, path.join(root, "out.zip")],
        {
          cwd: workDir,
          env: { ...process.env, PATH: binDir },
          encoding: "utf8",
        }
      );
      assert.equal(
        result.status,
        0,
        `fixture failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );
      const out = JSON.parse(result.stdout);

      // The untrusted zip never runs, and the archive is still produced either
      // by the trusted system zip (when one exists) or by the node fallback.
      assert.equal(out.pwnedExists, false);
      assert.equal(out.rejected, false, out.message);
      assert.equal(out.archiveExists, true);

      if (RUNS_NATIVE) {
        // A trusted system zip exists and is used, so nothing is refused and
        // no warning is printed.
        assert.ok(!result.stderr.includes("trusted system directories"));
      } else {
        // No trusted zip is available; the PATH zip was refused and bestzip
        // must have explained how to opt back into it.
        assert.ok(result.stderr.includes(path.join(binDir, "zip")));
        assert.ok(result.stderr.includes("--zip-path"));
        assert.ok(result.stderr.includes("BESTZIP_ZIP_PATH"));
        assert.ok(result.stderr.includes("pull request"));
      }
    }
  );
});
