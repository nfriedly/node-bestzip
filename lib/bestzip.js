// creates a zip file using either the native `zip` command if available,
// or a node.js zip implementation otherwise.

import cp, { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ZipArchive } from "archiver";
import { glob, hasMagic } from "glob";
import which from "which";

function hasNativeZip() {
  return Boolean(which.sync("zip", { nothrow: true }));
}

let nativeSymlinkCapability;

// The native zip command needs the --symlinks flag to store symlinks as links
// rather than following them. Not every build supports it (notably the
// Windows build of Info-ZIP). This probes the installed zip for support, since
// the version string isn't a reliable indicator.
function nativeZipSupportsSymlinks() {
  if (nativeSymlinkCapability !== undefined) {
    return nativeSymlinkCapability;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-symlink-check"));
  try {
    const file = path.join(dir, "file");
    const link = path.join(dir, "link");
    fs.writeFileSync(file, "bestzip symlink check");
    try {
      fs.symlinkSync("file", link);
    } catch (e) {
      nativeSymlinkCapability = false;
      return nativeSymlinkCapability;
    }
    const res = spawnSync(
      "zip",
      ["-q", "--symlinks", "check.zip", "file", "link"],
      {
        cwd: dir,
        encoding: "utf8",
      }
    );
    nativeSymlinkCapability = res.status === 0;
  } catch (e) {
    nativeSymlinkCapability = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return nativeSymlinkCapability;
}

async function expandSources(cwd, source) {
  // options to behave more like the native zip's glob support
  const globOpts = {
    cwd,
    dot: false, // ignore .dotfiles
    noglobstar: true, // treat ** as *
    noext: true, // no (a|b)
    nobrace: true, // no {a,b}
  };

  // first handle arrays
  if (Array.isArray(source)) {
    const results = await Promise.all(source.map((s) => expandSources(cwd, s)));
    return results.flat();
  }

  // then expand magic
  if (typeof source !== "string") {
    throw new Error(`source is (${typeof source}) `);
  }

  if (hasMagic(source, globOpts)) {
    // archiver uses this library but somehow ends up with different results on windows:
    // archiver.glob('*') will include subdirectories, but omit their contents on windows
    // so we'll use glob directly, and add all of the files it finds
    return await glob(source, globOpts);
  } else {
    // or just trigger the callback with the source string if there is no magic
    // always return an array
    return [source];
  }
}

async function walkTree(fullPath, followSymLinks) {
  let stats;
  if (followSymLinks) {
    stats = await fsp.stat(fullPath);
  } else {
    stats = await fsp.lstat(fullPath);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return [{ path: fullPath, stats }];
  }
  const entries = await fsp.readdir(fullPath);
  const children = await Promise.all(
    entries.map((entry) => walkTree(path.join(fullPath, entry), followSymLinks))
  );
  return children.flat();
}

// Validates the compression level. A level of exactly 0-9 (an integer) is
// accepted; anything else that is set causes an error. An unset level is
// allowed and left to each implementation's default.
function validateLevel(level) {
  if (typeof level === "undefined") {
    return;
  }
  if (
    typeof level !== "number" ||
    !Number.isInteger(level) ||
    level < 0 ||
    level > 9
  ) {
    const typehint = typeof level === "number" ? "" : ` (${typeof level})`;
    throw new Error(
      `bestzip: level should be an integer from 0 to 9, got ${level}${typehint}`
    );
  }
}

async function detectSymlinks(cwd, sources) {
  const results = await Promise.all(
    sources.map(async (source) => {
      const fullPath = path.resolve(cwd, source);
      const entries = await walkTree(fullPath, false);
      return entries
        .filter((entry) => entry.stats.isSymbolicLink())
        .map((entry) => entry.path);
    })
  );
  return results.flat();
}

function maybeWarnAboutSymlinks(options, symlinks, cwd) {
  if (options.followSymLinks !== undefined || symlinks.length === 0) {
    return;
  }
  const cli = options.viaCli;
  const optIn = cli ? "pass --follow-sym-links" : "set followSymLinks: true";
  const optOut = cli
    ? "pass --no-follow-sym-links"
    : "set followSymLinks: false";
  let lines = symlinks.map((p) => path.relative(cwd, p));
  if (lines.length > 4) {
    lines = lines.slice(0, 3);
    lines.push(`...and ${symlinks.length - 3} more`);
  }
  console.warn(
    "Warning: Symbolic links are followed by default — their target contents are included in the archive.\n" +
      `To keep this behavior and prevent this warning, ${optIn}.\n` +
      `To store symlinks as links instead, ${optOut}.\n` +
      "This default will change in v4 to store symlinks as links. " +
      "Set followSymLinks explicitly to opt in to following.\n" +
      "Detected symlinks:\n" +
      lines.join("\n")
  );
}

const nativeZip = async (options) => {
  const cwd = options.cwd || process.cwd();
  const command = "zip";
  const sources = await expandSources(cwd, options.source);
  const destination = path.resolve(cwd, options.destination);
  validateLevel(options.level);
  // followSymLinks: false opts into storing symlinks as links; the default
  // (unset or true) follows symlinks and is unchanged.
  const storeLinks = options.followSymLinks === false;

  if (storeLinks && !nativeZipSupportsSymlinks()) {
    // The native zip command cannot store symlinks as links on this platform
    // (e.g. the Windows build of Info-ZIP). nodeZip can, so the bestzip()
    // entry point routes accordingly — but a direct nativeZip() call can't
    // fulfill this request.
    throw new Error(
      "The native zip command on this platform cannot store symlinks as links. Use the bestzip() entry point, which will select the node implementation, or set followSymLinks to true to follow symlinks instead."
    );
  }

  const args = ["--quiet", "--recurse-paths"];
  if (typeof options.level === "number") {
    args.push("-" + options.level.toString());
  }
  if (storeLinks) {
    args.push("--symlinks");
  }
  args.push(destination, "--", ...sources);

  // Scan for symlinks to warn about in parallel with the zip command.
  const warnScan =
    options.followSymLinks === undefined
      ? detectSymlinks(cwd, sources)
      : Promise.resolve([]);

  const zipPromise = new Promise((resolve, reject) => {
    const zipProcess = cp.spawn(command, args, {
      stdio: "inherit",
      cwd,
    });
    zipProcess.on("error", reject);
    zipProcess.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Unexpected exit code from native zip: ${exitCode}\n executed command '${command} ${args.join(
              " "
            )}'\n executed in directory '${cwd}'`
          )
        );
      }
    });
  });

  const [symlinks] = await Promise.all([warnScan, zipPromise]);
  maybeWarnAboutSymlinks(options, symlinks, cwd);
};

