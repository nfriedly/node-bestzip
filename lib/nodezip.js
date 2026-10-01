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

  // native zip uses the source as the prefix for the entry names it stores,
  // minus any leading "./" (or a leading "/" for an absolute source). So
  // `cd dist && bestzip ../dist.zip .` stores `index.js`, not `./index.js`, and
  // a source of `.` or `./` contributes no prefix at all. Everything else
  // (including `..` and interior `..` segments) is kept verbatim, matching what
  // native zip does.
  const archivePrefix = (source) => {
    let prefix = source;
    while (/^\.[/\\]/.test(prefix)) {
      prefix = prefix.slice(2);
    }
    return prefix === "." ? "" : prefix.replace(/^[/\\]+/, "");
  };

  async function addSource(source) {
    const fullPath = path.resolve(cwd, source);
    const destPath = archivePrefix(source);

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
      // entry.path and fullPath are both absolute and normalized, so the
      // remainder always starts with a separator. With no prefix (a source of
      // `.`/`./`) that separator would become a leading "/" on every entry
      // name, so drop it — otherwise the two halves concatenate as they always
      // have.
      const relative = entry.path.substring(fullPath.length);
      const archiveName = destPath
        ? destPath + relative
        : relative.replace(/^[/\\]+/, "");
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
          [".", "..", ""].includes(path.basename(archiveName))
        ) {
          // Skip the source's own root entry, which names nothing inside the
          // archive. archiver strips a leading "../" (and "/") from every
          // entry name, so for a source of `..` this entry would be stored
          // under an empty name — a nameless entry that extractors choke on
          // (EISDIR, or a mismatched-filename warning from unzip). native zip
          // stores "../" here; we cannot, because that name does not survive
          // archiver's sanitizing, so dropping it is the closest safe option.
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
