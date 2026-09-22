import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import cp, { spawnSync } from "node:child_process";
import os from "node:os";
import { isDeepStrictEqual } from "node:util";

import { expandSources, findInDir, safeStat } from "./fs-utils.js";
import {
  detectSymlinks,
  maybeWarnAboutSymlinks,
  validateLevel,
} from "./validate.js";

export const nativeZip = async (options) => {
  const cwd = options.cwd || process.cwd();
  // Resolve the absolute path in the parent's context and pass that to the
  // child. Resolving the bare `zip` name inside the spawned process would let
  // the archive directory's contents shadow the real binary when PATH has a
  // relative or empty element (CWE-426/CWE-427).
  const command = getNativeZipCommand();
  if (!command) {
    throw new Error(
      "The native zip command was not found at a trusted location on this system."
    );
  }
  const sources = await expandSources(cwd, options.source);
  const destination = path.resolve(cwd, options.destination);
  validateLevel(options.level);
  const destStatBefore = await safeStat(destination);
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
    zipProcess.on("close", async (exitCode) => {
      if (exitCode === 0) {
        // The native zip reported success. Make sure it actually wrote the
        // archive — the zip exits 0 without creating or updating the
        // destination, that's a silent no-op, not a real archive.
        const destStatAfter = await safeStat(destination);
        if (
          destStatAfter &&
          !isDeepStrictEqual(destStatBefore, destStatAfter)
        ) {
          resolve();
        } else {
          reject(
            new Error(
              `The native zip command exited 0 but did not ${
                destStatBefore ? "update" : "create"
              } the destination archive '${destination}'. This may indicate a broken or incompatible native zip command, or a filesystem issue. Consider using ${
                options.viaCli ? "--force=node" : `{force: 'node'}`
              }.\n Executed command: '${command} ${args.join(
                " "
              )}'\n Executed in directory: '${cwd}'`
            )
          );
        }
      } else {
        reject(
          new Error(
            `Unexpected exit code from native zip: ${exitCode}\n Executed command: '${command} ${args.join(
              " "
            )}'\n Executed in directory '${cwd}'`
          )
        );
      }
    });
  });

  const [symlinks] = await Promise.all([warnScan, zipPromise]);
  maybeWarnAboutSymlinks(options, symlinks, cwd);
};

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

export function hasNativeZip() {
  return Boolean(getNativeZipCommand());
}

let nativeSymlinkCapability;

// The native zip command needs the --symlinks flag to store symlinks as links
// rather than following them. Not every build supports it (notably the
// Windows build of Info-ZIP). This probes the installed zip for support, since
// the version string isn't a reliable indicator.
export function nativeZipSupportsSymlinks() {
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
