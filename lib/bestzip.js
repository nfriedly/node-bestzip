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
