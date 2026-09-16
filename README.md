# bestzip

[![tests](https://github.com/nfriedly/node-bestzip/actions/workflows/ci.yml/badge.svg)](https://github.com/nfriedly/node-bestzip/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/bestzip.svg)](https://www.npmjs.com/package/bestzip)
[![npm downloads](https://img.shields.io/npm/dm/bestzip)](https://www.npmjs.com/package/bestzip)

This module provides a `bestzip` command that calls the native `zip` command if available and otherwise falls back to a
Node.js implementation.

The `--recurse-directories` (`-r`) option is automatically enabled.

## Why?

The native `zip` command on GNU/Linux and macOS is significantly faster and creates moderately smaller .zip files than the Node.js version included here, but Windows has no built-in `zip` command. This module provides the best of both worlds, and allows for easier cross-platform scripting.

## Global command line usage

```bash
npm install -g bestzip
bestzip --no-follow-sym-links destination.zip source/ [other sources...]
```

## Command line usage within `package.json` scripts

```bash
npm install --save-dev bestzip
```

package.json:

```javascript
{
    //...
    "scripts": {
        "build": "...",
        "zip": "bestzip --no-follow-sym-links bundle.zip build/*",
        "upload": "....",
        "deploy": "npm run build && npm run zip && npm run upload"
    }
}
```

## Command line options

* `--follow-sym-links` / `--no-follow-sym-links`: Follow symbolic links and include their target contents in the archive, or don't follow and instead include the link itself (the default). If symlinks are encountered when the flag is not set, a warning will be logged.
* `--level N` / `-N`: Level of compression, as with the native `zip` command. `N` must be an integer from 0 (store, no compression) to 9 (maximum compression). Defaults to each implementation's own default when unset.
* `--force node|native`: Force the Node.js implementation or the native `zip` command instead of letting bestzip pick automatically.
* `--quiet` / `-q`: Suppress advisory warnings and progress output; only errors are printed. Useful in CI or scripts where a missing native `zip` or the default symlink behavior (and their warnings) are expected. See [Suppressing warnings](#suppressing-warnings).


## Programmatic usage from within Node.js

```javascript
import { bestZip } from 'bestzip';
// const { bestZip } = require('bestzip'); // for CJS (requires node.js v22 or newer

// zip a single source
await bestZip({
  source: 'build/*',
  destination: './destination.zip',
  followSymLinks: false,
})

// zip multiple sources, starting in a different CWD (current working directory)
await bestZip({
  source: ['img1.jpg', 'img2.jpg', 'imgn.jpg'],
  destination: '../images.zip',
  cwd: './images/', // optional, defaults to process.cwd()
  followSymLinks: false,
})

// Promises also work: zip({source, destination}).then(...).catch(...)
// Callbacks also work: zip(destination, sources, callback)
```

### API Options

* `source`: Path or paths to files and folders to include in the zip file. String or Array of Strings.
* `destination`: Path to generated .zip file.
* `cwd`: Set the Current Working Directory that source and destination paths are relative to. Defaults to `process.cwd()`
* `level`: Level of compression, as with the native `zip` command. An integer from 0 (store, no compression) to 9 (maximum compression). Defaults to each implementation's own default when unset.
* `followSymLinks`: Follow symbolic links and include the contents of their targets in the zip file. When set to `true` or `false` the preference is honored and no warning is printed. When left unset, symbolic links are **not** followed and a warning is printed whenever symlinks are detected (see [Symbolic links](#symbolic-links)).
* `zipPath`: Path to a `zip` executable (or a directory to search for one) to use for the native fast path. Defaults to `BESTZIP_ZIP_PATH`, then to a hardcoded list of trusted system directories. When no native `zip` is found, bestzip falls back to its built-in Node.js implementation.
* `quiet`: Suppress bestzip's advisory warnings (the refused-`zip` warning and the symlink default-behavior warning) and skip the symlink detection scan. Errors are still reported. See [Suppressing warnings](#suppressing-warnings).

## Which `zip` does bestzip run?

For the native fast path, bestzip only ever runs a `zip` binary it resolved itself from an explicit allowlist of trusted system locations — `/usr/bin`, `/bin`, `/usr/local/bin`, `/opt/homebrew/bin` and `/opt/local/bin` on macOS/Linux; the `System32` directory, the Windows directory, and the chocolatey and Git-for-Windows `bin` directories on Windows. It never searches `PATH` and never executes an arbitrary file named `zip` from the directory being archived. This keeps a malicious `zip` (committed into the source tree, delivered through a relative `PATH` element, or installed into `node_modules/.bin` by a dependency) from running as the build user.

To use `zip` from a different location — a Nix store, `~/bin`, a custom container image, etc. — point bestzip at it explicitly with the `zipPath` option in code or the `BESTZIP_ZIP_PATH` environment variable; both accept either a path to a `zip` executable or a directory to search for one. Note that the command line has **no** `--zip-path` flag, by design: a flag reachable through a build argument could be injected to point bestzip at an arbitrary executable, so CLI users opt in with `BESTZIP_ZIP_PATH` instead (set it in the environment, e.g. `BESTZIP_ZIP_PATH=/nix/store/xyz/bin bestzip out.zip build/*`). If an explicitly configured location yields no usable `zip`, bestzip falls back to the built-in Node.js implementation rather than touching `PATH`.

When no trusted `zip` is usable but a `zip` is reachable through `PATH`, bestzip does not run it (as above) and logs a warning that names the path it declined and shows how to opt back into it deliberately — `zipPath` in code, or `BESTZIP_ZIP_PATH` in the environment (there is no CLI flag, so a build argument can't point bestzip at an arbitrary executable) — and mentions `--quiet` / `quiet: true` for suppressing it where the situation is expected. If that location is a standard system directory bestzip should trust by default, please open an issue or pull request so it can be added to the allowlist.

## Suppressing warnings

bestzip reports its advisory warnings on stderr. They are non-fatal — a failed build throws and exits non-zero — and two of them are expected side effects of secure defaults, so in CI or container builds they can be permanent, harmless noise:

- The refused-`zip` warning above (fired when no trusted `zip` exists but one is reachable through `PATH`).
- The symlink default-behavior warning (fired when symlinks are present and `followSymLinks` is unset).

Where the underlying situation is just expected, pass `--quiet` (or `-q`) on the command line, or set `quiet: true` in code. This suppresses those warnings (and any other advisory scanner/archive warnings) and skips the symlink detection scan; it does **not** change the resulting archive, and errors are still reported. Progress output (`Writing ... to ...`, `zipped!`) is suppressed too. Keep in mind that `--quiet` hides the refusal, not the reason for it — if a `zip` is being skipped unexpectedly, prefer fixing the cause with `zipPath` / `BESTZIP_ZIP_PATH`.

## How to control the directory structure

The directory structure in the .zip is going to match your input files, but the exact details depend on how the command is called. For example:

`bestzip build.zip build/*`

This includes the build/ folder inside of the .zip

Alternatively:

`cd build/ && bestzip ../build.zip *`

This will not include the build/ folder, it's contents will be top-level.

*Note: some tools, including the Archive Utility built into macOS, will automatically create a top-level folder to group everything together when extracting a .zip archive that contains multiple top-level files.*

When using the programmatic API, the same effect may be achieved by passing in the `cwd` option.

## .dotfiles

Wildcards (`*`) ignore dotfiles.

* To include a dotfile, either include the directory it's in (`folder/`) or include it by name (`folder/.dotfile`)
* To omit dotfiles, either use a wildcard (`folder/*`) or explicitly list the desired files (`folder/file1.txt folder/file2.txt`)

## Symbolic links

Starting in v4, bestzip does **not** follow symbolic links by default. Symlinks are stored in the archive as link entries rather than as the contents of their targets. This prevents an archive from accidentally (or maliciously) capturing files from anywhere else on the filesystem that only happen to be reachable through a symlink inside the directory being archived.

When symlinks are present and the `followSymLinks` option has not been set explicitly, bestzip prints a warning to stderr listing the symlinked paths and how to opt in to following them.

To follow symlinks, set `followSymLinks: true` (programmatic API) or pass `--follow-sym-links` on the command line. To keep the link entries (the default behavior) while suppressing the warning, set `followSymLinks: false` or pass `--no-follow-sym-links` on the command line. To leave symlinks handling on its defaults and suppress the warning (along with bestzip's other advisory warnings) without changing behavior, use `--quiet` / `quiet: true` (see [Suppressing warnings](#suppressing-warnings)).

When archiving symlinks without following them, bestzip uses the native `zip` command when available. Some native `zip` builds (notably the Windows build of Info-ZIP) cannot store symlinks as link entries at all, so bestzip falls back to its built-in Node.js implementation in that case. 
Note that calling `nativeZip()` directly with `followSymLinks` unset/false on such a platform throws an error; use the `bestZip()` entry point, which routes to the Node.js implementation automatically. Use `nativeZipSupportsSymlinks()` to check whether the available native `zip` can store symlinks as links; it accepts the same options as the other entry points (e.g. `zipPath`), returns `true`/`false`, and caches its result after the first call. `bestzip.hasNativeZip()` checks whether a native `zip` is installed at all.
