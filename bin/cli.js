#!/usr/bin/env node

"use strict";

var zip = require("../lib/bestzip.js");

var argv = require("yargs")
  .usage("\nUsage: bestzip destination.zip sources/")
  .option("force", {
    describe: "Force use of node.js or native zip methods",
    choices: ["node", "native"]
  })
  .option("dependencies", {
    alias: "d",
    describe: "Includes dependencies from a package.json file"
  })
  .demand(2).argv;

const destination = argv._.shift();
const source = argv._;
const packageFile = argv.d === true ? "package.json" : argv.d;

console.log("Writing %s to %s...", source.join(", "), destination);

if (argv.force === "node") {
  zip = zip.nodeZip;
} else if (argv.force === "native") {
  zip = zip.nativeZip;
}

zip({
  source: source,
  destination: destination,
  verbose: argv.verbose,
  packageFile: packageFile
})
  .then(function() {
    console.log("zipped!");
  })
  .catch(function(err) {
    console.error(err);
    process.exit(1);
  });
