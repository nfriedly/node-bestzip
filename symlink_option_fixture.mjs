// Runs bestzip scenarios in a fresh process where PATH points at a fake native
// zip that cannot store symlinks as links (simulating the Windows Info-ZIP
// build). Used to deterministically exercise the "native zip can't store
// symlinks" path regardless of whether a capable native zip is installed.
// Lives at the repo root (not under test/) so the test runner doesn't pick it
// up as a test file, and kept out of test/fixtures so fixture-copying tests
// don't copy it.
import path from "node:path";

import * as bestzip from "./lib/bestzip.js";
import { readZipEntries } from "./test/helpers.js";

const [cwd, mode] = process.argv.slice(2);
const destination = path.join(cwd, "out.zip");

async function main() {
  const supports = bestzip.nativeZipSupportsSymlinks();
  let result;
  if (mode === "route") {
    await bestzip.default({
      cwd,
      source: "archive-me/",
      destination,
      followSymLinks: false,
    });
    const entries = readZipEntries(destination);
    result = {
      supports,
      linkType: entries["archive-me/link.txt"].type,
      vendorType: entries["archive-me/vendor"].type,
      linkTarget: entries["archive-me/link.txt"].data.toString(),
    };
  } else if (mode === "throw") {
    try {
      await bestzip.nativeZip({
        cwd,
        source: "archive-me/",
        destination,
        followSymLinks: false,
      });
      result = { supports, threw: false };
    } catch (err) {
      result = { supports, threw: true, message: err.message };
    }
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
