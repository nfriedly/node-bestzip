"use strict";

const bestzip = require("../lib/bestzip");
const fs = require("fs");
const { init } = require("./helpers");

const { destination, cleanup } = init("command_injection");

describe("command injection", () => {
  const hasNativeZip = bestzip.hasNativeZip();
  const testIfHasNativeZip = hasNativeZip ? test : test.skip;

  beforeEach(cleanup);
  afterAll(cleanup);

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
  ];
  testIfHasNativeZip.each(testCases)(
    "should NOT execute commands from the list of sources: %s",
    async (testCase) => {
      try {
        await bestzip(testCase);
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
});
