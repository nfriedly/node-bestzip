import path from "node:path";
import fsp from "node:fs/promises";
import os from "node:os";

const init = (name, copyFixtures = false) => {
  const tmpdir = path.join(os.tmpdir(), `bestzip_${name}`);
  const destination = path.join(tmpdir, "test.zip");
  const fixturesDir = copyFixtures
    ? path.join(tmpdir, "fixtures")
    : "test/fixtures";

  const cleanup = async () => {
    await fsp.rm(tmpdir, { recursive: true, force: true });
  };

  const reset = async () => {
    await cleanup();
    await fsp.mkdir(tmpdir, { recursive: true });
    if (copyFixtures) {
      await fsp.cp("test/fixtures", fixturesDir, { recursive: true });
    }
  };
  return { tmpdir, fixturesDir, destination, reset, cleanup };
};

export { init };
