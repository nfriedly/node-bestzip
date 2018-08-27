// creates a zip file using either the native `zip` command if avaliable,
// or a node.js zip implimentation otherwise.
//
// currently only supports zipping a single sources file/dir

"use strict";

var cp = require("child_process");
var fs = require("fs");

var archiver = require("archiver");
var async = require("async");
var glob = require("glob");

var _hasNativeZip = null;

function hasNativeZip() {
  if (_hasNativeZip === null) {
    try {
      cp.execSync("zip -?");
      _hasNativeZip = true;
    } catch (err) {
      _hasNativeZip = false;
    }
  }

  return _hasNativeZip;
}

function nativeZip(dest, source, done) {
  var args = ["--quiet", "--recurse-paths", dest].concat(source);
  const zipProcess = cp.spawn("zip", args, { stdio: "inherit" });
  zipProcess.on("error", done);
  zipProcess.on("close", exitCode => {
    if (exitCode === 0) {
      done();
    } else {
      done(
        new Error("Unexpected exit code from native zip command: " + exitCode)
      );
    }
  });
}

const GLOB_OPTIONS = {
  // options to behave more like the native zip's glob support
  dot: false, // ignore .dotfiles
  noglobstar: true, // treat ** as *
  noext: true, // no (a|b)
  nobrace: true // no {a,b}
};

// based on http://stackoverflow.com/questions/15641243/need-to-zip-an-entire-directory-using-node-js/18775083#18775083
function nodeZip(dest, sources, done) {
  var output = fs.createWriteStream(dest);
  var archive = archiver("zip");

  output.on("close", done);
  archive.on("error", done);

  archive.pipe(output);

  function findSource(source, next) {
    if (glob.hasMagic(source, GLOB_OPTIONS)) {
      // archiver uses this library but somehow ends up with different results on windows:
      // archiver.glob('*') will include subdirectories, but omit their contents on windows
      // so we'll use glob directly, and add all of the files it finds
      glob(source, GLOB_OPTIONS, function(err, files) {
        if (err) {
          return next(err);
        }
        async.forEach(files, addSource, next);
      });
    } else {
      addSource(source, next);
    }
  }

  function addSource(source, next) {
    fs.stat(source, function(err, stats) {
      if (err) {
        return next(err);
      }
      if (stats.isDirectory()) {
        archive.directory(source, { stats: stats });
      } else if (stats.isFile()) {
        archive.file(source, { stats: stats });
      }
      next();
    });
  }

  async.forEach(sources, findSource, function(err) {
    if (err) {
      return done(err);
    }
    archive.finalize();
  });
}

function zip(dest, sources, done) {
  if (!Array.isArray(sources)) {
    sources = [sources];
  }
  if (hasNativeZip()) {
    nativeZip(dest, sources, done);
  } else {
    nodeZip(dest, sources, done);
  }
}

module.exports = zip;
module.exports.zip = zip;
module.exports.nodeZip = nodeZip;
module.exports.nativeZip = nativeZip;
module.exports.bestzip = zip;
module.exports.hasNativeZip = hasNativeZip;
