# kinotch-api

kinotch-apiは、Cloudflare Workers上で動作するAPI Gatewayと、Text Transform、
Semantic Compression、Jev Audit Remote、Remote MCPの責務別Workerを同一repositoryで管理するサービスです。

本番公開URL:

~~~text
https://api.kinotch.workers.dev
~~~

## できること

| Surface | Endpoint | 用途 |
|---|---|---|
| Gateway | GET /health | 稼働確認 |
| Gateway | GET /v1/time | 時刻中継 |
| Gateway | GET /v1/weather | 天気中継 |
| Gateway | GET /v1/calendar/rokuyo | 六曜中継 |
| Gateway | GET /v1/astronomy/moon | 月情報中継 |
| Text API | GET /v1/capabilities | Text Workerの能力・version確認 |
| Text API | POST /v1/ruby/parse | ルビ解析 |
| Text API | POST /v1/transform | 文章変換 |
| Text API | POST /v1/transform/batch | batch文章変換 |
| Compression API | POST /v1/compress | 固定Promptによる意味保存型圧縮 |
| Compression Remote MCP | /mcp | Codex等からcompress_textを利用 |
| Jev Audit REST | POST /v1/audit | explicit file snapshotの監査 |
| Jev Audit Remote MCP | https://jev-audit-mcp.kinotch.workers.dev/mcp | audit_files / list_profilesを利用 |

Gatewayは公開入口であり、Text Transform、Semantic Compression、Jev AuditはService Binding経由の
private Workerです。Remote MCPもAccessで保護された薄いadapterで、実処理は対応する
private Workerへ委譲します。

## Compression APIの最短利用例

REST callerにはCompression専用Bearer tokenが必要です。tokenの実値は環境変数やSecret
managerで管理し、repository、README、ログへ保存しないでください。

