# kinotch-api 利用・運用ガイド

この文書は、kinotch-apiを利用・開発・運用する人向けの実務ガイドである。
公開契約の正本は各仕様書に置き、ここでは「どの入口を使い、何を準備し、どの順に検証するか」をまとめる。

## 1. サービスの役割

kinotch-apiはCloudflare Workers上のGatewayと、責務別のprivate Workerを同一repositoryで管理する。

~~~text
HTTP client
  └─ HTTPS → api.kinotch.workers.dev
                ├─ REST route policy / auth / rate limit
                ├─ Service Binding → text-transform
                ├─ Service Binding → semantic-compression
                ├─ Service Binding → jev-audit
                └─ Service Binding → clock / weather / rokuyo

MCP client / Codex
  └─ OAuth / Access → Cloudflare Access
                ├─ semantic-compression-mcp /mcp
                │     └─ Service Binding → semantic-compression
                │           └─ Gemini Interactions API
                └─ jev-audit-mcp /mcp
                      └─ Service Binding → jev-audit
                            └─ TypeSafe System One API
~~~

Compressionの実処理、Prompt、profile、model、usage、hash、文字数検証は
semantic-compression Workerが正本として持つ。Jev Audit Remoteのsnapshot validation、batching、
TypeSafe呼出、response validation、deterministic aggregationはprivate jev-audit Workerが所有する。
各Remote MCPは薄いadapterであり、provider処理を複製しない。

## 2. 最初に読む資料

