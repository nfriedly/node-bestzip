import path from "node:path";
import fs from "node:fs/promises";
import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import CliTest from "command-line-test";

import zip from "../lib/bestzip.js";
import unzip from "./unzip.js";

const __dirname = import.meta.dirname;

describe("bestzip", function () {
  describe("when initialized", function () {
    it("should load bestzip", function () {
      assert.notEqual(zip, null);
    });
  });

  describe("When archiving a file", function () {
    let destinationFile,
      file1File,
      extractFolder,
      fixturesFolder,
      destinationFilePath,
      file1Path,
      extractFolderPath;

    beforeEach(async function () {
      destinationFile = "fakeDestination.zip";
      file1File = "file.txt";
      extractFolder = "extract";
      fixturesFolder = "fixtures";

      destinationFilePath = path.join(__dirname, destinationFile);
      file1Path = path.join(__dirname, fixturesFolder, file1File);
      extractFolderPath = path.join(__dirname, extractFolder);

      await fs.mkdir(extractFolderPath, { recursive: true });
    });

    afterEach(async function () {
      await fs.rm(extractFolderPath, { recursive: true, force: true });
      await fs.rm(destinationFilePath, { force: true });
    });

    it("should create archive", async function () {
      await new Promise((resolve, reject) => {
        zip(destinationFilePath, [file1Path], function (zipError) {
          if (zipError) return reject(zipError);
          resolve();
        });
      });

      const stat = await fs.stat(destinationFilePath);
      assert.ok(Object.hasOwn(stat, "birthtime") || stat.birthtime);
    });

    it("should create archive using CLI", async function () {
      const cliTest = new CliTest();
      const bestzip = "node ./bin/cli.js";

      await new Promise((resolve, reject) => {
        cliTest.exec(
          `${bestzip} ${destinationFilePath} ${file1Path}`,
          function (err, res) {
            if (err) return reject(err);
            assert.match(res.stdout, /zipped!/);
            resolve();
          }
        );
      });
    });

    describe("Valid archive", function () {
      let validArchiveFilePath,
        validArchiveExtractFolder,
        validArchiveExtractedFile1Path;

      afterEach(async function () {
        await fs.rm(validArchiveExtractFolder, {
          recursive: true,
          force: true,
        });
        await fs.rm(validArchiveFilePath, { force: true });
      });

      it("should contain valid data after unarchive", async function () {
        validArchiveFilePath = path.join(__dirname, "validArchive.zip");
        validArchiveExtractFolder = path.join(__dirname, "validArchiveExtract");
        validArchiveExtractedFile1Path = path.join(
          __dirname,
          "validArchiveExtract",
          __dirname.replace(/^[A-Z]:/, ""),
          fixturesFolder,
          file1File
        );

        await new Promise((resolve, reject) => {
          zip(validArchiveFilePath, [file1Path], function (zipError) {
            if (zipError) return reject(zipError);
            resolve();
          });
        });

        await unzip(validArchiveFilePath, validArchiveExtractFolder);

        const data = await fs.readFile(validArchiveExtractedFile1Path);
        const content = data.toString().trim();
        assert.strictEqual(content, "this is a plain text file");
      });
    });
  });

  describe("When archiving a folder", function () {
    let destinationFile,
      file1File,
      extractFolder,
      fixturesFolder,
      destinationFilePath,
      file1Path,
      extractFolderPath;

    beforeEach(async function () {
      destinationFile = "fakeDestination.zip";
      file1File = "file.txt";
      extractFolder = "extract";
      fixturesFolder = "fixtures";

      destinationFilePath = path.join(__dirname, destinationFile);
      file1Path = path.join(__dirname, fixturesFolder);
      extractFolderPath = path.join(__dirname, extractFolder);

      await fs.mkdir(extractFolderPath, { recursive: true });
    });

    afterEach(async function () {
      await fs.rm(extractFolderPath, { recursive: true, force: true });
      await fs.rm(destinationFilePath, { force: true });
    });

    it("should create archive", async function () {
      await new Promise((resolve, reject) => {
        zip(destinationFilePath, [file1Path], function (zipError) {
          if (zipError) return reject(zipError);
          resolve();
        });
      });

      const stat = await fs.stat(destinationFilePath);
      assert.ok(Object.hasOwn(stat, "birthtime") || stat.birthtime);
    });

    it("should create archive using CLI", async function () {
      const cliTest = new CliTest();
      const bestzip = "node ./bin/cli.js";

      await new Promise((resolve, reject) => {
        cliTest.exec(
          `${bestzip} ${destinationFilePath} ${file1Path}`,
          function (err, res) {
            if (err) return reject(err);
            assert.match(res.stdout, /zipped!/);
            resolve();
          }
        );
      });
    });

    describe("Valid archive", function () {
      let validArchiveFilePath,
        validArchiveExtractFolder,
        validArchiveExtractedFile1Path;

      beforeEach(async function () {
        validArchiveFilePath = path.join(__dirname, "validArchive.zip");
        validArchiveExtractFolder = path.join(__dirname, "validArchiveExtract");
        validArchiveExtractedFile1Path = path.join(
          __dirname,
          "validArchiveExtract",
          __dirname.replace(/^[A-Z]:/, ""),
          fixturesFolder,
          file1File
        );

        await new Promise((resolve, reject) => {
          zip(validArchiveFilePath, [file1Path], function (zipError) {
            if (zipError) return reject(zipError);
            resolve();
          });
        });

        await unzip(validArchiveFilePath, validArchiveExtractFolder);
      });

      afterEach(async function () {
        await fs.rm(validArchiveExtractFolder, {
          recursive: true,
          force: true,
        });
        await fs.rm(validArchiveFilePath, { force: true });
      });

      it("should contain valid data after unarchive", async function () {
        const data = await fs.readFile(validArchiveExtractedFile1Path);
        const content = data.toString().trim();
        assert.strictEqual(content, "this is a plain text file");
      });
    });
  });
});
