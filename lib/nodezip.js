import fsp from "node:fs/promises";
import path from "node:path";

import { ZipArchive } from "archiver";

import { expandSources, walkTree } from "./fs-utils.js";
import { maybeWarnAboutSymlinks, validateLevel } from "./validate.js";

export async function nodeZip(options) {
  const cwd = options.cwd || process.cwd();
  validateLevel(options.level);
  // followSymLinks: true follows symlinks and archives their target contents;
  // the default (unset or false) stores symlinks as links.
  const followSymLinks = options.followSymLinks === true;
  const trackSymLinks = typeof options.followSymLinks === "undefined";
  const symlinks = [];
  const destination = path.resolve(cwd, options.destination);
  const outputFile = await fsp.open(destination, "w");
  const output = outputFile.createWriteStream();
  const archive = new ZipArchive({
    zlib: { level: options.level },
  });

  output.on("close", async () => {
    await outputFile.close();
    resolvePromise();
  });
  archive.on("error", (err) => rejectPromise(err));
  archive.on("warning", (err) => console.warn(err && err.message));

  archive.pipe(output);

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  async function addSource(source) {
    const fullPath = path.resolve(cwd, source);
    const destPath = source;

    // Walk the source once in the requested mode: an lstat walk when storing
    // links (symlinks are emitted as their own entries and stored as links),
    // or a stat walk when following (symlinks are dereferenced and their
    // target contents archived, matching the native zip implementation).
    const entries = await walkTree(fullPath, followSymLinks);
    for (const entry of entries) {
      // The archive was created (and truncated) above, so a source that
      // reaches it — directly, or through a directory glob — would otherwise
      // archive a partial copy of the archive itself. walkTree yields absolute
      // normalized paths, so this compares directly.
      //
      // Known limit: neither implementation compares file identity, only paths,
      // so a destination accessed via a symlinked parent directory still
      // matches itself when the walk reaches the same file by its real path.
      // That needs followSymLinks: true plus an overlapping symlink, and it affects
      // nativeZip identically, so it is left alone rather than diverging here.
      if (entry.path === destination) {
        continue;
      }
      const archiveName = destPath + entry.path.substring(fullPath.length);
      if (entry.stats.isSymbolicLink()) {
        // Storing a link: keep the raw link target and record it for the
        // default warning (an explicit followSymLinks setting suppresses it).
        if (trackSymLinks) {
          symlinks.push(entry.path);
        }
        archive.symlink(
          archiveName,
          await fsp.readlink(entry.path),
          entry.stats.mode
        );
      } else {
        if (
          entry.stats.isDirectory() &&
          [".", ""].includes(path.basename(archiveName))
        ) {
          continue;
        }
        archive.file(entry.path, {
          name: archiveName,
          stats: entry.stats,
        });
      }
    }
  }

  try {
    const expandedSources = await expandSources(cwd, options.source);
    for (const source of expandedSources) {
      await addSource(source);
    }
    maybeWarnAboutSymlinks(options, symlinks, cwd);
    archive.finalize();
  } catch (err) {
    rejectPromise(err);
  }

  return promise;
}