| 用途 | 正本 |
|---|---|
| 人間向け入口 | README.md |
| 公開Compression API契約 | docs/specs/semantic-compression-api.md |
| Compressionのsecret・live test・deploy | docs/semantic-compression.md |
| Compression Remote MCP契約 | docs/specs/semantic-compression-mcp.md |
| Compression Remote MCPのAccess・Codex・smoke | docs/semantic-compression-mcp.md |
| Jev Audit Remote API / MCP・secret・verification state | docs/jev-audit.md |
| Gateway/Text API運用 | docs/OPERATIONS.md |
| Text API計画・互換性 | docs/API_PLAN.md |
| 開発・変更履歴 | docs/DEVELOPMENT_HISTORY.md |
| Release実績 | docs/releases/*.json |
| 現在状態 | project/docs/CURRENT_STATE.md |

## 3. ローカル開発

### 3.1 準備

PowerShellでrepository rootへ移動し、lockfileから依存関係を構築する。

~~~powershell
npm ci
~~~

通常テストは外部Gemini、TypeSafe、Cloudflare、MCP Accessへ接続しない。

~~~powershell
npm test
~~~

Text snapshotの生成物を個別に確認する場合:

~~~powershell
npm run build:text-snapshot
npm run check:text-snapshot
~~~

### 3.2 Worker dry-run

本番deployの代わりに、対象Workerごとのbundleとbindingを確認する。

~~~powershell
npx wrangler deploy --config .\wrangler.text-transform.jsonc --dry-run
npx wrangler deploy --config .\wrangler.semantic-compression.jsonc --dry-run
npx wrangler deploy --config .\wrangler.semantic-compression-mcp.jsonc --dry-run
npx wrangler deploy --config .\wrangler.jev-audit.jsonc --dry-run
npx wrangler deploy --config .\wrangler.jev-audit-mcp.jsonc --dry-run --var TEAM_DOMAIN:https://example.cloudflareaccess.com --var POLICY_AUD:test-aud
npx wrangler deploy --config .\wrangler.jsonc --dry-run
~~~

dry-runはProduction反映ではない。Cloudflare credentialやAccess設定の存在だけで、
実際のGateway→Worker→Provider経路が確認済みになるわけではない。

### 3.3 MCP単体テスト

~~~powershell
npm run test:mcp
~~~

MCP testはJWT fixture、fake Service Binding、malformed upstream、rate limit、
privacy境界を検査する。通常のnpm testと同じく外部OAuthや実Providerは使わない。

## 4. 公開REST API

Base URL:

~~~text
https://api.kinotch.workers.dev
~~~

### 4.1 一般route

| Method | Path | 用途 | 主な入力 |
|---|---|---|---|
| GET | /health | Gateway health | なし |
| GET | /v1/time | 時刻中継 | なし |
| GET | /v1/weather | 天気中継 | lat, lon |
| GET | /v1/calendar/rokuyo | 六曜 | date=YYYY-MM-DD |
| GET | /v1/astronomy/moon | 月情報 | lat, lon |
| GET | /v1/capabilities | Text API能力・version | なし |
| POST | /v1/ruby/parse | ルビ解析 | JSON |
| POST | /v1/transform | Text変換 | JSON |
| POST | /v1/transform/batch | Text batch変換 | JSON |
| POST | /v1/compress | 意味保存型圧縮 | JSON + Bearer |
| POST | /v1/audit | Jev Audit Remote snapshot監査 | JSON + Bearer |

GETの座標はlatが-90〜90、lonが-180〜180、dateは実在する
YYYY-MM-DDでなければならない。Text APIのprofile・レスポンスは
docs/API_PLAN.mdとtext-transform Workerの契約を参照する。Jev Audit Remoteの入力・上限・secret境界はdocs/jev-audit.mdを参照する。

### 4.2 Text APIの基本例

~~~powershell
$body = @{
  text = "変換対象の本文"
  profile = @("general-character-replacements")
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.kinotch.workers.dev/v1/transform" -ContentType "application/json" -Body $body
~~~

Ruby parseではtextと、必要な場合だけmarkers.open / markers.closeを送る。
batchではtexts配列を送り、最大256件・合計200,000文字のvalidationを受ける。
Text routeはpublic GatewayのPolicy、JSON validation、body limit、専用rate limitを通る。

## 5. Semantic Compression REST API

### 5.1 呼出例

Compression caller tokenはrepositoryへ保存せず、環境変数などoperator管理の安全な場所から読む。

~~~powershell
$compressionToken = "<COMPRESSION_API_TOKEN>"
$body = @{
  text = "圧縮対象本文"
  profile = "semantic-dense-v1"
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "https://api.kinotch.workers.dev/v1/compress" -Headers @{ Authorization = "Bearer $compressionToken" } -ContentType "application/json" -Body $body
~~~

curlを使う場合:

~~~bash
curl -X POST "https://api.kinotch.workers.dev/v1/compress" \
  -H "Authorization: Bearer $COMPRESSION_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"圧縮対象本文","profile":"semantic-dense-v1"}'
~~~

### 5.2 Request契約

送信できるfieldはtextとprofileだけである。

~~~json
{
  "text": "圧縮対象本文",
  "profile": "compact-v1"
}
~~~

profileは次の2値だけを受け付ける。

- compact-v1: 比較的軽量な固定Promptによる圧縮。
- semantic-dense-v1: 意味、情報、論理関係、不確実性の保持を優先する高密度圧縮。

prompt、system_instruction、model、provider、temperature、tools、Search、
history、thinking levelはcallerから指定できない。未知field、未知profile、
空text、型違いはProvider送信前に拒否する。

### 5.3 Success response

~~~json
{
  "compressed_text": "...",
  "profile": "semantic-dense-v1",
  "prompt_version": "semantic-dense-v1.1",
  "model": "gemini-3.5-flash-lite",
  "input_chars": 12345,
  "output_chars": 4567,
  "input_sha256": "64-char-lowercase-hex",
  "output_sha256": "64-char-lowercase-hex",
  "usage": {
    "input_tokens": 4321,
    "system_prompt_tokens": 1823,
    "content_input_tokens": 2498,
    "output_tokens": 987,
    "thought_tokens": 0,
    "cached_tokens": 0,
    "total_tokens": 5308
  },
  "warnings": []
}
~~~

input_charsとoutput_charsはUnicode code point数であり、Pythonのlen(str)と
一致する。SHA-256はUTF-8の本文そのものを対象とする。input_tokensは本文だけ
ではなく、固定System Prompt等を含むProvider側の総input tokenである。

usageがProvider responseにない場合はnullを許容する。
content_input_tokensはinput_tokensから固定Prompt metadataを引いた非負残差であり、
本文だけの厳密token数ではない。

warningsは本文やmarker値を含まない固定enumの機械的警告である。
警告があってもAPIが自動的に原文へfallbackするわけではない。
callerがwarningsを検査し、必要な場合だけ原文fallbackを判断する。

### 5.4 制限・エラー

| 制限 | 現行値 |
|---|---:|
| Gateway body limit | 2.5 MiB |
| 公開構造上限 | 1,000,000 Unicode code points |
| Provider送信前安全上限 | 200,000 Unicode code points |
| pre-auth rate limit | 5 requests / 60 seconds / IP |
| authenticated IP rate limit | 5 requests / 60 seconds / IP |
| token fingerprint rate limit | 5 requests / 60 seconds / token |
| Worker timeout | 45 seconds |
| Gateway upstream timeout | 50 seconds |

代表的なerror codeはinvalid_json、invalid_body、invalid_profile、empty_text、
payload_too_large、provider_context_limit、authentication_failed、
authentication_unavailable、rate_limited、provider_rate_limited、
provider_invalid_response、provider_error、provider_timeoutである。
Googleのraw error、API key、Prompt、本文は返さない。

### 5.5 固定Provider

Compression WorkerはGemini Interactions APIを次の条件で使う。

~~~json
{
  "model": "gemini-3.5-flash-lite",
  "input": "<text>",
  "system_instruction": "<fixed profile prompt>",
  "generation_config": {
    "thinking_level": "minimal"
  },
  "store": false
}
~~~

tools、Search、history、background、temperature、top_p、top_k、
thinking_budget、Provider生成requestの自動retryは使用しない。

compressed_textはモデル出力であり、untrusted display dataとして扱う。
HTMLへ表示する場合はsanitizeし、dangerous URL schemeやraw HTMLを許可しない。
Compression APIをprompt injection sanitizerとして利用してはならない。

## 6. Local live test

通常のnpm testでは外部APIを呼ばない。実Gemini確認を行う場合だけ、
Compression専用のローカル環境変数を明示する。

~~~powershell
$env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<Compression専用Gemini key>"
$env:RUN_GEMINI_LIVE_TEST = "true"
npm run test:compression:live

Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:RUN_GEMINI_LIVE_TEST -ErrorAction SilentlyContinue
~~~

kinotch-apiのlocal live testはGEMINI_API_KEYをfallback参照しない。
dev_agent等の環境変数との用途競合を避けるためである。

Cloudflare Worker secretは別契約であり、登録名はGEMINI_API_KEYのまま:

~~~powershell
npx wrangler secret put GEMINI_API_KEY --config .\wrangler.semantic-compression.jsonc
~~~

実値はREADME、docs、test fixture、logs、release metadataへ書かない。

品質評価・usage測定は別opt-inであり、既定15秒間隔、429自動retryなし、
通常testから外部通信なしという運用を維持する。詳細は
docs/semantic-compression.mdを参照する。

## 7. Compression Remote MCP

### 7.1 入口と認証

現在のCompression MCP endpointは次である。

~~~text
https://semantic-compression-mcp.kinotch.workers.dev/mcp
~~~

MCPはCloudflare Accessで保護する。Codex通常利用はManaged OAuth、Production release smokeは
専用Service Tokenを使う。MCP Worker内ではどちらの経路でもCloudflareが付与した
Cf-Access-Jwt-Assertionの署名、issuer、audience、expirationを検証する。
RESTのCOMPRESSION_API_TOKENをMCP認証や内部Service Binding呼出へ流用しない。

### 7.2 Tool契約

公開toolはcompress_textの1個だけで、入力はtextだけである。

~~~json
{
  "text": "長文本文"
}
~~~

profileは常にsemantic-dense-v1で、Prompt、model、provider、temperature、
tools、Search、historyはMCP callerから変更できない。
MCPはinitialize → notifications/initialized → tools/list → tools/callの
stateless Streamable HTTP lifecycleを使う。

### 7.3 Codex / Inspector

初回はAccess application、Managed OAuth、TEAM_DOMAIN、POLICY_AUD設定が必要。
その後、Codex側のOAuth loginとcompress_text実呼出を確認する。

~~~text
codex mcp login semantic_compressor
~~~

Production releaseのService Token smokeはCodex OAuth実呼出とは別証拠である。
MCP Inspector、Service Token smoke、Codex実呼出の詳細とbootstrap順序は
docs/semantic-compression-mcp.mdを参照する。

## 8. Jev Audit Remote

Jev Audit RemoteはローカルPython版を置き換えず、callerが明示的に送信したsnapshotだけを監査するhosted surfaceである。

REST:

~~~text
POST https://api.kinotch.workers.dev/v1/audit
~~~

Remote MCP:

~~~text
https://jev-audit-mcp.kinotch.workers.dev/mcp
~~~

MCP toolは`audit_files`と`list_profiles`だけである。Remote v1はlocal filesystemやGitを読まず、no `changed_only` supportである。profileは`development` / `generic`、監査意味論provenanceは`0.2.12`で固定する。

request例、上限、status semantics、secret所有境界、production verification stateはdocs/jev-audit.mdを正本とする。live TypeSafe E2E、Production deploy、authenticated Jev Audit MCP tool-call E2Eは成功証拠が記録されるまでpendingである。

## 9. Secretとprivacy

| 名前 | 用途 | 所有境界 |
|---|---|---|
| GEMINI_API_KEY | Gemini Provider credential | semantic-compression Worker Secret |
| KINOTCH_COMPRESSION_GEMINI_API_KEY | local live test専用 | operatorのローカル環境 |
| COMPRESSION_API_TOKEN | Compression REST caller認証 | Gateway Secret |
| COMPRESSION_SMOKE_TOKEN | Compression release smoke | operatorのローカル環境 |
| JEV_AUDIT_API_TOKEN | Jev Audit REST caller認証 | Gateway Secret |
| TYPESAFE_API_KEY | TypeSafe Provider credential | private jev-audit Worker Secret |
| TEAM_DOMAIN | MCP Access issuer設定 | MCP Worker vars |
| POLICY_AUD | Compression MCP Access audience設定 | semantic-compression-mcp Worker vars |
| JEV_AUDIT_MCP_POLICY_AUD | Jev Audit MCP Access audience release input | jev-audit-mcp Worker varへ変換 |
| CF_ACCESS_CLIENT_ID | Compression MCP release smoke用Service Token ID | operatorのローカルsecret file |
| CF_ACCESS_CLIENT_SECRET | Compression MCP release smoke用Service Token secret | operatorのローカルsecret file |
| JEV_AUDIT_SMOKE_TOKEN | Jev Audit REST release smoke | operatorのローカルsecret file |
| JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE | Jev Audit MCP release smoke | operatorのローカルsecret file |

`TYPESAFE_API_KEY`はGatewayやMCP Workerへ設定しない。秘密値、Authorization、Access credential、本文、source/diff、compressed_text全文、System Prompt全文、raw provider responseは本番log・release metadata・repositoryへ記録しない。
custom structured logはrequest ID、route、status、elapsed、safe counts、profile/version、safe error categoryに限定する。

## 10. Production release

Production authorityは `npm run deploy:production` だけである。
main pushだけではProduction deployしない。個別Workerの手動deployやCloudflare Git auto-deployを通常releaseの代替にしない。

Jev Audit featureを含むreleaseでは、Jev Audit production wrapperがclean source gateを確認したうえでJev private/MCPを準備し、既存core production releaseを起動し、その後REST/MCP live smokeを実行する。既存Text/Compression/MCP/Gatewayのrelease順序・rollback責務は維持する。

直接環境変数を使う場合、既存Compression release入力に加えてJev Audit用に次が必要となる。

~~~powershell
$env:JEV_AUDIT_MCP_POLICY_AUD = "<jev-audit MCP Access audience tag>"
$env:JEV_AUDIT_SMOKE_TOKEN = "<jev-audit REST caller token>"
$env:JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE = "<jev-audit MCP smoke Access cookie>"
~~~

`TYPESAFE_API_KEY`はrelease child environmentへコピーせず、Cloudflare private jev-audit Worker Secretとしてoperatorが事前設定する。Gateway側には`JEV_AUDIT_API_TOKEN` Secretを事前設定する。

release metadataはdocs/releases/へ保存され、gitRevision、各Worker Version、smoke、recoveryを追跡する。失敗時にProductionを成功扱いせず、保存済みVersionへrollbackする。

### 10.1 Production secret mapper

毎回の環境変数入力を避ける場合、Production用operator値を次のrepository外固定ファイルへ保存し、mapper経由で既存gateへ渡せる。

~~~text
%USERPROFILE%\\.kinotch-secrets\\kinotch-api.production.env
~~~

mapperが受け付けるkeyは次の9つだけで、未知keyや必須key不足は停止する。

~~~text
TEAM_DOMAIN=<team-domain>
POLICY_AUD=<compression-mcp-audience-tag>
MCP_ENDPOINT=https://semantic-compression-mcp.kinotch.workers.dev/mcp
CF_ACCESS_CLIENT_ID=<compression-release-smoke-service-token-client-id>
CF_ACCESS_CLIENT_SECRET=<compression-release-smoke-service-token-client-secret>
COMPRESSION_SMOKE_TOKEN=<compression-caller-token>
JEV_AUDIT_MCP_POLICY_AUD=<jev-audit-mcp-audience-tag>
JEV_AUDIT_SMOKE_TOKEN=<jev-audit-rest-caller-token>
JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE=<jev-audit-mcp-access-cookie>
~~~

Compression MCP確認は:

~~~powershell
npm run smoke:mcp:local
~~~

Production releaseは:

~~~powershell
npm run release:local
~~~

`release:local` はsecret injection用launcherであり、正式なProduction release authorityは引き続き `npm run deploy:production` である。mapperは値、file本文、`process.env`全体を出力せず、実際のdeploy・smoke・rollback・metadata処理はrelease scriptへ委譲する。
Cloudflare deploy credentialはこの9key fileへ含めず、既存のoperator-managed認証を使用する。secret directoryはagentからopaque boundaryとして扱い、agentが直接開いたり内容を要求したりしない。

## 11. 変更時の確認

実装・文書変更後の最低確認:

~~~powershell
npm test
git diff --check
~~~

Production release前には対象Workerのdry-runと、main / origin/main一致、GitHub Actions test・Verify、Cloudflare Accessとcredentialの外部設定を別々に確認する。
実Gemini live test、TypeSafe live E2E、MCP OAuth、Production deployは明示的なoperator条件を満たさず通常testから自動実行しない。

## 12. Source of truth

- Compression API contract: docs/specs/semantic-compression-api.md
- Compression operations: docs/semantic-compression.md
- Compression MCP contract: docs/specs/semantic-compression-mcp.md
- Compression MCP operations: docs/semantic-compression-mcp.md
- Jev Audit Remote API / MCP / operations: docs/jev-audit.md
- Gateway/Text operations: docs/OPERATIONS.md
- Development history: docs/DEVELOPMENT_HISTORY.md
- Release evidence: docs/releases/*.json
- Prompt: src/semantic-compression/prompt.js
- Compression profile/model/limits: src/semantic-compression/contract.js
- Prompt token metadata: src/semantic-compression/prompt-metadata.js
- Jev Audit remote contract/limits/profiles: src/jev-audit/contract.js
