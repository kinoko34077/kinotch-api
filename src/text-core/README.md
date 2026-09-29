# Japanese text core

Phase 1 extraction of the reusable Japanese text transformation modules from
`txt-auto-replace`.

The vendor modules are intentionally kept runtime-neutral: the Node test
adapter is `index.cjs`, while the future Cloudflare Worker adapter can bundle
the same UMD-compatible modules without importing Node APIs.

Rule definitions are stored as JSON5 data under `rules/`. The fixed KiNoTch.
compatibility packs `40-legacy-kanji.json5`,
`50-official-homophone-restoration.json5`, and `55-homophone-kanji.json5` are
consumer snapshots of the canonical `kinoko34077/japanese-orthography`
`kinotch-fixed` artifact rather than independent local rule authority. Their
accepted upstream commit, artifact identity, payload digests, byte lengths,
and loader order are pinned in `rules/kinotch-fixed-source-lock.json` and
verified offline by `scripts/verify-kinotch-fixed-rules.mjs` through the
existing `check:text-rules` / `check:text-snapshot` path.

The remaining rule files stay repository-local unless separately migrated.
`src/text-core/rules.generated.mjs` is still derived deterministically by the
existing text-rule generator, so runtime loading and Text Transform API
behavior do not depend on network access to the canonical repository.
