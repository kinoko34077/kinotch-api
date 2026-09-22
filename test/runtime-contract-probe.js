export function createSemanticProbeRequest({ operationId, input, requestId }) {
  return {
    action_id: operationId,
    input,
    request_id: requestId,
  };
}

export function toSemanticProbeError({ code, message, details }) {
  return { code, message, details };
}
