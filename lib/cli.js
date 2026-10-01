import process from "node:process";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { bestZip } from "../lib/bestzip.js";

export function main() {
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

  bestZip({
    source,
    destination,
    level: argv.level,
    followSymLinks: argv.followSymLinks,
    force: argv.force,
    viaCli: true,
  })
    .then(function () {
      console.log("zipped!");
    })
    .catch(function (err) {
      console.error(err);
      process.exit(1);
    });
}
