# Text API 運用確認手順

## Production deploy authority

Production deploy authority is only `npm run deploy:production`。このscriptが、generated checks、tests、各Workerのdry-run、直前Versionの取得、Jev Audit release phaseと既存Text Worker → Compression Worker → MCP Worker → Gatewayのdeploy、反映待ちを含むsmoke、release metadata、失敗時rollbackを一つのrelease gateとして管理する。

- `main`へのpushはGitHub Actionsの`test`と`Verify`を起動し、Production deployを直接起動しない。
- Repository Baseの`Verify` workflowも`test`と同様に成功を維持する。現在のGitHub `main` protectionはrequired check `test`／`verify`、force push禁止、branch deletion禁止を設定済みとしてAPIで確認している。PR必須化、administrator enforcement、strict statusは今回変更していない。
- Production release開始時に`git fetch origin main`を実行し、現在branchが`main`かつlocal `HEAD == origin/main`であることを確認する。一致しない場合はdeployを開始しない。
- release gateの`npm ci`、build、check、testは明示的な安全環境allowlistだけを子processへ渡す。`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`、Compression smoke token、Jev Audit smoke credential、Gemini key、TypeSafe key、未知の将来secretは通常子processへ継承せず、WranglerへもCloudflare credentialだけを限定注入する。
- Cloudflare Workers Builds / Git integrationによるProduction auto-deployは無効化する。`api`のGit連携を再接続せず、Cloudflare側の単独deployと手動release gateを二重化しない。
- GitHub `main`はrequired check `test`／`verify`を必須とし、force pushとbranch deletionを禁止する。Pull request必須化は初期要件に含めない。
- GitHub branch protectionとCloudflare Workers Buildsの接続状態はoperatorがDashboardで管理・確認する。repo内の文書だけで外部設定済みとは扱わない。
- 通常のText Worker単独deploy scriptは提供しない。adminであっても、検証されていないcommitを`main`へ直接pushしない。
- `npm run smoke:production` は、明示した `API_BASE_URL`、`TEXT_DIRECT_URL`、`COMPRESSION_DIRECT_URL` をローカル診断用に使用できる。一方、`npm run deploy:production` のrelease smokeはこれらの環境変数を無視し、`https://api.kinotch.workers.dev`、`https://text-transform.kinotch.workers.dev`、`https://semantic-compression.kinotch.workers.dev`へ固定する。別endpointが正常でもrelease成功とは扱わない。
- Production operator値はrepository外の固定ファイル `%USERPROFILE%\\.kinotch-secrets\\kinotch-api.production.env` から `scripts/production-secret-mapper.mjs` 経由で供給できる。mapperの許可keyは`TEAM_DOMAIN`、`POLICY_AUD`、`MCP_ENDPOINT`、`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`、`COMPRESSION_SMOKE_TOKEN`、`JEV_AUDIT_MCP_POLICY_AUD`、`JEV_AUDIT_SMOKE_TOKEN`、`JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE`の9つだけで、未知key・必須key不足・固定path以外の指定はfail closedとする。
- `npm run smoke:mcp:local` は既存`npm run smoke:mcp`のlauncher、`npm run release:local` はJev Audit-aware production wrapperから正式release gateを起動するsecret injection用launcherである。正式なProduction authorityや既存release gateを分割・迂回しない。Compression MCP release smokeは専用Cloudflare Access Service Token、Jev Audit MCP smokeは専用Access cookie入力を使用し、Codex Managed OAuthの実利用確認とは別証拠として扱う。secret値、file本文、`process.env`全体は出力せず、agentはsecret directoryをopaque boundaryとして直接参照しない。

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
`COMPRESSION_SMOKE_TOKEN` を使うlive smoke、2.5 MiB body limit、5 requests/60 secondsの
専用rate limit（pre-auth IP、authenticated IP、authenticated token fingerprintの三段）、本文をログへ残さない方針、synthetic 50件のopt-in品質baseline評価、deployとGateway → Compression → MCP → Textのrollbackは
[`docs/semantic-compression.md`](semantic-compression.md) を正本とする。

