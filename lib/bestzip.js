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
// (plus anything the user points at explicitly, see getNativeZipCommand) are
// ever consulted, so a file named `zip` anywhere else — committed into an
// archived directory, delivered through a relative/empty PATH element, or
// dropped into node_modules/.bin by a dependency — is never executed
// (CWE-426/CWE-427).
const DEFAULT_ZIP_DIRS = (() => {
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    return [
      path.join(systemRoot, "System32"),
      systemRoot,
      "C:\\ProgramData\\chocolatey\\bin",
      path.join(programFiles, "Git\\usr\\bin"),
    ];
  }
  return [
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin", // Homebrew on Apple Silicon macOS
    "/opt/local/bin", // MacPorts
  ];
})();

const ZIP_EXECUTABLE_NAMES =
  process.platform === "win32" ? ["zip.exe", "zip"] : ["zip"];

// Resolves the native `zip` binary's absolute path, returning null when it
// isn't installed so callers fall back to the node implementation. The
// resolved path — never the bare `zip` name — is used to spawn the command:
// the child process chdirs into the (possibly untrusted) archive directory
// before execvp, and libuv would re-resolve a bare name relative to that
// directory when PATH contains a relative or empty element. By resolving only
// against an explicit allowlist of known system directories (never against
// PATH), the file that runs cannot be influenced by anything in the archive
// directory or the project's dependency tree.
//
// A custom location can be supplied for the unusual cases where `zip` lives
// somewhere else (Nix, ~/bin, custom container images, etc.); it is honored
// before the defaults and may be either a path to a `zip` executable or a
// directory that is searched for one:
//
//   - the `zipPath` option, e.g. bestzip({ source, destination, zipPath }),
//   - the BESTZIP_ZIP_PATH environment variable (handy in npm scripts / CI).
function getNativeZipCommand(options) {
  const explicit = options?.zipPath || process.env.BESTZIP_ZIP_PATH;
  if (explicit) {
    const found = findInExplicitLocation(explicit);
    if (found) {
      return found;
    }
  }
  for (const dir of DEFAULT_ZIP_DIRS) {
    const found = findInDir(dir, ZIP_EXECUTABLE_NAMES);
    if (found) {
      return found;
    }
  }
  // No trusted zip is usable. Before falling back to the node implementation,
  // check whether PATH offered one that was declined — and if so, say so and
  // point at the option that opts back into it. Suppressed by quiet: true in
  // environments (CI, containers) where the PATH zip is expected.
  maybeWarnAboutRefusedZip(options);
  return null;
}

// PATH is never consulted to decide what runs — that would reintroduce the
// CWE-426/CWE-427 issue the allowlist exists to fix. But when no trusted zip is
// usable, PATH is scanned read-only so the user can be told exactly which `zip`
// was declined and how to opt into it deliberately. Returns the refused
// executable's path, or null when PATH offers nothing outside the trusted set.
// `pathEnv` defaults to process.env.PATH; it is split on the platform delimiter
// just like the shell resolves it.
function findZipCommandOnUntrustedPath(pathEnv = process.env.PATH) {
  for (const entry of (pathEnv || "").split(path.delimiter)) {
    const found = findInDir(entry, ZIP_EXECUTABLE_NAMES);
    if (found) {
      return found;
    }
  }
  return null;
}

const warnedUntrustedZipPaths = new Set();

// Logs a warning naming a `zip` that was reachable only through PATH and
// therefore declined, describing how to use it deliberately (zipPath in code,
// BESTZIP_ZIP_PATH in the environment — there is no --zip-path CLI flag) and
// where to request a new default-trusted location. Returns the refused path, or
// null when there was nothing to warn about (or when `quiet` suppresses it). A
// given path is warned at most once per process so repeated resolution probes
// don't spam the build log. A `quiet` probe does not mark the path as warned,
// so a later non-quiet resolution still reports it.
function maybeWarnAboutRefusedZip(options = {}) {
  const { pathEnv = process.env.PATH, quiet, viaCli } = options;
  if (quiet) {
    return null;
  }
  const refused = findZipCommandOnUntrustedPath(pathEnv);
  if (!refused || warnedUntrustedZipPaths.has(refused)) {
    return null;
  }
  warnedUntrustedZipPaths.add(refused);
  // Scope the remedy to how bestzip was invoked. A programmatic caller can opt
  // in with the zipPath option; the CLI deliberately has no --zip-path flag
  // (a build argument could otherwise smuggle an executable path into the
  // command), so its only opt-in is the BESTZIP_ZIP_PATH environment variable.
  // Mirrors the CLI/API scoping in maybeWarnAboutSymlinks.
  const optIn = viaCli
    ? `set BESTZIP_ZIP_PATH='${refused}' in the environment`
    : `set zipPath: '${refused}' in code or BESTZIP_ZIP_PATH='${refused}' ` +
      "in the environment";
  const quietOptIn = viaCli ? "pass --quiet" : "set quiet: true";
  console.warn(
    `Warning: bestzip found a \`zip\` command at '${refused}' but it is not ` +
      "in the trusted system directories, so bestzip will not run it " +
      "(CWE-426/CWE-427). Falling back to the built-in node zip implementation.\n" +
      `To use this zip, ${optIn}.\n` +
      `To suppress this warning and other non-error output,${quietOptIn}.\n` +
      "If this is a path that should be trusted by default, please " +
      "open a ticket or pull request at https://github.com/nfriedly/node-bestzip."
  );
  return refused;
}

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

