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
* `--zip-path <path>`: Path to a `zip` executable (or a directory to search for one) to use for the native fast path, overriding the default trusted system locations. Can also be set with the `BESTZIP_ZIP_PATH` environment variable. Relative paths are resolved against the current working directory.


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

## Which `zip` does bestzip run?

For the native fast path, bestzip only ever runs a `zip` binary it resolved itself from an explicit allowlist of trusted system locations — `/usr/bin`, `/bin`, `/usr/local/bin`, `/opt/homebrew/bin` and `/opt/local/bin` on macOS/Linux; the `System32` directory, the Windows directory, and the chocolatey and Git-for-Windows `bin` directories on Windows. It never searches `PATH` and never executes an arbitrary file named `zip` from the directory being archived. This keeps a malicious `zip` (committed into the source tree, delivered through a relative `PATH` element, or installed into `node_modules/.bin` by a dependency) from running as the build user.

To use `zip` from a different location — a Nix store, `~/bin`, a custom container image, etc. — point bestzip at it explicitly with `zipPath` or the `BESTZIP_ZIP_PATH` environment variable; both accept either a path to a `zip` executable or a directory to search for one. If an explicitly configured location yields no usable `zip`, bestzip falls back to the built-in Node.js implementation rather than touching `PATH`.

When no trusted `zip` is usable but a `zip` is reachable through `PATH`, bestzip does not run it (as above) and logs a warning that names the path it declined and shows the `zipPath` / `--zip-path` / `BESTZIP_ZIP_PATH` options for opting back into it. If that location is a standard system directory bestzip should trust by default, please open an issue or pull request so it can be added to the allowlist.

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

To follow symlinks, set `followSymLinks: true` (programmatic API) or pass `--follow-sym-links` on the command line. To keep the link entries (the default behavior) while suppressing the warning, set `followSymLinks: false` or pass `--no-follow-sym-links` on the command line.

When archiving symlinks without following them, bestzip uses the native `zip` command when available. Some native `zip` builds (notably the Windows build of Info-ZIP) cannot store symlinks as link entries at all, so bestzip falls back to its built-in Node.js implementation in that case. 
Note that calling `nativeZip()` directly with `followSymLinks` unset/false on such a platform throws an error; use the `bestZip()` entry point, which routes to the Node.js implementation automatically. Use `nativeZipSupportsSymlinks()` to check whether the available native `zip` can store symlinks as links; it returns `true`/`false` and caches its result after the first call. `bestzip.hasNativeZip()` checks whether a native `zip` is installed at all.