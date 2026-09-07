# Japanese text core

Phase 1 extraction of the reusable Japanese text transformation modules from
`txt-auto-replace`.

The vendor modules are intentionally kept runtime-neutral: the Node test
adapter is `index.cjs`, while the future Cloudflare Worker adapter can bundle
the same UMD-compatible modules without importing Node APIs.

Rule definitions are copied as JSON5 data under `rules/`. Loading them and
constructing a tokenizer are Phase 2 responsibilities; no public API behavior
changes in Phase 1.
