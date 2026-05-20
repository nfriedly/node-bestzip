import fs from "node:fs";
import unzip from "unzip-stream";

export default (zipFile, outputFolder) =>
  new Promise((resolve, reject) => {
    var unzipExtractor = unzip.Extract({
      path: outputFolder,
    });

    unzipExtractor.on("error", reject).on("close", resolve);

    fs.createReadStream(zipFile).pipe(unzipExtractor);
  });

// todo: compare this to child_process.execSync(`unzip ${zipfile}`, { cwd: tmpdir }); sometime
