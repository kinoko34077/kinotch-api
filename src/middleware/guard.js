import { enforceBodyLimit } from "./body-limit.js";
import { enforceRateLimit } from "./rate-limit.js";
import { validateRequest } from "./validation.js";

function methodError(c, method) {
  c.header("Allow", method);
  const requestId = c.get("requestId");
  return c.json({
    error: "method_not_allowed",
    message: `Only ${method} requests are supported`,
    ...(requestId ? { requestId } : {}),
  }, 405);
}

export function policyMiddleware(policy) {
  return async (c, next) => {
    if (c.req.method !== policy.method) return methodError(c, policy.method);

    if (typeof policy.authenticate === "function") {
      const authenticationError = await policy.authenticate(c);
      if (authenticationError) return authenticationError;
    }

    const rateLimitError = await enforceRateLimit(c, policy);
    if (rateLimitError) return rateLimitError;

    const bodyLimitError = await enforceBodyLimit(c, policy);
    if (bodyLimitError) return bodyLimitError;

    const validationError = await validateRequest(c, policy);
    if (validationError) return validationError;

    await next();
  };
}

export function registerRoute(router, method, path, policy, handler) {
  const normalizedMethod = method.toLowerCase();
  if (!policy || policy.method !== method || policy.path !== path) {
    throw new Error(`Route policy mismatch for ${method} ${path}`);
  }

  router.all(path, async (c, next) => {
    if (c.req.method !== method) return methodError(c, method);
    await next();
  });
  router[normalizedMethod](path, policyMiddleware(policy), handler);
}
