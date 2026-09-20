#!/usr/bin/env node

import * as bestzip from "../lib/bestzip.js";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// Rewrite -0 … -9 into --level 0 … --level 9 before yargs parses them
const preprocessed = hideBin(process.argv).flatMap((arg) => {
  const match = /^-([0-9])$/.exec(arg);
  return match ? ["--level", match[1]] : [arg];
});

const argv = yargs(preprocessed)
  .usage("\nUsage: bestzip destination.zip sources/")
  .option("force", {
    describe: "Force use of node.js or native zip methods",
    choices: ["node", "native"],
  })
  .option("level", {
    describe: "Level of compression",
    type: "number",
  })
  .option("follow-sym-links", {
    describe:
      "Follow symbolic links and include their target contents in the archive",
    type: "boolean",
  })
  .demand(2).argv;

const destination = argv._.shift();
const source = argv._;

console.log("Writing %s to %s...", source.join(", "), destination);

let zip;

if (argv.force === "node") {
  zip = bestzip.nodeZip;
} else if (argv.force === "native") {
  zip = bestzip.nativeZip;
} else {
  zip = bestzip.zip;
}

zip({
  source,
  destination,
  verbose: !!argv.verbose,
  level: argv.level,
  followSymLinks: argv.followSymLinks,
  viaCli: true,
})
  .then(function () {
    console.log("zipped!");
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });
