"use strict";
//const assert = require("assert");
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");
const rimraf = require("rimraf");
const klaw = require("klaw-sync");

const tmpdir = path.join(__dirname, "tmp");
const zipfile = path.join(tmpdir, "test.zip");
const command = path.join(__dirname, "../bin/cli.js");

const cleanup = () =>
  new Promise((resolve, reject) => {
    rimraf(tmpdir, err => {
      if (err) {
        return reject(err);
      }
      fs.mkdir(tmpdir, err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });

// todo: make a fallback for windows systems
const unzip = zipfile =>
  child_process.execSync(`unzip ${zipfile}`, { cwd: tmpdir });

const getStructure = tmpdir => {
  return klaw(tmpdir).map(({ path }) => path.replace(tmpdir, ""));
};

const testCases = [
  { cwd: "test/fixtures/", args: ["*"] },
  { cwd: "test/", args: ["fixtures/*"] },
  { cwd: "test/", args: ["fixtures/"] },
  { cwd: "test/fixtures", args: ["file.txt"] },
  { cwd: "test/fixtures", args: ["obama.jpg"] },
  { cwd: "test/fixtures", args: ["file.txt", "obama.jpg"] },
  { cwd: "test/fixtures", args: ["file.txt", ".dotfile"] },
  { cwd: "test/fixtures", args: ["file.txt", "subdir"] },
  { cwd: "test/fixtures", args: ["subdir/subfile.txt"] }
];

describe("file structure", () => {
  beforeEach(cleanup);

  describe("bestzip with relative paths", () => {
    testCases.forEach(testCase => {
      it(`${testCase.cwd}> bestzip [tmp]/test.zip ${testCase.args.join(
        " "
      )}`, () => {
        child_process.execSync(
          `node ${command} ${zipfile} ${testCase.args.join(" ")}`,
          { cwd: testCase.cwd }
        );

        unzip(zipfile);
        const structure = getStructure(tmpdir);

        expect(structure).toMatchSnapshot({}, JSON.stringify(testCase));
      });
    });
  });

  // on systems without native zip (windows), this is just a repeat of the above set.
  // but, on systems *with* a native zip, this validates that both methods output the same thing (mac, linux)
  describe("forced nodezip with relative paths", () => {
    testCases.forEach(testCase => {
      it(`${
        testCase.cwd
      }> bestzip --force=node [tmp]/test.zip ${testCase.args.join(
        " "
      )}`, () => {
        child_process.execSync(
          `node ${command} --force=node ${zipfile} ${testCase.args.join(" ")}`,
          { cwd: testCase.cwd }
        );

        unzip(zipfile);
        const structure = getStructure(tmpdir);

        expect(structure).toMatchSnapshot({}, JSON.stringify(testCase));
      });
    });
  });

  // we can't use snapshots here, because the absolute paths will change from one system to another
  // but, when native zip is available, we want to compare it to node zip to ensure that the outputs match
  describe("same output between native and node zip with absolute file paths", () => {
    beforeAll(function(done) {
      const zipProcess = child_process.exec("zip -?");
      zipProcess.on("error", () => {
        // assume there isn't any native zip command
        this.skip();
        done();
      });
      zipProcess.on("close", exitCode => {
        if (exitCode === 0) {
          done();
        } else {
          // ditto
          this.skip();
          done();
        }
      });
    });

    testCases
      .map(testCase => ({
        args: testCase.args.map(arg =>
          path.join(__dirname, "../", testCase.cwd, arg)
        )
      }))
      .forEach(testCase =>
        it(testCase.args.join(" "), async () => {
          child_process.execSync(
            `node ${command} --force=node ${zipfile} ${testCase.args.join(
              " "
            )}`,
            { cwd: testCase.cwd }
          );

          unzip(zipfile);
          const nodeStructure = getStructure(tmpdir);

          await cleanup();

          child_process.execSync(
            `node ${command} --force=native ${zipfile} ${testCase.args.join(
              " "
            )}`,
            { cwd: testCase.cwd, stdio: "inherit" }
          );

          unzip(zipfile);
          const nativeStructure = getStructure(tmpdir);

          expect(nodeStructure).toEqual(nativeStructure);
        })
      );
  });
});
