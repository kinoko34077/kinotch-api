# Private Identity read pilot transport — unactivated source (2026-10-24)

Owner: [kinotch-api #85](https://github.com/kinoko34077/kinotch-api/issues/85). Identity owner [kinotch-identity #6](https://github.com/kinoko34077/kinotch-identity/issues/6), cross-repository devflow #712/#707. 

## Scope and trust
- Existing Hono Gateway owns exactly `POST /v1/identity/catalog/read`, no body/query/alternate URL; upstream service request is exactly `POST /internal/v1/identity/catalog/read` to named `IDENTITY_PILOT` Service Binding.
- The existing Hono `registerRoute`, `policyMiddleware`, `enforceBodyLimit(0)`, `enforceRateLimit` and `proxyToWorker` are reused; preauth limit = five requests per 60 seconds using existing `JEV_AUDIT_PREAUTH_RATE_LIMITER` with distinct `identity-read-pilot-preauth` key prefix. The Gateway validates compact bearer **format only**, not trust.
- The private Identity Worker alone verifies GitHub issuer/JWKS/RS256, fixed `urn:kinotch:identity-read-pilot:v1` audience, exact owner/repo IDs, trusted reusable SHA, ref/event, fixed catalog.read, and atomic D1 JTI replay. Never accept local decoded claims or externally supplied keys, policy, host, path or arbitrary operation.
- Authorization header is relayed *only* to that private Worker. Existing metrics/error logging records route/status and omits Authorization. No API key, JWT, replay key or device secret is returned.
- Gateway source is **not** a released endpoint: existing production Worker has not been redeployed, and its `wrangler.jsonc` deliberately has **no** `IDENTITY_PILOT` binding. Even a future accidental source-only deploy fails closed for valid-looking bearer input (503), not a successful read. Do not claim actual hosted authentication.

## Pending reviewed cloud change

1. Independently verify authenticated Cloudflare account scope, existing **isolated** D1 `kinotch-identity-pilot` UUID and Worker name collision, Worker/Preview/route state, and quota. Owner PC's existing Cloudflare API token successfully reaches Workers scripts API but D1 `/d1/database` returns HTTP 401; Wrangler 4.131.1 `d1 list` reports authentication error 10000. Credential changes/permission expansion are NOT authorized as a workaround. Do not guess UUID or substitute an unrelated DB.
2. After correct rights and actual D1 identity are verified, review/apply only Identity `migrations/0001_oidc_replay.sql` to the **known isolated** D1 with a recorded pre/post table inventory; configure Identity-only `IDENTITY_REPLAY_DB` D1 Binding and deploy Identity Worker with **workers_dev:false, preview_urls:false, routes:[]**, no secrets/provider keys; verify deployed settings and fail-closed without D1.
3. Add exactly the following caller binding to the existing `kinotch-api` Gateway `wrangler.jsonc`, after the private callee is confirmed active (NOT currently present):
   ```json
   { "binding": "IDENTITY_PILOT", "service": "kinotch-identity-pilot" }
   ```
   Keep all pre-existing services, ratelimits and authentication. Review exact deployment diff with release scripts; avoid generic `wrangler deploy` or new competing Gateway.
4. Re-run production dry-run and existing Gateway regression tests; use established release command with before/after smoke and rollback proof. Then one explicitly manual `testapp` reusable OIDC job obtains a real token for the fixed audience and posts it without logging JWT/claim/bearer, checks expected 200 fixed read, then 403 replay. Separate negative tests cover 401 invalid token, 403 wrong policy/replay and 503 DB outage **without disrupting production DB**.
5. If the new route, Binding or real D1 fails validation, roll back the Gateway production version and keep the Identity Worker unexposed. Existing `kinotch-api #9` Policy B / production release policies remain independent.

## Acceptance record separation
GitHub PR/tests and Wrangler dry-run are source/build evidence only. Never report cloud D1 availability, actual GitHub JWKS verification, deployed host or signed real OIDC E2E as accepted until independently observed after release. The early GitHub issuer-only Run #39769855973 is not receiver proof.
