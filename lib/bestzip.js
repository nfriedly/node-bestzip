// creates a zip file using either the native `zip` command if available,
// or a node.js zip implementation otherwise.

import cp, { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ZipArchive } from "archiver";
import { glob, hasMagic } from "glob";

// Directories where the system `zip` command is expected to live. Only these
// are ever consulted, so a file named `zip` anywhere else — committed into an
// archived directory, delivered through a relative/empty PATH element, or
// dropped into node_modules/.bin by a dependency — is never executed
// (CWE-426/CWE-427).
const DEFAULT_ZIP_DIRS = (() => {
  if (process.platform === "win32") {
    // note, some node.js environments, like MINGW64 (git-bash), report SystemRoot
    // and ProgramFiles as uppercase, but they still support the version here
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA;
    const userProfile = process.env.USERPROFILE;

    const dirs = [
      path.join(systemRoot, "System32"),
      systemRoot,
      "C:\\ProgramData\\chocolatey\\bin",
      path.join(programFiles, "Git\\usr\\bin"),
      path.join(programFilesX86, "Git\\usr\\bin"),
    ];

    if (localAppData) {
      dirs.push(path.join(localAppData, "Microsoft\\WinGet\\Links"));
    }
    if (userProfile) {
      dirs.push(path.join(userProfile, "scoop\\shims"));
    }

    return dirs;
  }

  return [
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin", // Homebrew on Apple Silicon
    "/opt/local/bin", // MacPorts
    "/snap/bin", // Linux Snap packages
    "/nix/var/nix/profiles/default/bin", // Nix OS/Package Manager
  ];
})();

const ZIP_EXECUTABLE_NAMES =
  process.platform === "win32" ? ["zip.exe", "zip"] : ["zip"];

function isExecutableFile(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
}

function findInDir(dir, names) {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Resolves the native `zip` binary's absolute path, or null when none is
// usable (so callers fall back to the node implementation). PATH is never
// consulted: the child process chdirs into the (possibly untrusted) archive
// directory before running, so a bare command name could be shadowed by a
// `zip` planted there or in the dependency tree (CWE-426/CWE-427). Only the
// allowlisted system directories above are ever checked, and the resolved
// absolute path — never the bare `zip` name — is what gets spawned.
let nativeZipCommand;
function getNativeZipCommand() {
  if (nativeZipCommand !== undefined) {
    return nativeZipCommand;
  }
  nativeZipCommand = null;
  for (const dir of DEFAULT_ZIP_DIRS) {
    const found = findInDir(dir, ZIP_EXECUTABLE_NAMES);
    if (found) {
      nativeZipCommand = found;
      break;
    }
  }
  return nativeZipCommand;
}

function hasNativeZip() {
  return Boolean(getNativeZipCommand());
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
  const command = getNativeZipCommand();
  if (!command) {
    nativeSymlinkCapability = false;
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
      command,
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
    "Warning: Symbolic links are stored as the link itself rather than the destination by default.\n" +
      `To keep the default behavior and prevent this warning, ${optOut}.\n` +
      `To follow symlinks and include their target contents, ${optIn}.\n` +
      "Detected symlinks:\n" +
      lines.join("\n")
  );
}

const nativeZip = async (options) => {
  const cwd = options.cwd || process.cwd();
  // Resolve the absolute path in the parent's context and pass that to the
  // child. Resolving the bare `zip` name inside the spawned process would let
  // the archive directory's contents shadow the real binary when PATH has a
  // relative or empty element (CWE-426/CWE-427).
  const command = getNativeZipCommand();
  if (!command) {
    throw new Error("The native zip command is not available on this system.");
  }
  const sources = await expandSources(cwd, options.source);
  const destination = path.resolve(cwd, options.destination);
  validateLevel(options.level);
  // followSymLinks: true opts into following symlinks (archiving their target
  // contents); the default (unset or false) stores symlinks as links.
  const followSymLinks = options.followSymLinks === true;

  if (!followSymLinks && !nativeZipSupportsSymlinks()) {
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
  if (!followSymLinks) {
    args.push("--symlinks");
  }
  args.push(destination, "--", ...sources);

  // Scan for symlinks to warn about in parallel with the zip command. The
  // scan is best-effort: if it fails (e.g. it races the zip command touching
  // the same paths), log and fall back to no warning rather than aborting the
  // zip, and never let it reject before the zip process has completed.
  const warnScan = (async () => {
    if (options.followSymLinks !== undefined) {
      return [];
    }
    try {
      return await detectSymlinks(cwd, sources);
    } catch (err) {
      console.warn(
        `bestzip: failed to scan for symlinks to warn about: ${err.message}`
      );
      return [];
    }
  })();

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
  // followSymLinks: true follows symlinks and archives their target contents;
  // the default (unset or false) stores symlinks as links.
  const followSymLinks = options.followSymLinks === true;
  const trackSymLinks = typeof options.followSymLinks === "undefined";
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

    // Walk the source once in the requested mode: an lstat walk when storing
    // links (symlinks are emitted as their own entries and stored as links),
    // or a stat walk when following (symlinks are dereferenced and their
    // target contents archived, matching the native zip implementation).
    const entries = await walkTree(fullPath, followSymLinks);
    for (const entry of entries) {
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
        archive.file(entry.path, {
          name: archiveName,
          stats: entry.stats,
        });
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

  // By default symlinks are stored as links, not followed. The native zip
  // command can always follow symlinks (followSymLinks: true), but can only
  // store them as links when it supports --symlinks. When storing links is
  // requested but the native zip can't do it, fall back to the node
  // implementation, which can store links regardless.
  const useNative =
    hasNativeZip() &&
    (options.followSymLinks === true || nativeZipSupportsSymlinks());

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

export {
  zip,
  zip as bestZip,
  nodeZip,
  nativeZip,
  hasNativeZip,
  nativeZipSupportsSymlinks,
};
