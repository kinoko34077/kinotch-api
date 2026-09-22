import test from "node:test";
import assert from "node:assert/strict";
import { routePolicies } from "../src/policies/routes.js";
import { validateBatchBody } from "../src/middleware/validation.js";
import {
  createSemanticProbeRequest,
  toSemanticProbeError,
} from "./runtime-contract-probe.js";

test("existing route Policy ID maps to a plain ActionRequest observation", () => {
  const input = { texts: ["入力"], profile: ["standard"] };
  const request = createSemanticProbeRequest({
    operationId: routePolicies.transformBatch.id,
    input,
    requestId: "probe-request-1",
  });

  assert.deepEqual(request, {
    action_id: "transform-batch",
    input,
    request_id: "probe-request-1",
  });
  assert.equal(request.input, input);
});

test("existing API validation error preserves lower-snake code and fields", () => {
  const apiError = validateBatchBody({ texts: [] });
  const portable = toSemanticProbeError(apiError);

  assert.deepEqual(portable, {
    code: "invalid_texts",
    message: "texts must be a non-empty array with at most 256 items",
    details: undefined,
  });
  assert.equal(portable.code, apiError.code);
  assert.equal(apiError.status, 400);
});
