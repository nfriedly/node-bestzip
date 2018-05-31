#!/usr/bin/env node

"use strict";

var zip = require("../lib/bestzip.js");

var argv = require("yargs")
  .usage("\nUsage: bestzip destination.zip sources/")
  .demand(2).argv._;

var dest = argv.shift();
var sources = argv;

console.log("Writing %s to %s...", sources.join(", "), dest);

zip(dest, sources, function(err) {
  if (err) {
    console.error(err);
    return process.exit(1);
  }
  console.log("zipped!");
});
