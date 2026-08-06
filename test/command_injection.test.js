import { describe, test, beforeEach, after } from "node:test";
import fs from "node:fs";
import * as bestzip from "../lib/bestzip.js";
import { init } from "./helpers.js";

const { destination, cleanup } = init("command_injection");

describe("command injection", () => {
  const hasNativeZip = bestzip.hasNativeZip();

  beforeEach(cleanup);
  after(cleanup);

  // https://www.npmjs.com/advisories/1554
  const testCases = [
    {
      cwd: "test/fixtures",
      source: "file.txt",
      destination: destination + "; mkdir -p injection",
    },
    {
      cwd: "test/fixtures",
      source: "file.txt; mkdir -p injection",
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      source: ["file.txt;", " mkdir -p injection"],
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      source: ["file.txt", "; mkdir -p injection"],
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      source: ["file.txt;", ";mkdir -p injection"],
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      source: ["file.txt", "mkdir -p injection"],
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      source: ["file.txt; mkdir -p injection"],
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      source: ["file.txt", "obama.jpg; mkdir -p injection"],
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      // --test validates the created .zip, and --unzip-command provides the command for zip to execute when unzipping for validation
      source: ["file.txt", "--test", "--unzip-command", "mkdir -p injection"],
      destination: destination,
    },
    {
      cwd: "test/fixtures",
      // -T and -TT are aliases for --test and --unzip-command
      source: ["file.txt", "-T", "-TT", "mkdir -p injection"],
      destination: destination,
    },
  ];

  for (const testCase of testCases) {
    test(
      `should NOT execute commands from the list of sources: ${JSON.stringify(
        testCase
      )}`,
      { skip: !hasNativeZip },
      async () => {
        try {
          await bestzip.zip(testCase);
        } catch (ex) {
          // Exceptions are allowed, that is invalid input.
          // The important part is that it doesn't execute it.
          // Some test cases will log "zip error: Nothing to do!" or similar - that is to be expected
        }

        if (fs.existsSync("test/fixtures/injection")) {
          throw new Error(
            "Bestzip appears to be vulnerable to command injection"
          );
        }
      }
    );
  }
});
