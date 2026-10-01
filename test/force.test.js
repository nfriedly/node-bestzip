import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import * as bestzip from "../lib/bestzip.js";
import { init, readZipEntries } from "./helpers.js";

const { tmpdir, cleanup } = init("force-option");
const cwd = path.join(tmpdir, "cwd");
const destination = path.join(cwd, "out.zip");
const source = "file.txt";

// A missing source is the one input the two implementations reject
// distinguishably: the node implementation fails the lstat with ENOENT, while
// the native zip exits non-zero and bestzip reports its exit code. The
// archives they produce are otherwise identical by design, so this is what
// tells us which implementation actually ran.
//
// followSymLinks is set so that the native zip actually runs: without it, a
// platform whose native zip can't store symlinks as links (e.g. Windows)
// throws before it ever gets to the zip.
const options = {
  cwd,
  source: "missing.txt",
  destination,
  followSymLinks: true,
};
const assertNodeRan = (zipFn) =>
  assert.rejects(zipFn(options), { code: "ENOENT" });
const assertNativeRan = (zipFn) =>
  assert.rejects(
    zipFn(options),
    bestzip.hasNativeZip()
      ? /Unexpected exit code from native zip/
      : /native zip command was not found/
  );

describe("force option", () => {
  beforeEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, source), "contents\n");
  });
  after(() => cleanup());

  test("force: 'node' uses the node implementation", async () => {
    await assertNodeRan((o) => bestzip.zip({ ...o, force: "node" }));
  });

  test("force: 'native' uses the native implementation", async () => {
    await assertNativeRan((o) => bestzip.zip({ ...o, force: "native" }));
  });

  test("nodeZip is the equivalent of force: 'node'", async () => {
    await assertNodeRan(bestzip.nodeZip);
  });

  test("nativeZip is the equivalent of force: 'native'", async () => {
    await assertNativeRan(bestzip.nativeZip);
  });

  for (const force of ["node", "native"]) {
    test(
      `force: '${force}' archives the source`,
      { skip: force === "native" && !bestzip.hasNativeZip() },
      async () => {
        // Without followSymLinks the native zip throws on platforms whose
        // build can't store symlinks as links (e.g. Windows), so opt in to
        // following them.
        await bestzip.zip({
          cwd,
          source,
          destination,
          force,
          followSymLinks: true,
        });
        assert.equal(
          readZipEntries(destination)[source].data.toString(),
          "contents\n"
        );
      }
    );
  }

  test("an unset force picks an implementation automatically", async () => {
    await bestzip.zip({ cwd, source, destination, followSymLinks: true });
    assert.equal(
      readZipEntries(destination)[source].data.toString(),
      "contents\n"
    );
  });

  test("invalid force values reject", async () => {
    for (const force of [true, "nope", "Node", 1, null]) {
      await assert.rejects(
        () => bestzip.zip({ cwd, source, destination, force }),
        /bestzip: force should be 'node' or 'native'/
      );
    }
  });
});
