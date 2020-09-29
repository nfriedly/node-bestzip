"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const promisify = require("util").promisify;
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const rimraf = promisify(require("rimraf"));

const init = name => {
  const tmpdir = path.join(os.tmpdir(), "bestzip", name); // path.join(__dirname, "tmp");
  fs.mkdirSync(tmpdir, { recursive: true });
  const destination = path.join(tmpdir, "test.zip");
  const cleanup = async () => {
    await rimraf(tmpdir);
    await mkdir(tmpdir, { recursive: true });
    await rimraf("test/fixtures/injection");
  };
  return { tmpdir, destination, cleanup };
};

module.exports = {
  init,
  stat
};
