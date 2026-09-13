# Text API 運用確認手順

## Production deploy authority

Production deploy authority is only `npm run deploy:production`。このscriptが、generated checks、tests、両Workerのdry-run、直前Versionの取得、Text Worker → Compression Worker → Gatewayのdeploy、反映待ちを含むsmoke、release metadata、失敗時rollbackを一つのrelease gateとして管理する。

- `main`へのpushはGitHub Actionsのrequired status check `test`だけを起動し、Production deployを直接起動しない。
- Cloudflare Workers Builds / Git integrationによるProduction auto-deployは無効化する。`api`のGit連携を再接続せず、Cloudflare側の単独deployと手動release gateを二重化しない。
- GitHub `main`はrequired check `test`を必須とし、force pushとbranch deletionを禁止する。Pull request必須化は初期要件に含めない。
- GitHub branch protectionとCloudflare Workers Buildsの接続状態はoperatorがDashboardで管理・確認する。repo内の文書だけで外部設定済みとは扱わない。

## 本番の基本確認

対象はGateway `https://api.kinotch.workers.dev`。本文そのものはログへ保存せず、ステータス、件数、profile、engineVersion、ruleSetHash、処理時間だけを確認する。

1. `GET /health` がHTTP 200であること。
2. `GET /v1/capabilities` の`engineVersion`、`ruleSetHash`、profile一覧、制限値を確認する。
3. Origin付き`OPTIONS /v1/transform` がHTTP 204で、`Access-Control-Allow-Methods`にPOSTを含み、
   `Content-Type`と`X-Request-ID`が許可されること。
4. Origin付き`POST /v1/transform/batch` がHTTP 200で、入力件数と出力件数が一致すること。
5. 存在しないprofileがHTTP 400 `invalid_profile`になること。
6. `X-Request-ID`がレスポンスにあり、指定したIDは下流にも引き継がれること。
7. `/v1/capabilities`に`metadataVersion`、`ruleSetVersion`、`snapshotHash`、
   `dictionaryVersion`、`dictionaryHash`があること。

## Semantic Compression API

`POST /v1/compress` の契約、`compact-v1` / `semantic-dense-v1` の固定prompt、
`gemini-3.5-flash-lite`、公開usage、`GEMINI_API_KEY`／`COMPRESSION_API_TOKEN` のsecret登録、
`COMPRESSION_SMOKE_TOKEN` を使うlive smoke、8 MiB body limit、5 requests/60 secondsの
専用rate limit、本文をログへ残さない方針、synthetic 50件のopt-in品質baseline評価、deployとGateway → Compression → Textのrollbackは
[`docs/semantic-compression.md`](semantic-compression.md) を正本とする。

品質baselineは `RUN_COMPRESSION_QUALITY_EVAL=true` と
`KINOTCH_COMPRESSION_GEMINI_API_KEY` の両方を必要とし、通常の `npm test` やProduction
smokeから自動実行しない。人手レビュー用出力を保存する場合もsynthetic corpusだけを使い、
本文・Prompt・secret・raw provider responseをログや本番metadataへ残さない。

Production responseのusageはProviderのinput/output/thought/cached/total tokenをsnake_caseで返す。
追加のToken usage実測は `RUN_COMPRESSION_USAGE_MEASURE=true` と
`KINOTCH_COMPRESSION_GEMINI_API_KEY` の両方を必要とする別のopt-in scriptで行う。
共通prefixなしの `system-only` 4件と、共通prefixありの `shared-input-prefix` 4件について、
scenario別にinput/output/thought/cached/total tokenの数値だけを出力する。Implicit Cachingの効果は観測値として扱い、Explicit Context Cache、
`generateContent`、未合意のthresholdは導入しない。

外部Geminiのrate limitはproject/model/tier依存でRPM・input TPM・RPD等により変動するため、測定scriptは既定15秒間隔（約4 request/minute）で送信する。品質評価は `COMPRESSION_QUALITY_INTERVAL_MS`、usage測定は `COMPRESSION_USAGE_INTERVAL_MS` で調整できる。いずれも1秒未満は許可せず、429時の自動再送は行わない。安全な数値形式の `Retry-After` が応答にある場合だけ、測定停止時のエラーへ秒数を表示する。

## 遅延の見方

- 初回のTokenizer利用リクエストは辞書初期化のため遅くなる。現在の目安は約1.8〜3.3秒。
- 同一Workerが暖機された後は、短いbatchで約20〜65ms、長文では入力サイズに応じて増加する。
- クライアント側の最大待機時間は8秒。timeout、5xx、一時通信失敗、レスポンス不整合、ruleSetHash不一致はlocal fallbackへ切り替える。
- API側だけではlocal fallback発生率は測れない。実クライアントのdebug／運用計測で別途確認する。

## Gatewayの関門

`src/policies/routes.js`が各公開routeのmethod、body byte limit、rate limit、query／JSON
validationを定義する。新しい公開routeは`registerRoute()`経由でPolicyを必須化する。