Geminiの生成requestは安定版Interactions APIの`v1/interactions`を使用する。固定Promptのtoken測定に使う`countTokens`は、現行API referenceに合わせて`v1beta` endpointを使用する。この2つを混同せず、callerがendpointやmodelを変更できない固定構成を維持する。

`COMPRESSION_API_TOKEN` は256-bit以上の暗号学的にランダムな値（cryptographically random）を使い、人間が考えたpasswordや短いtokenを登録しない。`compressed_text` は untrusted display data であり、HTML表示時は sanitize し、raw HTMLとdangerous URL schemeを許可しない。

品質baselineは `RUN_COMPRESSION_QUALITY_EVAL=true` と
`KINOTCH_COMPRESSION_GEMINI_API_KEY` の両方を必要とし、通常の `npm test` やProduction
smokeから自動実行しない。人手レビュー用出力を保存する場合もsynthetic corpusだけを使い、
本文・Prompt・secret・raw provider responseをログや本番metadataへ残さない。

Production responseのusageはProviderのinput/output/thought/cached/total tokenに加え、固定Promptの`system_prompt_tokens`と残差`content_input_tokens`をsnake_caseで返す。`input_tokens`はProviderの総inputであり、本文だけのtoken数ではない。Prompt token数はprofileごとの事前測定metadataで、Production requestごとには`countTokens`を呼ばない。
追加のToken usage実測は `RUN_COMPRESSION_USAGE_MEASURE=true` と
`KINOTCH_COMPRESSION_GEMINI_API_KEY` の両方を必要とする別のopt-in scriptで行う。
共通prefixなしの `system-only` 4件と、共通prefixありの `shared-input-prefix` 4件について、
scenario別にinput/output/thought/cached/total tokenの数値だけを出力する。Implicit Cachingの効果は観測値として扱い、Explicit Context Cache、
`generateContent`、未合意のthresholdは導入しない。

外部Geminiのrate limitはproject/model/tier依存でRPM・input TPM・RPD等により変動するため、測定scriptは既定15秒間隔（約4 request/minute）で送信する。品質評価は `COMPRESSION_QUALITY_INTERVAL_MS`、usage測定は `COMPRESSION_USAGE_INTERVAL_MS` で調整できる。いずれも1秒未満は許可せず、429時の自動再送は行わない。安全な数値形式の `Retry-After` が応答にある場合だけ、測定停止時のエラーへ秒数を表示する。

Prompt token metadataの再測定はPromptまたはmodel変更時だけ行う。`RUN_COMPRESSION_PROMPT_TOKEN_MEASURE=true` と専用credentialを設定し、`npm run measure:compression:prompt-tokens` を実行する。現在値は`compact-v1: 540`、`semantic-dense-v1: 1823`で、対応Prompt SHA-256とともにtestでstale検出する。

## Jev Audit Remote

Jev Audit Remoteの利用・secret・公開境界・現行verification stateは[`docs/jev-audit.md`](jev-audit.md)を正本とする。

- RESTは `POST /v1/audit`。Gateway Secret `JEV_AUDIT_API_TOKEN` でcallerを認証し、認証値をprivate Workerへforwardしない。
- private `jev-audit` Workerだけが `TYPESAFE_API_KEY` Secretを所有する。Gatewayや`jev-audit-mcp`へTypeSafe credentialを設定しない。
- Remote MCPは `https://jev-audit-mcp.kinotch.workers.dev/mcp` で、`TEAM_DOMAIN`とJev専用audienceを使う。production release input名は `JEV_AUDIT_MCP_POLICY_AUD`。
- REST smoke inputは `JEV_AUDIT_SMOKE_TOKEN`、MCP smoke inputは `JEV_AUDIT_MCP_SMOKE_ACCESS_COOKIE`。いずれもrepository、release metadata、通常ログへ値を残さない。
- Remote v1はexplicit file snapshotsだけを監査し、local filesystem/Git/`changed_only`を扱わない。
- source/diff本文、Authorization、Access credential、TypeSafe key、raw provider responseを通常ログへ記録しない。
- 実装・自動test・release/smoke wiringは完了しているが、live TypeSafe REST E2E、Production deploy、authenticated MCP tool-call E2Eは実行成功までpendingとして扱う。

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

