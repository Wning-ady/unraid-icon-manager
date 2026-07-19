import assert from "node:assert/strict";
import test from "node:test";
import { validateIconUrl } from "../src/server/icon-validation.ts";

test("only accepts HTTP(S) URL icon sources", () => {
  assert.equal(validateIconUrl("https://example.com/icon.png"), "https://example.com/icon.png");
  assert.throws(() => validateIconUrl("file:///etc/passwd"));
  assert.throws(() => validateIconUrl("javascript:alert(1)"));
});