- `transform`／`ruby/parse`: 512 KiB、30 requests/60 seconds/IP
- `transform/batch`: 1 MiB、30 requests/60 seconds/IP
- その他の公開route: 60 requests/60 seconds/IP
- 制限超過はGatewayでHTTP 429、`Retry-After`、`RateLimit-*`を返す。
- Rate Limit bindingが欠落・障害の場合はfail-closedでHTTP 503とし、下流へ転送しない。
- `Content-Length`がない、または過少申告された場合もstream実測で上限超過をHTTP 413にする。
- 本文の文字数・profileの意味検証は下流Text Workerにも残し、Gatewayのbyte制限と二重化する。
- `text-transform`のworkers.dev URLは無効化し、GatewayのService Bindingだけを公開経路とする。
- 下流Service Bindingの例外は502、下流503は503、上流応答の500は502、タイムアウトは504へ分類する。
- ブラウザからは`X-Request-ID`、`Retry-After`、`RateLimit-Limit`、`RateLimit-Policy`、
  `ETag`をレスポンスヘッダーとして参照できる。429時の`Retry-After`とレート制限値も同様に確認する。

Cloudflare Rate Limitingは厳密な会計用途ではなく、公開・未認証APIの過剰利用を抑える
境界として扱う。認証や利用量課金を導入する場合は、IP単位のkeyを利用者ID／API key単位へ
置き換える。

## snapshot互換性

`src/text-core`が正本で、次の情報を生成物とText Workerのレスポンスへ載せる。

- `ruleSetVersion`／`ruleSetHash`: rule dataの契約
- `metadataVersion`／`snapshotHash`: engine、shared parser、dictionary、Kuromoji、rulesを
  含むfallback runtime全体の契約
- `dictionaryVersion`／`dictionaryHash`: Worker Assets辞書の契約
- `sourceRevision`: release metadataで追跡するsource revision。productionではdeploy対象Git SHAと一致し、
  ローカル生成時は`unknown`。

`rules.generated.mjs`と`metadata.generated.mjs`は手編集せず、`npm run build:text-snapshot`
で再生成する。`npm test`は両方のcheckを先に実行する。

## Cloudflareログ

`wrangler.jsonc` と `wrangler.text-transform.jsonc` はObservabilityを有効化済み。tailを使う場合も本文・request body・response bodyを出力せず、ステータス、パス、処理時間、エラー種別だけを対象にする。

```sh
npx wrangler tail api --format json
npx wrangler tail text-transform --format json
```

## リリース後の確認

`npm run deploy:production`を使い、clean worktree検査 → build後のgenerated差分検査 → check／test／dry-run →
Text Worker → 境界smoke → Gateway → 全smokeの順で実行する。成功時は両WorkerのVersion ID、commit、engine／rule／snapshot
metadata、JST時刻を`docs/releases/`へ記録する。個別Workerの手動deployやCloudflare Git連携による自動deployは正式経路としない。

productionのText Worker capabilitiesに返る`sourceRevision`はrelease metadataの`gitRevision`と
一致しなければならない。release gateは同じ40文字SHAをWranglerのruntime variableとしてText
Workerへ渡し、smokeで不一致を検出した場合はGatewayをdeployしない。
Service Bindingの反映には時間差があるため、release gateはText／Gateway smokeを最大12回、
5秒間隔で再確認する。source revision不一致が解消しない場合は失敗として扱う。

Text Workerはdeploy前に`wrangler deployments status --name text-transform --json`で100% active
Versionを保存する。Gatewayもdeploy前に100% active Versionを保存する。いずれかのsmokeが最後まで
通らない場合、release gateは保存した両Worker Versionへ自動rollbackし、`status: "failed"`、失敗stage、対象Version、rollback結果を
`docs/releases/`へ記録する。rollback自体も失敗した場合は`textRecovery.status`が
`rollback_failed`または`gatewayRecovery.status`が`rollback_failed`になるため、Cloudflare dashboardの
Deploymentsから保存済みVersionを手動で再度activeにする。

rollbackのdry scenarioは`test/release-recovery.test.js`で、100% active Versionの抽出、引数生成、
成功・失敗をCloudflareへ変更を加えず検証する。productionで意図的にsmokeを壊す試験は行わない。

境界smokeでは、Text Workerの直URLがHTTP 200にならないこと、Gateway経由のcapabilitiesが
正常であることに加え、時計が利用する`/v1/time`、`/v1/weather`、`/v1/calendar/rokuyo`、
`/v1/astronomy/moon`の正常系レスポンス形状を確認する。直URLが200なら、Gateway唯一入口の
条件を満たしていないため公開完了と扱わない。

## 拡張機能の再読み込み

Chromeの`chrome://extensions`を開き、対象の開発者モード拡張機能の「再読み込み」を押す。その後、対象ページを再読み込みして標準bundleのremote API経路と、custom ruleのlocal経路をそれぞれ確認する。