~~~powershell
$token = "<COMPRESSION_API_TOKEN>"
$body = @{
  text = "これは圧縮対象本文です。条件と例外を保持してください。"
  profile = "semantic-dense-v1"
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "https://api.kinotch.workers.dev/v1/compress" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body
~~~

profileは compact-v1 または semantic-dense-v1 のみです。現在のPrompt versionは、compact-v1 が compact-v1.1、semantic-dense-v1 が semantic-dense-v1.1 です。profileとprompt_versionは別fieldで、callerから変更できません。callerからPrompt、model、
provider、temperature、tools、Search、会話履歴、thinking設定は指定できません。

成功responseには次が含まれます。

~~~json
{
  "compressed_text": "...",
  "profile": "semantic-dense-v1",
  "prompt_version": "semantic-dense-v1.1",
  "model": "gemini-3.5-flash-lite",
  "input_chars": 0,
  "output_chars": 0,
  "input_sha256": "...",
  "output_sha256": "...",
  "usage": {
    "input_tokens": 0,
    "system_prompt_tokens": 0,
    "content_input_tokens": 0,
    "output_tokens": 0,
    "thought_tokens": 0,
    "cached_tokens": 0,
    "total_tokens": 0
  },
  "warnings": []
}
~~~

文字数はUnicode code point、hashはUTF-8本文のSHA-256です。compressed_textは
モデル出力なのでuntrusted display dataとして扱い、HTMLへ表示する場合はsanitize
してください。

詳細なfield、error、limit、Prompt、usage、warningの仕様は
docs/specs/semantic-compression-api.mdを参照してください。

## Compression Remote MCPの最短利用例

現在のMCP endpointは次です。

~~~text
https://semantic-compression-mcp.kinotch.workers.dev/mcp
~~~

Cloudflare Access Managed OAuthで保護され、公開toolはcompress_textだけです。
入力は text だけで、profileは内部で semantic-dense-v1 に固定されます。

~~~json
{
  "text": "次の長文を意味関係を保持して圧縮してください。"
}
~~~

Codex登録、Access bootstrap、MCP Inspector、OAuth login、release smoke用Service Token、
initialize lifecycle、トラブルシュートは docs/semantic-compression-mcp.md を参照してください。
REST用のCOMPRESSION_API_TOKENをMCP認証へ流用しないでください。

## Jev Audit Remote

Jev Audit Remoteは`jev-audit` v0.2.12の監査意味論を、明示的に送信されたfile snapshotへ適用するhosted surfaceです。

REST入口は `POST /v1/audit`、Remote MCP入口は `https://jev-audit-mcp.kinotch.workers.dev/mcp` です。
Remote MCPは `audit_files` と `list_profiles` のみを公開します。Remote v1はlocal filesystemやGitを読まず、`changed_only`も提供しません。

Jev Audit Remoteは2026-09-25の正式releaseで **Production verified** です。source revision `84e8109ef43064efd72fd1012054dc7787de6a8e` から、live TypeSafe REST E2EとCloudflare Access Service Token経由のauthenticated MCP `audit_files` tool callが成功し、rollback不要で完了した証跡を `docs/releases/20260925T144351192Z.json` と `docs/releases/jev-audit-20260925T144353075Z.json` に保持しています。
Jev Audit MCPではService Token経路を通常Production認証として採用します。Jev固有のManaged OAuth E2Eは完了条件ではなく、将来interactive利用が必要になった場合の任意拡張です。
詳細は docs/jev-audit.md を参照してください。

## ローカル開発

PowerShellで実行します。

~~~powershell
npm ci
npm test
npm run test:mcp
~~~

生成物を確認する場合:

~~~powershell
npm run build:text-snapshot
npm run check:text-snapshot
~~~

Workerのdry-run:

~~~powershell
npx wrangler deploy --config .\wrangler.text-transform.jsonc --dry-run
npx wrangler deploy --config .\wrangler.semantic-compression.jsonc --dry-run
npx wrangler deploy --config .\wrangler.semantic-compression-mcp.jsonc --dry-run
npx wrangler deploy --config .\wrangler.jev-audit.jsonc --dry-run
npx wrangler deploy --config .\wrangler.jev-audit-mcp.jsonc --dry-run --var TEAM_DOMAIN:https://example.cloudflareaccess.com --var POLICY_AUD:test-aud
npx wrangler deploy --config .\wrangler.jsonc --dry-run
~~~

実Gemini live testは通常testから分離されています。明示的に専用credentialとflagを
設定したときだけ実行します。

~~~powershell
$env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<Compression専用Gemini key>"
$env:RUN_GEMINI_LIVE_TEST = "true"
npm run test:compression:live
Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:RUN_GEMINI_LIVE_TEST -ErrorAction SilentlyContinue
~~~

local live testはGEMINI_API_KEYをfallback参照しません。Cloudflare Worker Secretの
GEMINI_API_KEYとは別のローカル専用名です。

## Production release

通常のProduction authorityは npm run deploy:production だけです。

mainへのpushはtestとVerifyを起動しますが、Production deployを直接起動しません。
Cloudflare Workers Builds / Git integrationの単独Production auto-deploy、個別Workerの
手動deploy、別のrelease scriptを正式経路にしないでください。

Jev Auditを含む通常releaseはJev Audit release wrapperから既存core production releaseへ接続し、source revision、clean worktree、npm ci、generated checks、tests、Worker dry-run、active Version capture、deploy、authenticated smoke、release metadata、失敗時rollbackを管理します。既存Semantic Compressionのrelease順序・smoke責務は維持されます。

本番実行にはoperator-managedなSecret、Cloudflare Access、release smoke用Service Token等が
必要です。実値は入力・ログ・commit・release metadataへ残さないでください。Compression MCPのinteractive Codex利用は既存Managed OAuthを維持しますが、Jev Audit MCPはCloudflare Access Service Tokenを通常Production経路として使用し、Jev固有のManaged OAuthを必須としません。

詳細は docs/OPERATIONS.md、docs/semantic-compression.md、
docs/semantic-compression-mcp.md、docs/jev-audit.md を参照してください。

### Production secret mapper

Production用のoperator値は、repository外の固定ファイル
`%USERPROFILE%\.kinotch-secrets\kinotch-api.production.env` から安全に供給できます。
mapperがProduction releaseで扱うkeyは `TEAM_DOMAIN`、`POLICY_AUD`、`MCP_ENDPOINT`、
`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`、`COMPRESSION_SMOKE_TOKEN`、
`CLOUDFLARE_API_TOKEN`、`JEV_AUDIT_MCP_POLICY_AUD`、`JEV_AUDIT_SMOKE_TOKEN` の9つです。
必須key不足はfail-closedで停止し、未知keyは子processへ渡さず無視します。値はログへ出しません。
Wrangler用Cloudflare credentialもこの固定secret fileから供給します。Compression/Jev Auditの自動MCP smokeは同じAccess Service Tokenを使用し、session cookieは使用しません。

通常の操作は次の2つです。

~~~powershell
npm run smoke:mcp:local
npm run release:local
~~~

`smoke:mcp:local` は既存の `npm run smoke:mcp` を、`release:local` はJev Audit-aware production wrapperを経由して既存core releaseを起動するlauncherです。Production deploy authority、clean worktree、`main == origin/main`、test、dry-run、smoke、rollback、release metadataの既存gateは維持されます。agentはsecret directoryを直接開かず、mapperをopaque boundaryとして扱います。

## セキュリティと非目的

- Compressionは汎用LLM proxy、chat、agent、任意Prompt APIではありません。
- Compression MCPはcompress_textだけを公開し、Jev Audit MCPはaudit_files / list_profilesだけを公開します。
- Gemini API key、TypeSafe API key、REST caller token、local live-test key、MCP認証、release smoke credentialは責務ごとに分離します。
- 本文、diff/source全文、compressed_text全文、Authorization、Access credential、provider key、System Prompt全文、raw provider responseを本番ログへ記録しません。
- private Workerはworkers.dev直公開を無効化し、Gatewayまたは対応するMCP Service Bindingだけで到達させます。
- prompt injection対策は入力をデータとして扱う境界であり、出力を安全化するHTML sanitizerではありません。

## ドキュメント

| 内容 | 文書 |
|---|---|
| 使い方・開発・運用の入口 | docs/USAGE.md |
| API／機能／データ仕様 | docs/specs/semantic-compression-api.md |
| Compressionの運用・secret・live test | docs/semantic-compression.md |
| Compression Remote MCP契約 | docs/specs/semantic-compression-mcp.md |
| Compression Remote MCP Access・Codex・smoke | docs/semantic-compression-mcp.md |
| Jev Audit Remote API / MCP・secret・verification state | docs/jev-audit.md |
| Gateway/Text API運用 | docs/OPERATIONS.md |
| 共通Text API計画 | docs/API_PLAN.md |
| 変更・release履歴 | docs/DEVELOPMENT_HISTORY.md |
| release metadata | docs/releases/ |
| Repository Baseの現在状態 | project/docs/CURRENT_STATE.md |

変更履歴はGitのfirst-parentとtracked release metadataを根拠に
docs/DEVELOPMENT_HISTORY.mdへまとめています。Gitだけではpushイベントの完全な監査履歴を
復元できないため、正確なpush時刻やCloudflare反映はGitHub／Cloudflare側の履歴と併読します。
