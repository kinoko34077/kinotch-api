import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { executeFeeFreeMcpRelease } from "../scripts/release-security-mcp.mjs";
import { assertFeeFreeIdentityGatewayConfig } from "../scripts/release-identity-gateway.mjs";
import {
  MAPPER_MODES, requiredKeysForMode, createMappedChildEnv,
  runMappedCommand,
} from "../scripts/production-secret-mapper.mjs";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
const worker = Object.freeze({name:"api",config:"wrangler.jsonc"});

test("fee-free Gateway release requires exact existing Gateway and private callee",()=>{
  assert.equal(assertFeeFreeIdentityGatewayConfig(config),true);
  const reject = value=>assert.throws(()=>assertFeeFreeIdentityGatewayConfig(value),
    /Unreviewed Gateway/);
  reject({...config,workers_dev:false});
  reject({...config,preview_urls:true});
  reject({...config,account_id:"not-the-original-account"});
  reject({...config,d1_databases:[]});
  reject({...config,services:config.services.slice(0,-1)});
  reject({...config,services:[...config.services,{binding:"EXTRA",service:"untrusted"}]});
  reject({...config,services:config.services.map(x=>x.binding==="IDENTITY_PILOT"?
    {binding:"IDENTITY_PILOT",service:"untrusted"}:x)});
});

test("identity release mode maps only central Cloudflare token and never provider secrets",async()=>{
  assert.deepEqual(requiredKeysForMode(MAPPER_MODES.IDENTITY_GATEWAY_RELEASE),
    ["CLOUDFLARE_API_TOKEN"]);
  const env=createMappedChildEnv({
    mode:MAPPER_MODES.IDENTITY_GATEWAY_RELEASE,
    secrets:{CLOUDFLARE_API_TOKEN:"FAKE_CF_TOKEN",COMPRESSION_SMOKE_TOKEN:"MUST_NOT_LEAK"},
    sourceEnv:{PATH:"PATH_FIXTURE",JEV_AUDIT_SMOKE_TOKEN:"NO",GEMINI_API_KEY:"NO"},
  });
  assert.equal(env.CLOUDFLARE_API_TOKEN,"FAKE_CF_TOKEN");
  assert.equal(env.COMPRESSION_SMOKE_TOKEN,undefined);
  assert.equal(env.JEV_AUDIT_SMOKE_TOKEN,undefined);
  assert.equal(env.GEMINI_API_KEY,undefined);
  const calls=[];
  const code=await runMappedCommand(MAPPER_MODES.IDENTITY_GATEWAY_RELEASE,{
    secrets:{CLOUDFLARE_API_TOKEN:"FAKE_CF_TOKEN"},
    sourceEnv:{PATH:"PATH_FIXTURE"},
    spawnImpl:(command,args,options)=>{
      calls.push({command,args,env:options.env});
      const child=new EventEmitter();
      queueMicrotask(()=>child.emit("close",0,null));
      return child;
    },
  });
  assert.equal(code,0);
  assert.equal(calls.length,1);
  assert.ok(calls[0].args.join(" ").includes("--identity-gateway-only"));
  assert.deepEqual(Object.keys(calls[0].env).sort(),
    ["CLOUDFLARE_API_TOKEN","PATH"].sort());
});

test("generic fail-safe release engine accepts exactly one fixed Gateway only",async()=>{
  const calls=[];
  let version="11111111-1111-1111-1111-111111111111";
  let record;
  const fake={
    workers:[worker],mode:"fee_free_identity_gateway_only",
    validation:"fixture_non_billable",
    prepare:async()=>{calls.push("prepare");return "trusted_source";},
    dryRun:async()=>calls.push("dry-run"),
    acquireLock:async()=>{calls.push("lock");return {key:"exclusive"};},
    releaseLock:async()=>calls.push("unlock"),
    activeVersion:async()=>version,
    deploy:async()=>{calls.push("deploy");version="22222222-2222-2222-2222-222222222222";},
    discoverySmoke:async()=>calls.push("health"),
    unauthenticatedSmoke:async()=>calls.push("deny"),
    rollback:async()=>{throw Error("rollback should not run");},
    writeRecord:async value=>{record=value;},
  };
  const done=await executeFeeFreeMcpRelease(fake);
  assert.equal(done.status,"succeeded");
  assert.equal(done.mode,"fee_free_identity_gateway_only");
  assert.equal(done.providerToolCalls,0);
  assert.equal(done.activeVersions.api,version);
  assert.deepEqual(calls,[
    "prepare","dry-run","lock","health","deny","deploy","health","deny","unlock",
  ]);
  assert.deepEqual(record,done);
  for(const wrong of [
    [{name:"other",config:"wrangler.jsonc"}],
    [{name:"api",config:"wrangler-other.jsonc"}],
    [worker,worker],
  ]){
    await assert.rejects(executeFeeFreeMcpRelease({...fake,workers:wrong}),
      /Unapproved scoped|must target only api/);
  }
});

test("scoped Gateway release preserves rollback and lock release after postflight denial",async()=>{
  const first="11111111-1111-1111-1111-111111111111";
  const next="22222222-2222-2222-2222-222222222222";
  let version=first,attempts=0,rollbacks=0,unlocks=0;
  const records=[];
  await assert.rejects(executeFeeFreeMcpRelease({
    workers:[worker],mode:"fee_free_identity_gateway_only",
    prepare:async()=>"trusted",dryRun:async()=>{},
    acquireLock:async()=>({key:"exclusive"}),
    releaseLock:async()=>{unlocks++;},
    activeVersion:async()=>version,
    deploy:async()=>{version=next;},
    discoverySmoke:async()=>{attempts++; if(version===next)throw Error("postflight denied");},
    unauthenticatedSmoke:async()=>{},
    rollback:async(_,target)=>{assert.equal(target,first);version=first;rollbacks++;return {status:"verified_rolled_back"};},
    writeRecord:async value=>{records.push(value);},
  }),/postflight denied/);
  assert.equal(rollbacks,1);
  assert.equal(unlocks,1);
  assert.equal(records.length,1);
  assert.equal(records[0].status,"failed");
  assert.equal(records[0].recoveries.api.status,"verified_rolled_back");
  assert.equal(attempts,2);
});
