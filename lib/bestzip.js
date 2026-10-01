// creates a zip file using either the native `zip` command if available,
// or a node.js zip implementation otherwise.

import {
  nativeZip,
  hasNativeZip,
  nativeZipSupportsSymlinks,
} from "./nativezip.js";
import { nodeZip } from "./nodezip.js";

function zip(options) {
  const compatMode = typeof options === "string";
  if (compatMode) {
    options = {
      source: arguments[1],
      destination: arguments[0],
    };
  }

  // `force` pins the implementation. An unset value leaves the choice to the
  // checks below, and anything other than 'node' or 'native' is a mistake
  // worth reporting rather than silently ignoring.
  const force = options.force;
  if (force !== undefined && force !== "node" && force !== "native") {
    const typehint = typeof force === "string" ? "" : ` (${typeof force})`;
    throw new Error(
      `bestzip: force should be 'node' or 'native', got ${force}${typehint}`
    );
  }

  // By default symlinks are stored as links, not followed. The native zip
  // command can always follow symlinks (followSymLinks: true), but can only
  // store them as links when it supports --symlinks. When storing links is
  // requested but the native zip can't do it, fall back to the node
  // implementation, which can store links regardless.
  const useNative =
    force !== undefined
      ? force === "native"
      : hasNativeZip() &&
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

// Pin the implementation with the force option, passing every other option
// through to zip(). Exported as nodeZip and nativeZip.
const forceNodeZip = (options) => zip({ ...options, force: "node" });
const forceNativeZip = (options) => zip({ ...options, force: "native" });

export default zip;

export {
  zip,
  zip as bestZip,
  forceNodeZip as nodeZip,
  forceNativeZip as nativeZip,
  hasNativeZip,
  nativeZipSupportsSymlinks,
};
