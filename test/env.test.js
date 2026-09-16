import { env } from "node:process";
import { test } from "node:test";
import assert from "node:assert";
import { hasNativeZip } from "../lib/bestzip.js";

// This is just to validate that nodezip can actually see the zip command in the test-native-zip-windows CI environment
// Otherwise it will show as passing while actually skipping all of the important tests
test(
  "Must have native zip command if REQUIRE_NATIVE_ZIP env prop is set",
  { skip: !env.REQUIRE_NATIVE_ZIP },
  () => {
    assert(hasNativeZip());
  }
);
