export function resolveLiveGeminiConfig(env) {
  const shouldRun = env.RUN_GEMINI_LIVE_TEST === "true";
  const apiKey = env.KINOTCH_COMPRESSION_GEMINI_API_KEY;

  if (shouldRun && (typeof apiKey !== "string" || apiKey.length === 0)) {
    throw new Error(
      "KINOTCH_COMPRESSION_GEMINI_API_KEY is required when RUN_GEMINI_LIVE_TEST=true",
    );
  }

  return {
    shouldRun: shouldRun && typeof apiKey === "string" && apiKey.length > 0,
    apiKey: shouldRun ? apiKey : undefined,
  };
}
