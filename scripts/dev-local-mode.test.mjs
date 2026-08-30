import assert from "node:assert/strict";
import { test } from "node:test";
import { localDevelopmentMode } from "./dev-local-mode.mjs";

test("only explicit local modes enable continuation", () => {
  assert.deepEqual(localDevelopmentMode([], {}), { fullFlow: false, fixtures: false, continuation: false });
  assert.deepEqual(localDevelopmentMode(["--full-flow"], {}), { fullFlow: true, fixtures: false, continuation: true });
  assert.deepEqual(localDevelopmentMode([], { VENFOUR_LOCAL_POST_CONTINUE: "1" }), { fullFlow: false, fixtures: true, continuation: true });
  assert.throws(() => localDevelopmentMode(["--full-flow"], { VENFOUR_LOCAL_POST_CONTINUE: "1" }));
  assert.throws(() => localDevelopmentMode(["--unknown"], {}));
});
