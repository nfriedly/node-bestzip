import path from "node:path";
import fs from "node:fs/promises";
import { describe, test, beforeEach, after } from "node:test";
import { init } from "./helpers.js";
import * as bestzip from "../lib/bestzip.js";

const { destination, cleanup } = init("perf");

describe("Performance", () => {
  beforeEach(cleanup);
  after(cleanup);

  const getPerf = async (zipFn) => {
    const start = Date.now();
    await zipFn({
      cwd: path.join(import.meta.dirname, "../"),
      source: "*",
      destination,
    });
    const duration = Date.now() - start;

    const size = (await fs.stat(destination)).size; /* bytes */
    return { duration, size };
  };

  test(
    "zip complete project (including node_modules)",
    { timeout: 2 * 60 * 1000 },
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
    }
  );
});
