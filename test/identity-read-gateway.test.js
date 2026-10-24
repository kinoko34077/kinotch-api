import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/index.js";
import { routePolicies } from "../src/policies/routes.js";

const PATH = "/v1/identity/catalog/read";
const TOKEN = "header.payload.signature"; // Format fixture only, never an actual JWT
const MOCK_CONTENT = { ok: true, schema: "kinotch.identity.read-pilot.v1", operation: "catalog.read" };

function harness({ limiter = true, service = true } = {}) {
  const seen = [];
  const env = {
    JEV_AUDIT_PREAUTH_RATE_LIMITER: limiter === null ? undefined :
      { async limit({ key }) {
        seen.push({ type: "rate", key });
        return { success: limiter };
      } },
    IDENTITY_PILOT: service === false ? undefined : {
      async fetch(request) {
        seen.push({
          type: "service", url: request.url, method: request.method,
          authorization: request.headers.get("authorization"),
          body: await request.text(),
        });
        return new Response(JSON.stringify(MOCK_CONTENT), {
          status: 200, headers: {
            "Content-Type": "application/json",
            "Cache-Control": "private, no-store",
            "X-Pilot-Private-Header": "must-not-forward",
          },
        });
      },
    },
  };
  async function invoke({ token = TOKEN, method = "POST", query = "", body,
                          override = {} } = {}) {
    return app.request("https://api.invalid" + PATH + query, {
      method,
      headers: token === null ? {} : { Authorization: "Bearer " + token },
      ...(body === undefined ? {} : { body }),
    }, { ...env, ...override });
  }
  return { invoke, seen };
}

test("fixed same-origin route uses existing Hono policies and a private Service Binding only", async () => {
  assert.equal(routePolicies.identityCatalogRead.path, PATH);
  assert.equal(routePolicies.identityCatalogRead.bodyLimitBytes, 0);
  assert.equal(routePolicies.identityCatalogRead.preAuthRateLimit.binding, "JEV_AUDIT_PREAUTH_RATE_LIMITER");
  const h = harness();
  const r = await h.invoke();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), MOCK_CONTENT);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("x-pilot-private-header"), null);
  const upstream = h.seen.find(x => x.type === "service");
  assert.equal(upstream.url, "https://internal.invalid/internal/v1/identity/catalog/read");
  assert.equal(upstream.method, "POST");
  assert.equal(upstream.authorization, "Bearer " + TOKEN);
  assert.equal(upstream.body, "");
  assert.equal(h.seen.filter(x => x.type === "service").length, 1);
  assert.ok(h.seen[0].key.startsWith("identity-read-pilot-preauth:"));
});
test("no private Identity binding or unavailable rate limiter denies before forwarding", async () => {
  const a = harness({service:false});
  assert.equal((await a.invoke()).status, 503);
  assert.equal(a.seen.filter(x=>x.type==="service").length,0);
  const b = harness({limiter:null});
  assert.equal((await b.invoke()).status,503);
  assert.equal(b.seen.filter(x=>x.type==="service").length,0);
});
test("429 preauthentication rate deny stops all upstream operations", async () => {
  const h = harness({limiter:false});
  const r = await h.invoke();
  assert.equal(r.status,429);
  assert.equal(h.seen.filter(x=>x.type==="service").length,0);
});
test("JWT format missing, bogus or excessive length rejects without downstream call", async () => {
  const h = harness();
  for(const token of [null,"garbage","header.payload","x".repeat(9000)]) {
    assert.equal((await h.invoke({token})).status,401);
  }
  assert.equal(h.seen.filter(x=>x.type==="service").length,0);
});
test("query, body and unapproved method denied with no downstream call", async () => {
  const h = harness();
  assert.equal((await h.invoke({query:"?url=https://evil.invalid"})).status,400);
  assert.equal((await h.invoke({body:"{}"})).status,413);
  assert.equal((await h.invoke({method:"GET"})).status,405);
  assert.equal(h.seen.filter(x=>x.type==="service").length,0);
});
test("upstream failures and exceptions are not reported as success", async () => {
  const h=harness();
  for(const [v,expected] of [
    [{async fetch(){ return new Response("server error",{status:500}) }},502],
    [{async fetch(){ throw Error("no private worker") }},502],
    [{async fetch(){ return new Response("unavailable",{status:503}) }},503],
  ]) {
    const r=await h.invoke({override:{IDENTITY_PILOT:v}});
    assert.equal(r.status,expected);
  }
});
test("request never implicitly passes body to private Worker and cannot configure endpoint URL", async () => {
  const h = harness();
  assert.equal((await h.invoke({query:"?path=%2Felsewhere"})).status,400);
  const r=await h.invoke();
  assert.equal(r.status,200);
  assert.equal(h.seen.filter(x=>x.type==="service").length,1);
});
