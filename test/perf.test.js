"use strict";
const path = require("path");
const { init, stat } = require("./helpers");

const { destination, cleanup } = init("perf");

const bestzip = require("../lib/bestzip");

describe("Performance", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  const getPerf = async zipFn => {
    const start = Date.now();
    await zipFn(
      // this will zip the entire project, node_modules and all
      { cwd: path.join(__dirname, "../"), source: "*", destination }
    );
    const duration = Date.now() - start;

    const size = (await stat(destination)).size; /* bytes */
    return { duration, size };
  };

  test(
    "zip complete project (including node_modules)",
    async () => {
      const hasNativeZip = bestzip.hasNativeZip();
      const nodeStats = await getPerf(bestzip.nodeZip);
      console.log(
        `nodeZip took ${nodeStats.duration}ms to generate a file of ${nodeStats.size} bytes`
      );

      let nativeStats = null;
      if (hasNativeZip) {
        nativeStats = await getPerf(bestzip.nativeZip);
        const durDif = nativeStats.duration - nodeStats.duration;
        const durPctDif = Math.round((durDif / nodeStats.duration) * 100);
        const sizeDif = nativeStats.size - nodeStats.size;
        const sizePctDif = Math.round((sizeDif / nodeStats.size) * 100);
        console.log(
          `nativeZip took ${nativeStats.duration}ms (${durPctDif}%) to generate a file of ${nativeStats.size} bytes (${sizePctDif}%)`
        );
      }
    },
    2 * 60 * 1000
  ); // third argument is timeout in ms
});
