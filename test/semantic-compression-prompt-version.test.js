import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPRESSION_PROMPT_VERSION_COMPACT,
  COMPRESSION_PROMPT_VERSION_SEMANTIC_DENSE,
  getCompressionPromptVersion,
} from "../src/semantic-compression/contract.js";
import { resolveCompressionProfile } from "../src/semantic-compression/prompt.js";

test("production prompt versions distinguish profile provenance", () => {
  assert.equal(COMPRESSION_PROMPT_VERSION_COMPACT, "compact-v1.1");
  assert.equal(COMPRESSION_PROMPT_VERSION_SEMANTIC_DENSE, "semantic-dense-v1.1");
  assert.equal(getCompressionPromptVersion("compact-v1"), "compact-v1.1");
  assert.equal(getCompressionPromptVersion("semantic-dense-v1"), "semantic-dense-v1.1");
  assert.equal(resolveCompressionProfile("compact-v1").promptVersion, "compact-v1.1");
  assert.equal(resolveCompressionProfile("semantic-dense-v1").promptVersion, "semantic-dense-v1.1");
});
