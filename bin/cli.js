#!/usr/bin/env node

"use strict";

var zip = require("../lib/bestzip.js");

var argv = require("yargs")
  .usage("\nUsage: bestzip destination.zip sources/")
  .option("force", {
    describe: "Force use of node.js or native zip methods",
    choices: ["node", "native"]
  })
  .demand(2).argv;

var dest = argv._.shift();
var sources = argv._;

console.log("Writing %s to %s...", sources.join(", "), dest);

if (argv.force === "node") {
  zip = zip.nodeZip;
} else if (argv.force === "native") {
  zip = zip.nativeZip;
}

zip(dest, sources, function(err) {
  if (err) {
    console.error(err);
    return process.exit(1);
  }
  console.log("zipped!");
});
