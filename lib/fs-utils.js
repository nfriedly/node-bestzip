import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { glob, hasMagic } from "glob";

export function isExecutableFile(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
}

export function findInDir(dir, names) {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function expandSources(cwd, source) {
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

export async function walkTree(fullPath, followSymLinks) {
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

export async function safeStat(path) {
  try {
    return await fsp.stat(path);
  } catch (err) {
    return null;
  }
}
