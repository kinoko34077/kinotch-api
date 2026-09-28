# Semantic Compression MCP JWKS Resolver Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the Semantic Compression MCP Cloudflare Access JWKS resolver within the same factory/issuer boundary without changing authentication decisions.

**Architecture:** Mirror the accepted Jev MCP pattern with a `WeakMap` keyed by the injected resolver factory and a nested `Map` keyed by normalized issuer. Keep resolver state local to each factory and issuer; do not share JWT or credential state across boundaries.

**Tech Stack:** JavaScript ES modules, `jose`, Node test runner, Cloudflare Workers runtime.

**Spec:** GitHub Issue #49 — Semantic Compression MCP JWKS resolver lifetime.

## Global Constraints

- Preserve issuer, audience, signature, expiration, fail-closed, and actor-fingerprint behavior.
- Cache only the remote JWKS resolver object; do not cache JWT payloads or credentials.
- Do not modify REST Compression, Jev MCP, Production deployment, Access policy, or retry behavior.
- Do not run or trigger a Production deploy.

## Review Focus

- Repeated verification with the same factory and issuer reuses exactly one resolver.
- A different issuer receives a different resolver under the same factory.
- A different injected factory cannot observe or reuse another factory's resolver.
- Missing configuration and invalid JWT failures remain fail-closed.
- Actor fingerprint output remains non-reversible and unchanged.

### Task 1: Add Semantic Compression JWKS cache regression tests

**Files:**
- Modify: `test/semantic-compression-mcp-auth.test.js`

**Interfaces:**
- Consumes: `verifyAccessJwt(request, env, { createRemoteJWKSetImpl, jwtVerifyImpl })`.
- Produces: regression coverage for resolver reuse and cache isolation.

- [ ] **Step 1: Write failing tests** for same issuer reuse, issuer isolation, and factory isolation. Assert factory call counts and resolver identity observed by `jwtVerifyImpl`.
- [ ] **Step 2: Run the focused auth test** and confirm the new reuse test fails because the current implementation creates a resolver for each request, while existing auth tests remain valid.
- [ ] **Step 3: Commit the test-only red state only after implementation is ready for the same task cycle; do not publish a failing branch.**

### Task 2: Cache the resolver by factory and issuer

**Files:**
- Modify: `src/semantic-compression-mcp/access-auth.js`

**Interfaces:**
- Consumes: the existing `createRemoteJWKSetImpl` injection point.
- Produces: a cached resolver passed into `jwtVerifyImpl` for matching factory/issuer pairs.

- [ ] **Step 1: Implement a module-local `WeakMap` factory cache with an issuer `Map`, matching the accepted Jev MCP boundary.**
- [ ] **Step 2: Run the focused Semantic Compression MCP auth test and confirm all tests pass.**
- [ ] **Step 3: Run the full project test suite and `git diff --check`.**
- [ ] **Step 4: Commit the implementation, tests, and plan as one coherent Issue #49 change.**

### Task 3: Final verification and Issue/PR evidence

**Files:**
- No additional source files.

- [ ] **Step 1: Confirm the worktree contains only the Issue #49 plan, auth implementation, and auth tests.**
- [ ] **Step 2: Confirm no Production deploy or external Access configuration was changed.**
- [ ] **Step 3: Push the feature branch and open a PR targeting `main`; record test and scope evidence in Issue #49.**

