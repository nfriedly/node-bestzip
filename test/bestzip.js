"use strict";

var chai = require("chai");
var expect = chai.expect;
var path = require("path");
var fs = require("fs");
var rimraf = require("rimraf");
var unzip = require("unzip-stream");
var CliTest = require("command-line-test");

var zip = require("../lib/bestzip.js");

describe("bestzip", function() {
  describe("when initialized", function() {
    it("should load bestzip", function() {
      expect(zip).to.be.not.null;
    });
  });

  describe("When archiving a file", function() {
    var destinationFile,
      file1File,
      extractFolder,
      fixturesFolder,
      destinationFilePath,
      file1Path,
      extractFolderPath;

    beforeEach(function(done) {
      destinationFile = "fakeDestination.zip";
      file1File = "file1.js";
      extractFolder = "extract";
      fixturesFolder = "fixtures";

      destinationFilePath = path.join(__dirname, destinationFile);
      file1Path = path.join(__dirname, fixturesFolder, file1File);
      extractFolderPath = path.join(__dirname, extractFolder);

      fs.mkdir(extractFolderPath, done);
    });

    afterEach(function(done) {
      rimraf(extractFolderPath, function() {
        rimraf(destinationFilePath, done);
      });
    });

    it("should create archive", function(done) {
      zip(destinationFilePath, [file1Path], function(zipError) {
        expect(zipError).to.not.exist;

        fs.stat(destinationFilePath, function(_error, stat) {
          expect(stat).to.haveOwnProperty("birthtime");
          done();
        });
      });
    });

    it("should create archive using CLI", function(done) {
      var cliTest = new CliTest();
      var bestzip = "node ./bin/cli.js";

      // $ bestzip fakeDestination.zip fixtures/file1.js
      cliTest.exec(`${bestzip} ${destinationFilePath} ${file1Path}`, function(
        err,
        res
      ) {
        expect(res.stdout).to.contain("zipped!");
        done();
      });
    });

    describe("Valid archive", function() {
      var validArchiveFilePath,
        validArchiveExtractFolder,
        validArchiveExtractedFile1Path;

      beforeEach(function(done) {
        validArchiveFilePath = path.join(__dirname, "validArchive.zip");
        validArchiveExtractFolder = path.join(__dirname, "validArchiveExtract");
        validArchiveExtractedFile1Path = path.join(
          __dirname,
          "validArchiveExtract",
          file1File
        );

        zip(validArchiveFilePath, [file1Path], function(zipError) {
          expect(zipError).to.not.exist;

          var unzipExtractor = unzip.Extract({
            path: validArchiveExtractFolder
          });

          unzipExtractor.on("error", done).on("close", done);

          fs.createReadStream(validArchiveFilePath).pipe(unzipExtractor);
        });
      });

      afterEach(function(done) {
        rimraf(validArchiveExtractFolder, function() {
          rimraf(validArchiveFilePath, done);
        });
      });

      it("should contain valid data after unarchive", function(done) {
        fs.readFile(validArchiveExtractedFile1Path, function(readError, data) {
          expect(readError).to.not.exist;

          var content = data.toString();
          expect(content).to.be.equal("1;\n");

          done();
        });
      });
    });
  });

  describe("When archiving a folder", function() {
    var destinationFile,
      file1File,
      extractFolder,
      fixturesFolder,
      destinationFilePath,
      file1Path,
      extractFolderPath;

    beforeEach(function(done) {
      destinationFile = "fakeDestination.zip";
      file1File = "file1.js";
      extractFolder = "extract";
      fixturesFolder = "fixtures";

      destinationFilePath = path.join(__dirname, destinationFile);
      file1Path = path.join(__dirname, fixturesFolder);
      extractFolderPath = path.join(__dirname, extractFolder);

      fs.mkdir(extractFolderPath, done);
    });

    afterEach(function(done) {
      rimraf(extractFolderPath, function() {
        rimraf(destinationFilePath, done);
      });
    });

    it("should create archive", function(done) {
      zip(destinationFilePath, [file1Path], function(zipError) {
        expect(zipError).to.not.exist;

        fs.stat(destinationFilePath, function(_error, stat) {
          expect(stat).to.haveOwnProperty("birthtime");
          done();
        });
      });
    });

    it("should create archive using CLI", function(done) {
      var cliTest = new CliTest();
      var bestzip = "node ./bin/cli.js";

      // $ bestzip fakeDestination.zip fixtures/file1.js
      cliTest.exec(`${bestzip} ${destinationFilePath} ${file1Path}`, function(
        err,
        res
      ) {
        expect(res.stdout).to.contain("zipped!");
        done();
      });
    });

    describe("Valid archive", function() {
      var validArchiveFilePath,
        validArchiveExtractFolder,
        validArchiveExtractedFile1Path;

      beforeEach(function(done) {
        validArchiveFilePath = path.join(__dirname, "validArchive.zip");
        validArchiveExtractFolder = path.join(__dirname, "validArchiveExtract");
        validArchiveExtractedFile1Path = path.join(
          __dirname,
          "validArchiveExtract",
          __dirname.replace(/^[A-Z]:/, ""), // yes, it has the path twice. Regex to strip the leading C: or whatever on windows
          fixturesFolder,
          file1File
        );

        zip(validArchiveFilePath, [file1Path], function(zipError) {
          expect(zipError).to.not.exist;

          var unzipExtractor = unzip.Extract({
            path: validArchiveExtractFolder
          });

          unzipExtractor.on("error", done).on("close", done);

          fs.createReadStream(validArchiveFilePath).pipe(unzipExtractor);
        });
      });

      afterEach(function(done) {
        rimraf(validArchiveExtractFolder, function() {
          rimraf(validArchiveFilePath, done);
        });
      });

      it("should contain valid data after unarchive", function(done) {
        fs.readFile(validArchiveExtractedFile1Path, function(readError, data) {
          expect(readError).to.not.exist;

          var content = data.toString();
          expect(content).to.be.equal("1;\n");

          done();
        });
      });
    });
  });
});
