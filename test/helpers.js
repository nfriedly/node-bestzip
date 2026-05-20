import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";

const init = (name) => {
  const tmpdir = path.join(os.tmpdir(), "bestzip", name); // path.join(__dirname, "tmp");
  fs.mkdirSync(tmpdir, { recursive: true });
  const destination = path.join(tmpdir, "test.zip");
  const cleanup = async () => {
    await fsp.rm(tmpdir, { recursive: true, force: true });
    await fsp.mkdir(tmpdir, { recursive: true });
    await fsp.rm("test/fixtures/injection", { recursive: true, force: true });
  };
  return { tmpdir, destination, cleanup };
};

export { init };
