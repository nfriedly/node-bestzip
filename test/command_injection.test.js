import { describe, test, beforeEach, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import * as bestzip from "../lib/bestzip.js";
import { init } from "./helpers.js";

describe("command injection", () => {
  const hasNativeZip = bestzip.hasNativeZip();

  const { destination, fixturesDir: cwd, reset, cleanup } = init(
    "command_injection",
    true // copy the fixtures to the tempdir; fixturesDir will point to the copy
  );

  beforeEach(reset);
  after(cleanup);

  const testCases = [
    // note: cwd and destination will get included automatically unless overridden in the test case
    {
      source: "file.txt",
      destination: destination + "; mkdir -p injection",
    },
    { source: "file.txt; mkdir -p injection" },
    { source: ["file.txt;", " mkdir -p injection"] },
    { source: ["file.txt", "; mkdir -p injection"] },
    { source: ["file.txt;", ";mkdir -p injection"] },
    { source: ["file.txt", "mkdir -p injection"] },
    { source: ["file.txt; mkdir -p injection"] },
    { source: ["file.txt", "obama.jpg; mkdir -p injection"] },
    {
      // --test validates the created .zip, and --unzip-command provides the command for zip to execute when unzipping for validation
      source: ["file.txt", "--test", "--unzip-command", "mkdir -p injection"],
    },
    {
      // -T and -TT are aliases for --test and --unzip-command
      source: ["file.txt", "-T", "-TT", "mkdir -p injection"],
    },
    {
      source: [
        "fakedest.zip",
        "file.txt",
        "--test",
        "--unzip-command",
        "mkdir -p injection",
      ],
      // if destination is interpreted as a flag that takes an argument, it will eat the -- that prevents sources from being interpreted as arguments
      destination: "-n",
    },
    // variations of the above targeted at windows. I haven't actually seen these fail, but I figure the tests won't hurt
    {
      source: [
        "fakedest.zip",
        "file.txt",
        "--test",
        "--unzip-command",
        "mkdir -p injection",
      ],
      destination: "\\x",
    },
    {
      source: [
        "fakedest.zip",
        "file.txt",
        "--test",
        "--unzip-command",
        "mkdir -p injection",
      ],
      destination: "/x",
    },
  ];

  for (const testCase of testCases) {
    test(
      `should NOT execute commands from the list of sources: ${JSON.stringify(
        testCase
      )}`,
      { skip: !hasNativeZip },
      async () => {
        const args = { cwd, destination, ...testCase };
        try {
          await bestzip.zip(args);
        } catch (ex) {
          // Exceptions are allowed, we gave it invalid input.
          // The important part is that it doesn't execute it.
          // Some test cases will log "zip error: Nothing to do!" or similar - that is to be expected
        }

        if (fs.existsSync(path.join(args.cwd, "injection"))) {
          throw new Error(
            "Bestzip appears to be vulnerable to command injection"
          );
        }
      }
    );
  }
});
