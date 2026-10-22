import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  SECURITY_MCP_WORKERS, executeFeeFreeMcpRelease,
} from "../scripts/release-security-mcp.mjs";

const initial = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
const updated = ["cccccccc-cccc-4ccc-8ccc-cccccccccccc","dddddddd-dddd-4ddd-8ddd-dddddddddddd"];

function scenario({failAt, failRollback=false, driftAt} = {}) {
  const actions=[], versions={}, records=[];
  SECURITY_MCP_WORKERS.forEach((worker,i) => { versions[worker.name]=initial[i]; });
  const opts={
    async prepare(){actions.push("prepare");return "f".repeat(40);},
    async dryRun(w){actions.push("dry:"+w.name);if(failAt==="dry")throw Error("dry failed");},
    async activeVersion(w){actions.push("read:"+w.name);return versions[w.name];},
    async discoverySmoke(w){
      actions.push("smoke:"+w.name);
      if(failAt==="preflight" && !actions.some(x=>x.startsWith("deploy:")))throw Error("Access denied");
      if(failAt==="post" && actions.some(x=>x.startsWith("deploy:")))throw Error("discovery failed");
    },
    async unauthenticatedSmoke(w){ actions.push("denied:"+w.name); },
    async deploy(w){
      actions.push("deploy:"+w.name);
      const i=SECURITY_MCP_WORKERS.indexOf(w);
      versions[w.name]=updated[i];
      if(failAt==="second_deploy" && i===1)throw Error("ambiguous network timeout");
    },
    async rollback(w,version){
      actions.push("rollback:"+w.name);
      if(failRollback)throw Error("rollback unavailable");
      versions[w.name]=version;
      return {status:"verified_rolled_back",targetVersionId:version};
    },
    async writeRecord(data){actions.push("record:"+data.status);records.push(data);},
  };
  return {actions,versions,records,opts};
}

test("public MCP security target allowlist cannot drift to API or private Workers",()=>{
  assert.deepEqual(SECURITY_MCP_WORKERS.map(x=>x.name), [
    "semantic-compression-mcp","jev-audit-mcp",
  ]);
  assert.deepEqual(SECURITY_MCP_WORKERS.map(x=>x.config), [
    "wrangler.semantic-compression-mcp.jsonc","wrangler.jev-audit-mcp.jsonc",
  ]);
});

test("success performs two dry runs and authenticated discovery but no provider tool calls",async()=>{
  const s=scenario();
  const result=await executeFeeFreeMcpRelease(s.opts);
  assert.equal(result.status,"succeeded");
  assert.equal(result.providerToolCalls,0);
  assert.equal(result.sourceRevision,"f".repeat(40));
  assert.deepEqual(s.actions.filter(x=>x.startsWith("deploy:")),[
    "deploy:semantic-compression-mcp","deploy:jev-audit-mcp",
  ]);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("smoke:")), [
    "smoke:semantic-compression-mcp","smoke:jev-audit-mcp",
    "smoke:semantic-compression-mcp","smoke:jev-audit-mcp",
  ]);
  assert.equal(s.actions.filter(x=>x.startsWith("denied:")).length,4);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("rollback:")),[]);
  assert.deepEqual(s.records.map(x=>x.status),["succeeded"]);
});

test("missing original Cloudflare Access authorization blocks before any deployment",async()=>{
  const s=scenario({failAt:"preflight"});
  await assert.rejects(executeFeeFreeMcpRelease(s.opts),/Access denied/);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("deploy:")),[]);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("rollback:")),[]);
  assert.deepEqual(s.records.map(x=>x.status),["failed"]);
});

test("dry-run failure prevents any public Worker mutation",async()=>{
  const s=scenario({failAt:"dry"});
  await assert.rejects(executeFeeFreeMcpRelease(s.opts),/dry failed/);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("deploy:")),[]);
});

test("ambiguous failure AFTER second live deploy rolls both versions back in reverse order",async()=>{
  const s=scenario({failAt:"second_deploy"});
  await assert.rejects(executeFeeFreeMcpRelease(s.opts),/ambiguous network timeout/);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("rollback:")), [
    "rollback:jev-audit-mcp","rollback:semantic-compression-mcp",
  ]);
  assert.deepEqual(SECURITY_MCP_WORKERS.map(x=>s.versions[x.name]),initial);
  assert.equal(s.records[0].status,"failed");
  assert.equal(s.records[0].providerToolCalls,0);
});

test("failed post-deployment authentication rolls both MCP Workers back",async()=>{
  const s=scenario({failAt:"post"});
  await assert.rejects(executeFeeFreeMcpRelease(s.opts),/discovery failed/);
  assert.deepEqual(SECURITY_MCP_WORKERS.map(x=>s.versions[x.name]),initial);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("rollback:")), [
    "rollback:jev-audit-mcp","rollback:semantic-compression-mcp",
  ]);
});

test("unverified rollback is fatal even if the original deploy error was non-billable",async()=>{
  const s=scenario({failAt:"second_deploy",failRollback:true});
  await assert.rejects(executeFeeFreeMcpRelease(s.opts),/rollbacks are UNVERIFIED/);
  assert.equal(s.records[0].recoveries["jev-audit-mcp"].status,"rollback_failed");
  assert.equal(s.records[0].recoveries["semantic-compression-mcp"].status,"rollback_failed");
});

test("canonical wrapper has exactly the explicit fee-free mode and default full release retained",async()=>{
  const w=await readFile(new URL("../scripts/deploy-production-with-jev-audit.mjs",import.meta.url),"utf8");
  assert.match(w,/runFeeFreeMcpSecurityRelease/);
  assert.match(w,/process\.argv\[2\] === "--security-mcp-only"/);
  assert.match(w,/Unknown production release mode; refusing to run/);
  assert.match(w,/runCoreProductionRelease\(\)/);
  const m=await readFile(new URL("../scripts/release-security-mcp.mjs",import.meta.url),"utf8");
  assert.match(m,/checkToolCall: false/g);
  assert.doesNotMatch(m,/checkToolCall: true/);
  assert.doesNotMatch(m,/runJevAuditRestSmoke|runCompressionSmoke\(/);
});

test("unauthenticated public MCP preflight failure never deploys",async()=>{
  const s=scenario();
  s.opts.unauthenticatedSmoke=async()=>{throw Error("anonymous access unexpectedly possible");};
  await assert.rejects(executeFeeFreeMcpRelease(s.opts),/anonymous access unexpectedly possible/);
  assert.deepEqual(s.actions.filter(x=>x.startsWith("deploy:")),[]);
});
