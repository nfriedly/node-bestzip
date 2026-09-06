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

    npm install -g bestzip
    bestzip --no-follow-sym-links destination.zip source/ [other sources...]

## Command line usage within `package.json` scripts

    npm install --save-dev bestzip

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


## Programmatic usage from within Node.js

```javascript
import { zip } from 'bestzip';
// const { zip } = require('bestzip'); // for CJS (requires node.js v22 or newer

// zip a single source
await zip({
  source: 'build/*',
  destination: './destination.zip',
  followSymLinks: false,
})

// zip multiple sources, starting in a different CWD (current working directory)
await zip({
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

## Symbolic links

By default, bestzip does **not** follow symbolic links. Symlinks are stored in the archive as link entries rather than as the contents of their targets. This prevents an archive from accidentally (or maliciously) capturing files from anywhere else on the filesystem that only happen to be reachable through a symlink inside the directory being archived.

When symlinks are present and the `followSymLinks` option has not been set explicitly, bestzip prints a warning to stderr listing the symlinked paths and how to opt in to following them.

To follow symlinks, set `followSymLinks: true` (programmatic API) or pass `--follow-sym-links` on the command line. To keep the link entries (the default behavior) while suppressing the warning, set `followSymLinks: false` or pass `--no-follow-sym-links` on the command line.

When archiving symlinks without following them, bestzip uses the native `zip` command when available. Some native `zip` builds (notably the Windows build of Info-ZIP) cannot store symlinks as link entries at all, so bestzip falls back to its built-in Node.js implementation in that case to preserve the secure default. Note that calling `bestzip.nativeZip` directly with `followSymLinks` unset/false on such a platform throws an error; use the `bestzip()` entry point, which routes to the Node.js implementation automatically. Use `bestzip.nativeZipSupportsSymlinks()` to check whether the available native `zip` can store symlinks as links; it returns `true`/`false` and caches its result after the first call. `bestzip.hasNativeZip()` checks whether a native `zip` is installed at all.

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

