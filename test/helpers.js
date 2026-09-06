import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import fsp from "node:fs/promises";
import os from "node:os";

// Minimal zip parser: returns a map of entry name -> { type, data }
// based on the central directory and local file headers.
// The high bits of the external attributes encode the POSIX file type
// (e.g. S_IFREG for a regular file, S_IFLNK for a symlink).
function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error("EOCD not found");
  }
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const localHeaderOffset = buf.readUInt32LE(off + 42);
    const external = buf.readUInt32LE(off + 38);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (!name.endsWith("/")) {
      const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const raw = buf.slice(dataStart, dataStart + compressedSize);
      const data =
        method === 0
          ? raw
          : zlib.inflateRawSync(raw, { maxOutputLength: 1 << 26 });
      entries[name] = {
        type: (external >>> 16) & 0xf000,
        data,
      };
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

let canCreateSymlinksCache;

// Some platforms (e.g. Windows without Developer Mode or admin rights) cannot
// create symlinks (EPERM). Tests that depend on symlinks should skip then.
function canCreateSymlinks() {
  if (canCreateSymlinksCache !== undefined) {
    return canCreateSymlinksCache;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-symlink-"));
  try {
    const target = path.join(dir, "target");
    const link = path.join(dir, "link");
    fs.writeFileSync(target, "");
    fs.symlinkSync(target, link);
    canCreateSymlinksCache = true;
  } catch (e) {
    canCreateSymlinksCache = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return canCreateSymlinksCache;
}
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

export { init, canCreateSymlinks, readZipEntries };