function findInExplicitLocation(location) {
  const resolved = path.resolve(location);
  if (isExecutableFile(resolved)) {
    return resolved;
  }
  try {
    if (fs.statSync(resolved).isDirectory()) {
      return findInDir(resolved, ZIP_EXECUTABLE_NAMES);
    }
  } catch (e) {
    // falls through to null
  }
  return null;
}

function hasNativeZip(options) {
  return Boolean(getNativeZipCommand(options));
}

const nativeSymlinkCapabilityByCommand = new Map();

// The native zip command needs the --symlinks flag to store symlinks as links
// rather than following them. Not every build supports it (notably the
// Windows build of Info-ZIP). This probes the installed zip for support, since
// the version string isn't a reliable indicator. The result is cached per
// resolved command, so the probe runs at most once for any given binary.
// (CLI use would only ever check a single binary, but API use could involve multiple)
function nativeZipSupportsSymlinks(options) {
  const command = getNativeZipCommand(options);
  if (!command) {
    return false;
  }
  if (nativeSymlinkCapabilityByCommand.has(command)) {
    return nativeSymlinkCapabilityByCommand.get(command);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bestzip-symlink-check"));
  let capable = true;
  try {
    const file = path.join(dir, "file");
    const link = path.join(dir, "link");
    fs.writeFileSync(file, "bestzip symlink check");
    try {
      fs.symlinkSync("file", link);
    } catch (e) {
      capable = false;
    }
    if (capable) {
      const res = spawnSync(
        command,
        ["-q", "--symlinks", "check.zip", "file", "link"],
        {
          cwd: dir,
          encoding: "utf8",
        }
      );
      capable = res.status === 0;
    }
  } catch (e) {
    capable = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  nativeSymlinkCapabilityByCommand.set(command, capable);
  return capable;
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
  if (
    options.quiet ||
    options.followSymLinks !== undefined ||
    symlinks.length === 0
  ) {
    return;
  }
  const cli = options.viaCli;
  const optIn = cli ? "pass --follow-sym-links" : "set followSymLinks: true";
  const optOut = cli
    ? "pass --no-follow-sym-links"
    : "set followSymLinks: false";
  const quietOptOut = cli ? "pass --quiet" : "set quiet: true";
  let lines = symlinks.map((p) => path.relative(cwd, p));
  if (lines.length > 4) {
    lines = lines.slice(0, 3);
    lines.push(`...and ${symlinks.length - 3} more`);
  }
  console.warn(
    "Warning: Symbolic links are stored as the link itself rather than the destination by default.\n" +
      `To keep the default behavior and prevent this warning, ${optOut}.\n` +
      `To follow symlinks and include their target contents, ${optIn}.\n` +
      `To suppress this and other non-error output, ${quietOptOut}.\n` +
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
  const command = getNativeZipCommand(options);
  if (!command) {
    throw new Error("The native zip command is not available on this system.");
  }
  const sources = await expandSources(cwd, options.source);
  const destination = path.resolve(cwd, options.destination);
  validateLevel(options.level);
  // followSymLinks: true opts into following symlinks (archiving their target
  // contents); the default (unset or false) stores symlinks as links.
  const followSymLinks = options.followSymLinks === true;

  if (!followSymLinks && !nativeZipSupportsSymlinks(options)) {
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
  // zip, and never let it reject before the zip process has completed. The
  // scan only exists to feed the default symlink warning, so quiet mode skips
  // it altogether (saving a full tree walk on large builds).
  const warnScan = (async () => {
    if (options.followSymLinks !== undefined || options.quiet) {
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
    zipProcess.on("close", async (exitCode) => {
      if (exitCode === 0) {
        try {
          // A 0 exit is only a success if the archive was actually written. A
          // broken or compromised `zip` can exit 0 without producing output;
          // don't report that as success (downstream would consume a stale or
          // missing artifact).
          await fsp.stat(destination);
          resolve();
        } catch (err) {
          reject(
            new Error(
              `Native zip exited with code 0 but did not create the archive at '${destination}': ${err.message}`
            )
          );
        }
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
  // Only track symlinks for the default-behavior warning, which quiet mode
  // suppresses (and skips collecting).
  const trackSymLinks =
    typeof options.followSymLinks === "undefined" && !options.quiet;
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
  archive.on("warning", (err) => {
    if (!options.quiet) {
      console.warn(err && err.message);
    }
  });

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
    Boolean(getNativeZipCommand(options)) &&
    (options.followSymLinks === true || nativeZipSupportsSymlinks(options));

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
  findZipCommandOnUntrustedPath,
  maybeWarnAboutRefusedZip,
};
