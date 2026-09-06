// Runs bestzip scenarios in a fresh process where PATH points at an "incapable"
// native zip (one that rejects --symlinks), simulating the Windows Info-ZIP
// build. Kept out of test/fixtures so fixture-copying tests don't pick it up.
import path from "node:path";

import * as bestzip from "./lib/bestzip.js";
import { readZipEntries } from "./test/helpers.js";

const [cwd, mode] = process.argv.slice(2);
const destination = path.join(cwd, "out.zip");

async function main() {
  const supports = bestzip.nativeZipSupportsSymlinks();
  let result;
  if (mode === "route") {
    await bestzip.default({ cwd, source: "archive-me/", destination });
    const entries = readZipEntries(destination);
    result = {
      supports,
      leakType: entries["archive-me/leak.txt"].type,
      vendorType: entries["archive-me/vendor"].type,
      hasCreds: Boolean(entries["archive-me/vendor/creds.env"]),
      leakTarget: entries["archive-me/leak.txt"].data.toString(),
    };
  } else if (mode === "throw") {
    try {
      await bestzip.nativeZip({ cwd, source: "archive-me/", destination });
      result = { supports, threw: false };
    } catch (err) {
      result = { supports, threw: true, message: err.message };
    }
  } else if (mode === "follow") {
    await bestzip.nativeZip({
      cwd,
      source: "archive-me/",
      destination,
      followSymLinks: true,
    });
    const entries = readZipEntries(destination);
    result = {
      supports,
      leakType: entries["archive-me/leak.txt"].type,
      hasSecret: entries["archive-me/leak.txt"].data
        .toString()
        .includes("SECRET="),
    };
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
