import test from "node:test";
import assert from "node:assert/strict";
import {
  composeQualityInput,
  resolveQualityVariant,
} from "../scripts/evaluate-compression.mjs";
import { COMPRESSION_PROMPT_VERSION } from "../src/semantic-compression/contract.js";
import { CANDIDATE_SYSTEM_INSTRUCTION, COMPRESSION_CANDIDATE_PROMPT_VERSION } from "../src/semantic-compression/prompt-candidate.js";

test("quality evaluation defaults to the production control prompt", () => {
  const variant = resolveQualityVariant(undefined);
  assert.equal(variant.name, "control");
  assert.equal(variant.evaluationPromptVersion, COMPRESSION_PROMPT_VERSION);
  assert.notEqual(variant.systemInstruction, "");
});

test("quality evaluation selects the candidate prompt without changing the public profile version", () => {
  const variant = resolveQualityVariant("candidate");
  assert.equal(variant.name, "candidate");
  assert.equal(variant.evaluationPromptVersion, COMPRESSION_CANDIDATE_PROMPT_VERSION);
  assert.equal(variant.systemInstruction, CANDIDATE_SYSTEM_INSTRUCTION);
  assert.throws(() => resolveQualityVariant("unknown"), /COMPRESSION_QUALITY_PROMPT_VARIANT/);
});

test("quality evaluation composes optional long-corpus suffixes into the input sent to Gemini", () => {
  assert.equal(composeQualityInput({ input: "本文", suffix: "追加" }), "本文追加");
  assert.equal(composeQualityInput({ input: "本文" }), "本文");
});
