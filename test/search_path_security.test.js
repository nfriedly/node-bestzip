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
const RUNS_NATIVE = bestzip.hasNativeZip({ quiet: true });

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
    "uses the system zip without a refused-zip warning, never a `zip` from PATH",
    posixSkip,
    () => {
      const root = reset();
      const workDir = path.join(root, "work");
      const binDir = path.join(root, "bin");
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");
      // The fake zip is the only one reachable through PATH, but PATH is never
      // consulted: the trusted system zip must run. posixSkip guarantees that
      // trusted system zip exists, so the warning can't fire and this also
      // covers the "no spurious warning" case for the machines that can.
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

      assert.equal(out.pwnedExists, false);
      assert.equal(out.rejected, false, out.message);
      assert.equal(out.archiveExists, true);
      assert.ok(out.archiveSize > 0);
      // Nothing was refused, so no warning is logged.
      assert.ok(!result.stderr.includes("trusted system directories"));
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

  test(
    "rejects a 0 exit despite a stale archive at the destination",
    posixSkip,
    () => {
      const root = reset();
      const workDir = path.join(root, "work");
      const binDir = path.join(root, "bin");
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");
      writeFakeZip(binDir);

      // A stale archive from a previous build already sits at the destination
      // when the compromised zip runs. The stale artifact must not pass the
      // "was the archive written?" check.
      const dest = path.join(root, "out.zip");
      fs.writeFileSync(dest, "stale content from a previous build");

      const out = runFixture(workDir, dest, {
        ...process.env,
        BESTZIP_ZIP_PATH: binDir,
      });

      assert.equal(out.rejected, true);
      assert.ok(out.message.includes("did not create the archive"));
      // The stale archive was removed up front; it is not reported as success
      // nor left in place as a plausible new artifact.
      assert.equal(out.archiveExists, false);
      // Confirms the fake zip really was the one executed.
      assert.equal(out.pwnedExists, true);
    }
  );

  test("reports node_modules, relative, and empty PATH entries as declined zips", () => {
    const root = reset();
    const nmBin = path.join(root, "node_modules", ".bin");
    const plainBin = path.join(root, "plain");
    const relativeBin = path.join(root, "relative", "bin");
    fs.mkdirSync(nmBin, { recursive: true });
    fs.mkdirSync(plainBin, { recursive: true });
    fs.mkdirSync(relativeBin, { recursive: true });
    writeFakeZip(nmBin);
    writeFakeZip(plainBin);
    // Plant zips where a relative PATH entry ("relative/bin") and an empty one
    // ("") would resolve against the cwd, so the reporting is asserted against
    // real files rather than plain absence.
    writeFakeZip(relativeBin);
    writeFakeZip(root);

    const oldCwd = process.cwd();
    process.chdir(root);
    try {
      // The scan exists to warn about the `zip` bestzip refuses to run, so
      // it reports anything on PATH — a node_modules/.bin shim...
      assert.equal(
        bestzip.findZipCommandOnUntrustedPath(nmBin),
        path.join(nmBin, "zip")
      );
      // ...a relative entry that resolves against the cwd...
      assert.equal(
        bestzip.findZipCommandOnUntrustedPath("relative/bin"),
        path.join("relative", "bin", "zip")
      );
      // ...an empty entry that resolves against the cwd...
      assert.equal(bestzip.findZipCommandOnUntrustedPath(""), "zip");
      // ...and a plain absolute entry.
      assert.equal(
        bestzip.findZipCommandOnUntrustedPath(plainBin),
        path.join(plainBin, "zip")
      );
    } finally {
      process.chdir(oldCwd);
    }
  });

  test("warns about a refused zip with its path and how to opt in, once per path", (t) => {
    t.mock.method(console, "warn");

    const root = reset();
    const binDir = path.join(root, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    writeFakeZip(binDir);

    // Called without viaCli, so the API option names are used.
    const first = bestzip.maybeWarnAboutRefusedZip({ pathEnv: binDir });
    assert.equal(first, path.join(binDir, "zip"));
    assert.equal(console.warn.mock.calls.length, 1);
    const message = console.warn.mock.calls[0].arguments[0];
    // The declined path and the way to trust it deliberately...
    assert.ok(message.includes(path.join(binDir, "zip")));
    assert.ok(message.includes("zipPath"));
    assert.ok(message.includes("BESTZIP_ZIP_PATH"));
    // ...the API quiet option...
    assert.ok(message.includes("quiet: true"));
    // ...and where to ask for a new default-trusted location.
    assert.ok(message.includes("pull request"));
    // The message is scoped to the API: the CLI flag is not mentioned.
    assert.ok(!message.includes("--zip-path"));

    // The same path is never warned about twice in one process.
    assert.equal(bestzip.maybeWarnAboutRefusedZip({ pathEnv: binDir }), null);
    assert.equal(console.warn.mock.calls.length, 1);
  });

  test("scopes the refusal warning to CLI or API usage", (t) => {
    t.mock.method(console, "warn");

    const root = reset();
    const cliBinDir = path.join(root, "cli-bin");
    const apiBinDir = path.join(root, "api-bin");
    fs.mkdirSync(cliBinDir, { recursive: true });
    fs.mkdirSync(apiBinDir, { recursive: true });
    writeFakeZip(cliBinDir);
    writeFakeZip(apiBinDir);

    // CLI users have no --zip-path flag (a build argument could otherwise
    // smuggle in an executable path), so the remedy is the env var only.
    assert.equal(
      bestzip.maybeWarnAboutRefusedZip({ pathEnv: cliBinDir, viaCli: true }),
      path.join(cliBinDir, "zip")
    );
    const cliMessage = console.warn.mock.calls[0].arguments[0];
    assert.ok(cliMessage.includes("BESTZIP_ZIP_PATH"));
    assert.ok(cliMessage.includes("--quiet"));
    // The CLI message does not name the programmatic option or a --zip-path flag.
    assert.ok(!cliMessage.includes("zipPath"));

    assert.equal(
      bestzip.maybeWarnAboutRefusedZip({ pathEnv: apiBinDir }),
      path.join(apiBinDir, "zip")
    );
    const apiMessage = console.warn.mock.calls[1].arguments[0];
    assert.ok(apiMessage.includes("zipPath"));
    assert.ok(apiMessage.includes("BESTZIP_ZIP_PATH"));
    assert.ok(apiMessage.includes("quiet: true"));
    assert.ok(!apiMessage.includes("--zip-path"));
  });

  test("quiet: true suppresses the refused-zip warning", (t) => {
    t.mock.method(console, "warn");

    const root = reset();
    const binDir = path.join(root, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    writeFakeZip(binDir);

    // No warning and no path returned, but the suppressed path is not marked
    // warned: a later non-quiet probe still reports it.
    assert.equal(
      bestzip.maybeWarnAboutRefusedZip({ pathEnv: binDir, quiet: true }),
      null
    );
    assert.equal(console.warn.mock.calls.length, 0);
    assert.equal(
      bestzip.maybeWarnAboutRefusedZip({ pathEnv: binDir }),
      path.join(binDir, "zip")
    );
    assert.equal(console.warn.mock.calls.length, 1);
  });

  test(
    "logs the refused-zip warning when no trusted zip exists and only an untrusted PATH zip is present",
    // Runs only where a trusted native zip is NOT available (e.g. the plain
    // Windows CI job, which has no native zip command); skipped wherever a
    // trusted system zip exists, since there the warning can't fire. Note that
    // pointing the fixture's PATH at the fake zip isn't what triggers this by
    // itself: the trusted-directory allowlist is hardcoded, so this test only
    // actually runs on hosts where that allowlist comes up empty.
    { skip: RUNS_NATIVE },
    () => {
      const root = reset();
      const workDir = path.join(root, "work");
      const binDir = path.join(root, "bin");
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");
      // The fake zip is the only zip reachable through PATH.
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

      // The fake never runs; the built-in node implementation builds the
      // archive because no trusted zip is available.
      assert.equal(out.pwnedExists, false);
      assert.equal(out.rejected, false, out.message);
      assert.equal(out.archiveExists, true);
      assert.ok(out.archiveSize > 0);

      // bestzip must explain the refusal: the declined path, the opt-in
      // knobs (API wording — the fixture calls bestzip programmatically), the
      // quiet option, and where to request a default-trusted location.
      assert.ok(result.stderr.includes(path.join(binDir, "zip")));
      assert.ok(result.stderr.includes("zipPath"));
      assert.ok(result.stderr.includes("BESTZIP_ZIP_PATH"));
      assert.ok(result.stderr.includes("quiet: true"));
      assert.ok(result.stderr.includes("pull request"));
    }
  );

  test("cli: ignores an injected --zip-path instead of running its zip", () => {
    const cli = path.join(import.meta.dirname, "../bin/cli.js");
    const root = reset();
    const workDir = path.join(root, "work");
    const binDir = path.join(root, "bin");
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, "app.js"), "console.log('app')");
    writeFakeZip(binDir);

    // There is no --zip-path flag anymore, so yargs parses it as an unknown
    // option and it must not point bestzip at the fake executable (this is the
    // injection vector the flag removal is meant to close).
    const result = spawnSync(
      process.execPath,
      [cli, "--zip-path", binDir, path.join(root, "out.zip"), "app.js"],
      { cwd: workDir, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    // The fake never ran...
    assert.equal(fs.existsSync(path.join(workDir, "PWNED.txt")), false);
    // ...and the archive was still produced by a trusted zip / node fallback.
    assert.ok(fs.existsSync(path.join(root, "out.zip")));
  });
});
