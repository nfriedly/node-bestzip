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

let tmpdir = "";
const reset = () => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-srch-"));
  return tmpdir;
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
      const pwned = path.join(root, "PWNED.txt");
      fs.writeFileSync(
        path.join(buildDir, "zip"),
        `#!/bin/sh\ntouch ${pwned}\nexit 0\n`
      );
      fs.chmodSync(path.join(buildDir, "zip"), 0o755);

      const result = spawnSync(
        process.execPath,
        [fixture, path.join(root, "out.zip")],
        {
          cwd: buildDir,
          env: {
            ...process.env,
            // Empty leading PATH element: with the bare command name, execvp
            // would resolve `zip` from buildDir (the child's cwd) ahead of the
            // real one.
            PATH: path.delimiter + process.env.PATH,
          },
          encoding: "utf8",
        }
      );
      assert.equal(
        result.status,
        0,
        `fixture failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );
      const out = JSON.parse(result.stdout);

      // The real native zip must have run, not the planted one...
      assert.equal(out.pwnedExists, false);
      // ...and it must actually have produced the archive.
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
      fs.writeFileSync(path.join(binDir, "zip"), "#!/bin/sh\nexit 0\n");
      fs.chmodSync(path.join(binDir, "zip"), 0o755);

      const result = spawnSync(
        process.execPath,
        [fixture, path.join(root, "out.zip")],
        {
          cwd: workDir,
          env: {
            ...process.env,
            PATH: binDir + path.delimiter + process.env.PATH,
          },
          encoding: "utf8",
        }
      );
      assert.equal(
        result.status,
        0,
        `fixture failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );
      const out = JSON.parse(result.stdout);

      assert.equal(out.rejected, true);
      assert.ok(out.message.includes("did not create the archive"));
      assert.equal(out.archiveExists, false);
    }
  );
});
