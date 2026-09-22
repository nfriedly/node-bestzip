import path from "node:path";

import { walkTree } from "./fs-utils.js";

// Validates the compression level. A level of exactly 0-9 (an integer) is
// accepted; anything else that is set causes an error. An unset level is
// allowed and left to each implementation's default.
export function validateLevel(level) {
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

export async function detectSymlinks(cwd, sources) {
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

export function maybeWarnAboutSymlinks(options, symlinks, cwd) {
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
