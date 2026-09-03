import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
import { init } from "./helpers.js";

const { tmpdir, cleanup } = init("compression-level");
const cwd = path.join(tmpdir, "cwd");
const compressibleFile = path.join(cwd, "big.txt");
const destination = path.join(cwd, "out.zip");
const cli = path.join(import.meta.dirname, "../bin/cli.js");

// Highly-compressible content so level 0 (stored) is dramatically larger than
// level 9 (deflated), making the assertions robust across platforms.
const COMPRESSIBLE = "hello world hello world ".repeat(5000);

const size = () => fs.statSync(destination).size;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

// Zip the same compressible file at level 0 and level 9 and assert the
// resulting archives differ by a large margin, i.e. the level was honored.
async function assertLevelHonored(impl, label) {
  await impl({ cwd, source: "big.txt", destination, level: 0 });
  const size0 = size();
  await impl({ cwd, source: "big.txt", destination, level: 9 });
  const size9 = size();
  assert.ok(
    size0 > size9 * 5,
    `${label}: level 0 (${kb(size0)}) should be much larger than level 9 (${kb(
      size9
    )})`
  );
}

describe("compression level", () => {
  const hasNative = bestzip.hasNativeZip();

  beforeEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(compressibleFile, COMPRESSIBLE);
  });
  after(() => cleanup());

  test("nodeZip honors the level", async () => {
    await assertLevelHonored(bestzip.nodeZip, "nodeZip");
  });

  test("nativeZip honors the level", { skip: !hasNative }, async () => {
    await assertLevelHonored(bestzip.nativeZip, "nativeZip");
  });

  test("bestzip() forwards the level to the selected implementation", async () => {
    await assertLevelHonored((o) => bestzip.zip(o), "bestzip()");
  });

  test("cli --level is honored", () => {
    const run = (level) => {
      const result = spawnSync(
        process.execPath,
        [cli, "--level", String(level), destination, "big.txt"],
        { cwd, encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stderr);
      return size();
    };
    const size0 = run(0);
    const size9 = run(9);
    assert.ok(
      size0 > size9 * 5,
      `cli --level: level 0 (${kb(
        size0
      )}) should be much larger than level 9 (${kb(size9)})`
    );
  });

  describe("invalid level", () => {
    const invalidLevels = [-1, 10, 1.5, -5, "5", NaN];

    function expectedError(level) {
      const typehint = typeof level === "number" ? "" : ` (${typeof level})`;
      return new RegExp(
        `bestzip: level should be an integer from 0 to 9, got ${level}${typehint.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}`
      );
    }

    async function assertThrows(impl) {
      for (const level of invalidLevels) {
        await assert.rejects(
          impl({ cwd, source: "big.txt", destination, level }),
          expectedError(level)
        );
      }
    }

    test("nodeZip throws", async () => {
      await assertThrows(bestzip.nodeZip);
    });

    test("nativeZip throws", { skip: !hasNative }, async () => {
      await assertThrows(bestzip.nativeZip);
    });
  });
});
