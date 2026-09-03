// creates a zip file using either the native `zip` command if available,
// or a node.js zip implementation otherwise.

import cp, { spawnSync } from "node:child_process";
import fs from "node:fs";
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

function walkDir(fullPath) {
  const files = fs.readdirSync(fullPath).map((f) => {
    const filePath = path.join(fullPath, f);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return walkDir(filePath);
    }
    return filePath;
  });
  return files.reduce((acc, cur) => acc.concat(cur), []);
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

function detectSymlinks(cwd, sources) {
  const symlinks = [];
  for (const source of sources) {
    const fullPath = path.resolve(cwd, source);
    let stats;
    try {
      stats = fs.lstatSync(fullPath);
    } catch (e) {
      continue;
    }
    if (stats.isSymbolicLink()) {
      symlinks.push(fullPath);
    } else if (stats.isDirectory()) {
      const entries = walkDir(fullPath);
      for (const entry of entries) {
        const entryStats = fs.lstatSync(entry);
        if (entryStats.isSymbolicLink()) {
          symlinks.push(entry);
        }
      }
    }
  }
  return symlinks;
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

  if (options.followSymLinks === undefined) {
    const symlinks = detectSymlinks(cwd, sources);
    maybeWarnAboutSymlinks(options, symlinks, cwd);
  }

  const args = ["--quiet", "--recurse-paths"];
  if (typeof options.level === "number") {
    args.push("-" + options.level.toString());
  }
  if (storeLinks) {
    args.push("--symlinks");
  }
  args.push(destination, "--", ...sources);

  return new Promise((resolve, reject) => {
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
};

// based on http://stackoverflow.com/questions/15641243/need-to-zip-an-entire-directory-using-node-js/18775083#18775083
const nodeZip = async (options) => {
  const cwd = options.cwd || process.cwd();
  validateLevel(options.level);
  // followSymLinks: false stores symlinks as links; the default (unset or
  // true) follows symlinks, matching the native zip implementation.
  const storeLinks = options.followSymLinks === false;
  const symlinks = [];
  const output = fs.createWriteStream(path.resolve(cwd, options.destination));
  const archive = new ZipArchive({
    zlib: { level: options.level },
  });

  output.on("close", () => resolvePromise());
  archive.on("error", (err) => rejectPromise(err));

  archive.pipe(output);

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  // Walks a directory tree without following symlinks. Uses lstat so symlinks
  // are returned as their own entries (and not recursed into), letting them be
  // stored as links rather than as their target contents.
  function walkDirNoFollow(fullPath) {
    const out = [];
    for (const entry of fs.readdirSync(fullPath)) {
      const filePath = path.join(fullPath, entry);
      const lstats = fs.lstatSync(filePath);
      if (lstats.isSymbolicLink()) {
        out.push({ path: filePath, stats: lstats });
      } else if (lstats.isDirectory()) {
        out.push(...walkDirNoFollow(filePath));
      } else {
        out.push({ path: filePath, stats: lstats });
      }
    }
    return out;
  }

  async function addSource(source) {
    const fullPath = path.resolve(cwd, source);
    const destPath = source;

    if (storeLinks) {
      const lstats = await fs.promises.lstat(fullPath);
      if (lstats.isSymbolicLink()) {
        symlinks.push(fullPath);
        archive.symlink(
          destPath,
          await fs.promises.readlink(fullPath),
          lstats.mode
        );
        return;
      }
      if (lstats.isDirectory()) {
        for (const { path: p, stats } of walkDirNoFollow(fullPath)) {
          const subPath = p.substring(fullPath.length);
          if (stats.isSymbolicLink()) {
            symlinks.push(p);
            archive.symlink(
              destPath + subPath,
              await fs.promises.readlink(p),
              stats.mode
            );
          } else {
            archive.file(p, { name: destPath + subPath, stats });
          }
        }
        return;
      }
      if (lstats.isFile()) {
        archive.file(fullPath, { stats: lstats, name: destPath });
      }
      return;
    }

    const stats = await fs.promises.stat(fullPath);
    // Detect top-level symlink sources for the warning even when following them.
    if (options.followSymLinks === undefined) {
      const lstats = await fs.promises.lstat(fullPath);
      if (lstats.isSymbolicLink()) {
        symlinks.push(fullPath);
      }
    }
    if (stats.isDirectory()) {
      // Walk directory. Works on directories and directory symlinks.
      const files = walkDir(fullPath);
      for (const f of files) {
        const subPath = f.substring(fullPath.length);
        // Detect symlinks for the warning even when following them.
        if (options.followSymLinks === undefined) {
          const lstats = fs.lstatSync(f);
          if (lstats.isSymbolicLink()) {
            symlinks.push(f);
          }
        }
        // Pass explicit (stat) stats so archiver dereferences symlinks and
        // stores their target contents rather than the link itself. This makes
        // the default behavior match the native zip implementation, which
        // follows symlinks (only followSymLinks: false opts into storing them
        // as links via the storeLinks branch above).
        archive.file(f, {
          name: destPath + subPath,
          stats: fs.statSync(f),
        });
      }
    } else if (stats.isFile()) {
      archive.file(fullPath, { stats: stats, name: destPath });
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