// based on http://stackoverflow.com/questions/15641243/need-to-zip-an-entire-directory-using-node-js/18775083#18775083
const nodeZip = async (options) => {
  const cwd = options.cwd || process.cwd();
  validateLevel(options.level);
  // followSymLinks: false stores symlinks as links; the default (unset or
  // true) follows symlinks, matching the native zip implementation.
  const storeLinks = options.followSymLinks === false;
  const symlinks = [];
  const outputFile = await fsp.open(
    path.resolve(cwd, options.destination),
    "w"
  );
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

    if (storeLinks) {
      // Store symlinks as link entries (their targets, not their contents).
      const entries = await walkTree(fullPath, false);
      for (const entry of entries) {
        const subPath = entry.path.substring(fullPath.length);
        if (entry.stats.isSymbolicLink()) {
          symlinks.push(entry.path);
          archive.symlink(
            destPath + subPath,
            await fsp.readlink(entry.path),
            entry.stats.mode
          );
        } else {
          archive.file(entry.path, {
            name: destPath + subPath,
            stats: entry.stats,
          });
        }
      }
      return;
    }

    // Follow symlinks by default. Pass explicit (stat) stats so archiver
    // dereferences symlinks and stores their target contents rather than the
    // link itself, matching the native zip implementation.
    const entries = await walkTree(fullPath, true);
    for (const entry of entries) {
      const archiveName = destPath + entry.path.substring(fullPath.length);
      archive.file(entry.path, {
        name: archiveName,
        stats: entry.stats,
      });
    }

    // Warn while following by default (followSymLinks unset): detect symlinks
    // via an lstat walk so the deprecation warning still fires even though the
    // archive stores their target contents.
    if (options.followSymLinks === undefined) {
      const detected = await walkTree(fullPath, false);
      for (const entry of detected) {
        if (entry.stats.isSymbolicLink()) {
          symlinks.push(entry.path);
        }
      }
    }
  }

  try {
    const expandedSources = await expandSources(cwd, options.source);
    await Promise.all(expandedSources.map(addSource));
    maybeWarnAboutSymlinks(options, symlinks, cwd);
    archive.finalize();
  } catch (err) {
    rejectPromise(err);
  }

  return promise;
};

function zip(options) {
  const compatMode = typeof options === "string";
  if (compatMode) {
    options = {
      source: arguments[1],
      destination: arguments[0],
    };
  }

  // The native zip command can store symlinks as links only when it supports
  // --symlinks. If followSymLinks is not explicitly false, it just follows
  // symlinks, which every native zip can do. When storing links is requested
  // but the native zip can't do it, fall back to the node implementation.
  const useNative =
    hasNativeZip() &&
    (options.followSymLinks !== false || nativeZipSupportsSymlinks());

  let promise;
  if (useNative) {
    promise = nativeZip(options);
  } else {
    promise = nodeZip(options);
  }

  if (compatMode) {
    promise.then(arguments[2]).catch(arguments[2]);
  } else {
    return promise;
  }
}

export default zip;

export { zip, nodeZip, nativeZip, hasNativeZip, nativeZipSupportsSymlinks };
