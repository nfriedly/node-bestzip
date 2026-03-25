// creates a zip file using either the native `zip` command if available,
// or a node.js zip implementation otherwise.

"use strict";

const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const archiver = require("archiver");
const { glob, hasMagic } = require("glob");
const which = require("which");

function hasNativeZip() {
  return Boolean(which.sync("zip", { nothrow: true }));
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

const nativeZip = async (options) => {
  const cwd = options.cwd || process.cwd();
  const command = "zip";
  const sources = await expandSources(cwd, options.source);

  const args = ["--quiet", "--recurse-paths", options.destination].concat(
    sources
  );
  if (
    typeof options.level == "number" &&
    !isNaN(options.level) &&
    options.level >= 0 &&
    options.level <= 9
  ) {
    args.splice(0, 0, "-" + options.level.toString());
  }

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
  const output = fs.createWriteStream(path.resolve(cwd, options.destination));
  const archive = archiver("zip", {
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

  async function addSource(source) {
    const fullPath = path.resolve(cwd, source);
    const destPath = source;

    const stats = await fs.promises.stat(fullPath);
    if (stats.isDirectory()) {
      // Walk directory. Works on directories and directory symlinks.
      const files = walkDir(fullPath);
      files.forEach((f) => {
        const subPath = f.substring(fullPath.length);
        archive.file(f, {
          name: destPath + subPath,
        });
      });
    } else if (stats.isFile()) {
      archive.file(fullPath, { stats: stats, name: destPath });
    }
  }

  try {
    const expandedSources = await expandSources(cwd, options.source);
    for (const source of expandedSources) {
      await addSource(source);
    }
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

  let promise;
  if (hasNativeZip()) {
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

module.exports = zip;
module.exports.zip = zip;
module.exports.nodeZip = nodeZip;
module.exports.nativeZip = nativeZip;
module.exports.bestzip = zip;
module.exports.hasNativeZip = hasNativeZip;