`wrangler.jsonc`、`wrangler.text-transform.jsonc`、`wrangler.semantic-compression.jsonc`、`wrangler.jev-audit.jsonc`、`wrangler.jev-audit-mcp.jsonc`はObservabilityのcustom logsを有効化し、automatic Invocation Logsを必要な境界で無効化する。CloudflareのInvocation LogsはRequest/Response関連metadataとheadersを自動収集し得るため、本文を扱うWorkerとAuthorizationを受けるGatewayではprivate dataを自動収集しない設定を維持する。custom logsでも本文、source/diff、request body、response body、Authorization、secretを出力せず、ステータス、パス、処理時間、エラー種別だけを対象にする。

```sh
npx wrangler tail api --format json
npx wrangler tail text-transform --format json
```

## リリース後の確認

`npm run deploy:production`を正式authorityとして使い、Jev Audit wrapperのsource gate → Jev private/MCP準備・deploy → 既存core clean worktree検査 → build後のgenerated差分検査 → check／test／dry-run → Text Worker → Compression Worker → MCP Worker → Compression MCP Service Token smoke → Gateway → readiness／境界smoke → Jev Audit REST/MCP smoke → 全smokeの順で検証する。成功時は各WorkerのVersion ID、commit、engine／rule／snapshot metadata、JST時刻を`docs/releases/`へ記録する。個別Workerの手動deployやCloudflare Git連携による自動deployは正式経路としない。

productionのText Worker capabilitiesに返る`sourceRevision`はrelease metadataの`gitRevision`と
一致しなければならない。release gateは同じ40文字SHAをWranglerのruntime variableとしてText
Workerへ渡し、smokeで不一致を検出した場合はGatewayをdeployしない。
Service Bindingの反映には時間差があるため、release gateはText／Gateway smokeを最大12回、
5秒間隔で再確認する。source revision不一致が解消しない場合は失敗として扱う。

Text Worker、Compression Worker、Compression MCP Worker、Jev Audit private Worker、Jev Audit MCP Worker、Gatewayはdeploy前にactive Versionを保存する。deploy commandが通信断等で曖昧に失敗した場合はremote active Versionを再取得し、直前Versionから変化していればdeploy済みとしてrollback対象に含める。いずれかのsmokeが最後まで通らない場合、release gateは保存したVersionへ自動rollbackし、rollback後にactive Versionと非課金recovery smokeを確認して記録する。確認できない場合やrollback自体が失敗した場合は`rollback_failed`として`docs/releases/`へ残し、Cloudflare dashboardのDeploymentsから保存済みVersionを手動で再度activeにする。

rollbackのdry scenarioは`test/release-recovery.test.js`等で、100% active Versionの抽出、引数生成、成功・失敗をCloudflareへ変更を加えず検証する。productionで意図的にsmokeを壊す試験は行わない。

境界smokeでは、Text Workerの直URLがHTTP 200にならないこと、Gateway経由のcapabilitiesが正常であることに加え、時計が利用する`/v1/time`、`/v1/weather`、`/v1/calendar/rokuyo`、`/v1/astronomy/moon`の正常系レスポンス形状を確認する。Jev Auditではprivate Workerをpublic化せず、Gateway `/v1/audit`とAccess保護されたMCP endpointだけを公開面とする。直URLが公開されるなどprivate Worker境界を満たしていない場合は公開完了と扱わない。

## 拡張機能の再読み込み

Chromeの`chrome://extensions`を開き、対象の開発者モード拡張機能の「再読み込み」を押す。その後、対象ページを再読み込みして標準bundleのremote API経路と、custom ruleのlocal経路をそれぞれ確認する。