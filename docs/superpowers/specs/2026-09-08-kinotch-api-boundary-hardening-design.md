# kinotch-api 責務境界ハードニング設計

## Goal

`kinotch-api`のGateway／Internal Worker／Client／Release境界に残る明確な不整合を解消し、既存の基盤を完成扱いにできる状態へ固定する。

## Scope

対象は次の5点に限定する。

1. Gateway CORSでclientが必要なresponse headerを参照できるようにする。
2. Text Workerのruntime `sourceRevision`をrelease commit SHAへ一致させる。
3. Text Workerのprivate設定をdeploy前に検査する。
4. Text smoke失敗時に直前の正常Versionへrollbackし、結果をrelease metadataへ記録する。
5. 共通clientにoverall deadlineを導入し、Retry-After待機がdeadlineを超えないようにする。

独自DDoS対策、WAF、API key、quota/accounting、CoreへのHTTP concern、歌詞Reader、historical-kanaは対象外とする。

## Architecture

```text
Client
  └─ overall deadline / retry / Retry-After / fallback
       ↓
Public Gateway
  └─ CORS expose headers / request guard / request ID
       ↓ Service Binding
Private Text Worker
  └─ runtime sourceRevision / domain metadata
       ↓
Release gate
  └─ private assert → Text deploy → smoke → Gateway deploy → smoke
                         └─ failure → rollback previous Text Version
```

`sourceRevision`はtracked generated fileへ固定値を書き込まず、release時にWranglerの`--var`でruntimeへ注入する。これにより、生成物のstale判定を壊さず、release metadataのGit SHAとAPIレスポンスを一致させる。

## Contracts

### CORS

Gatewayは次を`Access-Control-Expose-Headers`へ公開する。

```text
X-Request-ID
Retry-After
RateLimit-Limit
RateLimit-Policy
ETag
```

POST preflightでは`Content-Type`と`X-Request-ID`を許可する。429 responseでも`Retry-After`とrate-limit headersがcross-origin clientから参照可能であることをcontract testで固定する。

### sourceRevision

release gate開始時に`git rev-parse HEAD`から40文字のlowercase SHA-256形式値を取得する。Text Worker deployとsmokeへ同じ値を渡し、production capabilitiesの`sourceRevision`およびrelease metadataの`gitRevision`と一致させる。通常のlocal testでは従来どおり`unknown`を許容する。

### private assertion

`wrangler.text-transform.jsonc`の解析結果が次を満たさない場合、dry-runを含むdeploy処理を開始しない。

```text
workers_dev === false
preview_urls === false
routes / route / domains が未設定
```

### rollback

Text deploy前に`wrangler deployments status --name text-transform --json`から100% active Version IDを取得する。Text smokeが失敗した場合、Gateway deployへ進まず、`wrangler rollback <previousVersionId> --name text-transform --message ...`を実行する。rollback成功・失敗と対象Versionをfailure release metadataへ記録する。

### client deadline

`createTextTransformClient`に`totalDeadlineMs`を追加し、既定値は既存のinteractive timeoutと同じ8,000msとする。各attemptのtimeoutとretry sleepは残りdeadlineでclipする。Retry-Afterが残り時間を超える場合は待機せず、`deadline_exceeded`としてfallbackまたはthrowする。background clientは明示的に大きい`totalDeadlineMs`を指定できる。

## Verification

- CORS preflight、exposed headers、429 header visibilityのcontract test
- `sourceRevision`のruntime／release metadata一致test
- private configのvalid／invalid test
- rollback command parsingとrollback成功／失敗のdry scenario test
- client overall deadline、Retry-After超過、既存5xx backoff、fallbackのtest
- `npm test`、snapshot checks、Wrangler dry-run
- production release gateでText先行、反映待ちsmoke、Gateway、最終smokeを実行
- productionで直Text URL非到達、batch 200、invalid input 400、body 413、request ID、sourceRevisionを確認

## Completion boundary

上記検証が通過した時点でGateway／Core／Release基盤をfreeze扱いにする。外部repositoryのclient移行、実拡張機能のfallback率、歌詞Reader、historical-kanaは別作業として残す。
