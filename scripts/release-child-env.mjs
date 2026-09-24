// Build/test children receive only this explicitly safe process environment.
// Release-only secrets are excluded by construction instead of by a growing
// denylist that can miss newly introduced secret names.
export const RELEASE_CHILD_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_ARCHITEW6432",
  "NUMBER_OF_PROCESSORS",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CI",
  "NODE_ENV",
  "TZ",
  "LANG",
  "LC_ALL",
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
  const childEnv = {};
  for (const name of RELEASE_CHILD_ENV_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(sourceEnv, name)) {
      childEnv[name] = sourceEnv[name];
    }
  }

  if (includeCloudflareCredentials) {
    for (const name of CLOUDFLARE_CREDENTIAL_ENV_NAMES) {
      if (Object.prototype.hasOwnProperty.call(sourceEnv, name)) {
        childEnv[name] = sourceEnv[name];
      }
    }
  }

  return childEnv;
}
