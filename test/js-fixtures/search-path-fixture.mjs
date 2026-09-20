// Runs bestzip in a child process with a fully controlled cwd and PATH so the
// untrusted-search-path and silent-failure behaviors can be tested in
// isolation. The caller sets the fixture's cwd and environment; the fixture
// just archives `app.js` from the cwd into the destination passed as argv[2]
// and reports what happened. Lives under test/js-fixtures/ — the unit-test
// glob is test/**/*.test.js, so it isn't picked up as a test file — and kept
// out of test/fixtures so fixture-copying tests don't copy it.
import fs from "node:fs";
import path from "node:path";

import * as bestzip from "../../lib/bestzip.js";

const [destination] = process.argv.slice(2);
const cwd = process.cwd();

async function main() {
  let rejected = false;
  let message = "";
  try {
    await bestzip.default({ destination, source: "app.js" });
  } catch (err) {
    rejected = true;
    message = String((err && err.message) || err);
  }
  const archiveExists = fs.existsSync(destination);
  process.stdout.write(
    JSON.stringify({
      cwd,
      archiveExists,
      archiveSize: archiveExists ? fs.statSync(destination).size : 0,
      pwnedExists: fs.existsSync(path.join(cwd, "PWNED.txt")),
      rejected,
      message,
    })
  );
}

main().catch((err) => {
  process.stderr.write(String((err && err.stack) || err));
  process.exit(1);
});