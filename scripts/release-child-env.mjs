export const RELEASE_ONLY_SECRET_ENV_NAMES = Object.freeze([
  "MCP_SMOKE_ACCESS_COOKIE",
  "COMPRESSION_SMOKE_TOKEN",
  "GEMINI_API_KEY",
  "KINOTCH_COMPRESSION_GEMINI_API_KEY",
  "RUN_GEMINI_LIVE_TEST",
  "RUN_COMPRESSION_QUALITY_EVAL",
  "RUN_COMPRESSION_USAGE_MEASURE",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "WRANGLER_API_TOKEN",
]);

export const CLOUDFLARE_CREDENTIAL_ENV_NAMES = Object.freeze([
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "WRANGLER_API_TOKEN",
]);

export function createReleaseChildEnv(
  sourceEnv = process.env,
  { includeCloudflareCredentials = false } = {},
) {
  const childEnv = { ...sourceEnv };
  for (const name of RELEASE_ONLY_SECRET_ENV_NAMES) delete childEnv[name];

  if (includeCloudflareCredentials) {
    for (const name of CLOUDFLARE_CREDENTIAL_ENV_NAMES) {
      if (Object.prototype.hasOwnProperty.call(sourceEnv, name)) {
        childEnv[name] = sourceEnv[name];
      }
    }
  }

  return childEnv;
}
