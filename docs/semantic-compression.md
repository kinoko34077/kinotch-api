# Semantic Compression API 運用仕様

## 目的と責務

`POST /v1/compress` は、入力本文を `compact-v1` または `semantic-dense-v1` の固定仕様で圧縮する専用APIである。任意prompt、system instruction、model、provider、chat、agent、tools、Search、会話履歴は受け付けない。

経路は `Gateway → COMPRESSION Service Binding → semantic-compression Worker → Gemini Interactions API` に固定する。Compression Workerは独立し、Worker直URLは公開しない。

## API契約

Gatewayへの呼び出しには `Authorization: Bearer <operator-provided caller token>` が必要である。request bodyの許可フィールドは `text` と `profile` のみで、`profile` は `compact-v1` または `semantic-dense-v1` のいずれかである。

```json
{
  "text": "圧縮対象本文",
  "profile": "compact-v1"
}
```

`semantic-dense-v1` を選ぶ場合は、profile値だけを `semantic-dense-v1` にする。

成功レスポンスのfield名は変更しない。

```json
{
  "compressed_text": "要点\n- 圧縮本文",
  "profile": "compact-v1",
  "prompt_version": "compact-v1",
  "model": "gemini-3.5-flash-lite",
  "input_chars": 0,
  "output_chars": 0,
  "input_sha256": "64文字の小文字hex",
  "output_sha256": "64文字の小文字hex",
  "usage": {
    "input_tokens": 4321,
    "output_tokens": 987,
    "thought_tokens": 0,
    "cached_tokens": 0,
    "total_tokens": 5308
  },
  "warnings": []
}
```

`usage` はProvider responseの `total_input_tokens`、`total_output_tokens`、`total_thought_tokens`、`total_cached_tokens`、`total_tokens` を正規化した値である。`input_tokens` は本文だけでなくsystem instruction等を含むProvider側のinput usageで、報告されない値は `null` になる。`semantic-dense-v1` の成功responseは `profile` と `prompt_version` がともに `semantic-dense-v1` になる。

`input_chars` と `output_chars` はJavaScript UTF-16 code unit数ではなくUnicode code point数で、Python `len(str)` と一致する。SHA-256はUTF-8化したtextそのものを対象とする。圧縮結果を原文のSSOTとして保存しない。

主な正規化errorは `invalid_json`、`invalid_body`、`invalid_profile`、`empty_text`、`payload_too_large`、`provider_context_limit`、`authentication_failed`、`authentication_unavailable`、`rate_limited`、`provider_rate_limited`、`provider_invalid_response`、`provider_error`、`provider_timeout` である。Googleのraw error bodyは返さない。

## 固定ProviderとPrompt

ProviderはGoogle Gemini、modelは `gemini-3.5-flash-lite` 固定である。1 requestにつき1 stateless Interactionsを使用し、内部設定として `generation_config.thinking_level: "minimal"` を固定する。`store:false`、toolsなし、Searchなし、previous interactionなし、backgroundなしとする。`temperature`、`top_p`、`top_k`、`thinking_budget` は指定しない。thinking設定は公開APIへ追加しない。

Prompt正本とprofile mappingは `src/semantic-compression/prompt.js` に置く。`compact-v1` は固定System Prompt 1、`semantic-dense-v1` は指定されたSystem Prompt 2全文を、そのままGeminiの `system_instruction` へ送る。どちらもService boundaryやCandidate規則を前後へ追加しない。入力本文の圧縮だけを行い、callerからprompt内容を変更できない。Candidate promptは内部評価用で、公開profileやProduction Workerのmappingには含めない。

## Secret、認証、制限

秘密値はファイル、`vars`、test fixture、release metadata、README例、response、logsへ書かない。operatorが対話入力で登録する。

```powershell
wrangler secret put GEMINI_API_KEY --config wrangler.semantic-compression.jsonc
wrangler secret put COMPRESSION_API_TOKEN --config wrangler.jsonc
```

`GEMINI_API_KEY` はCompression Workerだけが使うProvider credentialであり、`COMPRESSION_API_TOKEN` はGateway caller credentialである。同じ値を使わない。未設定のcaller secretはfail closedで503、欠落・不正tokenは401とする。tokenはSHA-256 fingerprintの固定長比較を行い、ログや下流Workerへ転送しない。

- 本文の上限: 1,000,000 Unicode code points
- Provider context安全上限: 200,000 Unicode code points（超過時は外部Providerへ送らず `provider_context_limit` で413）
- Gateway body limit: 8 MiB（byte limitと文字数limitを混同しない）
- Compression専用rate limit: 5 requests / 60 seconds / client IP
- Worker timeout: 45 seconds
- Gateway upstream timeout: 50 seconds
- Provider retry: 初期版は自動retryなし

1,000,000 code pointsは公開APIの構造上限であり、Geminiのtoken上限を保証する値ではない。code point数とtoken数は一致せず、system instruction分もcontextを消費するため、初期版は200,000 code pointsを保守的な事前上限とする。tokenizerによる厳密な `countTokens` 外部呼出は追加せず、入力超過をProvider側の502へ変換しない。

## Live testとsmoke

通常の `npm test` と `npm run test:compression:live` の実行だけではGeminiへ接続しない。live testは次の2条件をoperatorが明示した場合だけ有効になる。

```powershell
$env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<operator-provided Gemini key>"
$env:RUN_GEMINI_LIVE_TEST = "true"
# 任意: profile間隔。既定15秒、1秒未満にはできない。
$env:COMPRESSION_LIVE_INTERVAL_MS = "15000"
npm run test:compression:live
Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY
Remove-Item Env:RUN_GEMINI_LIVE_TEST
Remove-Item Env:COMPRESSION_LIVE_INTERVAL_MS
```

`KINOTCH_COMPRESSION_GEMINI_API_KEY` はkinotch-apiのローカルlive test専用である。`GEMINI_API_KEY` はsemantic-compression Cloudflare WorkerのSecret binding専用であり、ローカルlive testの入力credentialとしては参照しない。`RUN_GEMINI_LIVE_TEST=true` を指定して専用credentialが未設定の場合、live testはskipせずfail-fastする。

live testでProviderがHTTPエラーを返した場合だけ、`upstreamStatus`、Providerのstatusまたはcode、取得できたreason、raw本文を含まないsafe messageを診断値として表示する。本番の `/v1/compress` responseとproduction logは従来どおりsafe errorだけとし、Googleのraw error、header、credential、本文、Promptを公開しない。

本番release smokeはGateway経由で両profileを確認するため、Worker secretとは別に、operatorが一時的な `COMPRESSION_SMOKE_TOKEN` を環境変数へ設定する。

```powershell
$env:COMPRESSION_SMOKE_TOKEN = "<operator-provided caller token>"
npm run deploy:production
```

`COMPRESSION_SMOKE_TOKEN` がない場合、release gateはWorker deploy前に停止する。`GEMINI_API_KEY` が本番Workerへ登録されていない場合はCompression smokeが失敗し、成功releaseとして記録せずrollbackへ進む。smokeでは両profileのstatus、duration、counts、model、prompt version、hashes、usage数値だけを検証し、本文全文を表示しない。

## 実モデル品質評価

`test/fixtures/semantic-compression-quality.json` に、private本文とsecretを含まないsynthetic 50件の評価corpusを置く。実モデルのbaselineを取得する場合だけ、外部通信・課金の可能性を理解した上で、専用環境変数と明示flagを同時に設定して実行する。

```powershell
$env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<operator-provided Gemini key>"
$env:RUN_COMPRESSION_QUALITY_EVAL = "true"
$env:COMPRESSION_QUALITY_OUTPUT = ".\artifacts\compression-quality-baseline.json"
# 任意: 既定15秒。短縮する場合も1秒未満にはできない。
$env:COMPRESSION_QUALITY_INTERVAL_MS = "15000"
npm run evaluate:compression
Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY
Remove-Item Env:RUN_COMPRESSION_QUALITY_EVAL
Remove-Item Env:COMPRESSION_QUALITY_OUTPUT
Remove-Item Env:COMPRESSION_QUALITY_INTERVAL_MS
```

`COMPRESSION_QUALITY_OUTPUT` を指定した場合だけ、synthetic入力、実際の圧縮結果、機械的marker確認を人手レビュー用JSONへ保存する。通常の `npm test` はこのscriptを呼ばず、外部Geminiへ接続しない。出力は内部評価用baselineであり、因果・否定範囲・不確実性・事実／推測境界を自動判定せず、合格thresholdも定義しない。品質CorpusとCandidate比較はProduction releaseの前提条件ではない。

既存の50件は意味保存のControl評価で、長文の圧縮効率は `test/fixtures/semantic-compression-long.json` の10件を別に指定して測定する。内部CandidateをControlと比較する場合だけ、`COMPRESSION_QUALITY_PROMPT_VARIANT=candidate` を追加する。Candidateの評価versionは `semantic-dense-v2-candidate` だが、公開profile、公開 `prompt_version`、model、Production WorkerのPromptは変更しない。Candidateの品質結果は実測資料として扱い、今回のProduction releaseをblockしない。

既存artifactの再送なしに比率・marker欠落・category別分布を集計するには、次を実行する。出力はローカル `artifacts/` のレビュー資料であり、本文を本番ログへ追加しない。

```powershell
$env:COMPRESSION_QUALITY_INPUT = ".\\artifacts\\compression-quality-baseline.json"
$env:COMPRESSION_QUALITY_REVIEW_OUTPUT = ".\\artifacts\\compression-quality-review.json"
node scripts/analyze-compression-baseline.mjs
Remove-Item Env:COMPRESSION_QUALITY_INPUT
Remove-Item Env:COMPRESSION_QUALITY_REVIEW_OUTPUT
```

Geminiのrate limitはproject/model/tierごとに異なり、RPM・input TPM・RPD等で管理されるため、固定の許容値として扱わない。評価scriptは既定15秒（約4 request/minute）の間隔を入れ、429発生時は自動再送せず停止する。レスポンスに安全な数値形式の `Retry-After` がある場合だけ、待機目安をエラーへ表示する。間隔は `COMPRESSION_QUALITY_INTERVAL_MS` で調整できるが、quotaを保証する値ではない。

## Token usage

Interactions API responseのusageはProduction responseへ安全な数値として含める。`system-only` は共通prefixを持たない短いsynthetic文4件、`shared-input-prefix` は長い共通prefixを持つsynthetic文4件を送るopt-in測定も利用できる。`input_tokens` はsystem instruction等を含むProvider側usageであり、本文長の `input_chars` とは別の値である。

```powershell
$env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<operator-provided Gemini key>"
$env:RUN_COMPRESSION_USAGE_MEASURE = "true"
# 任意: Controlが既定。Candidate Promptの内部比較時だけ指定する。
$env:COMPRESSION_USAGE_PROMPT_VARIANT = "candidate"
# 任意: 安全な数値だけのusage artifactを保存する。
$env:COMPRESSION_USAGE_OUTPUT = ".\\artifacts\\compression-usage-candidate.json"
# 任意: 既定15秒。短縮する場合も1秒未満にはできない。
$env:COMPRESSION_USAGE_INTERVAL_MS = "15000"
npm run measure:compression:usage
Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY
Remove-Item Env:RUN_COMPRESSION_USAGE_MEASURE
Remove-Item Env:COMPRESSION_USAGE_PROMPT_VARIANT
Remove-Item Env:COMPRESSION_USAGE_OUTPUT
Remove-Item Env:COMPRESSION_USAGE_INTERVAL_MS
```

出力するのはscenario、request数、status、文字数、model、request間隔、`inputTokens`、`outputTokens`、`thoughtTokens`、`cachedTokens`、`totalTokens`だけで、本文・圧縮結果・Prompt・secret・raw provider responseは含めない。Production responseでは同じ値をsnake_caseで返す。`cachedTokens` が0またはnullでも失敗とは扱わず、観測値として記録する。stateless Interactions、`store:false`、Explicit Context Cacheなし、`generateContent`移行なしを維持し、cache効果のthresholdは定義しない。

usage測定も同じ既定15秒間隔でrequestを送る。429発生時は自動再送しない。rate limitの詳細は [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)、usage fieldの定義は [Interactions API](https://ai.google.dev/api/interactions-api)、implicit cachingの観測条件は [Context caching](https://ai.google.dev/gemini-api/docs/caching) を参照する。

## Deployとrollback

`npm run deploy:production` は、generated checks → tests → Text Worker dry-run → Compression Worker dry-run → Gateway dry-run → 直前100% active version capture → Text deploy → Text smoke → Compression deploy → Gateway deploy → 非課金のCompression Gateway readiness確認（反映待ち時のみ再試行）→ Gateway経由でcompact-v1とsemantic-dense-v1を各1回smoke → Compressionを再実行しない完全Gateway smoke → release metadata の順に実行する。

Compression smokeは新しいGateway Service Binding経路を実際に検証する必要があるため、Compression Worker deploy直後ではなくGateway deploy後に実行する。反映待ちのGET readiness確認は再試行するが、Provider受理不明の通信失敗やGemini生成自体は無条件再送しない。production smokeのdirect checkでは `https://semantic-compression.kinotch.workers.dev/health` も確認し、HTTP 200で直接到達できる場合は失敗とする。

smoke失敗時のrollback対象は `Gateway → Compression → Text` の順である。release metadataには `compressionVersionId`、`previousCompressionVersionId`、`compressionSmoke`、`compressionRecovery`、`compressionModel`、`compressionPromptVersion` を含める。既存Text/Gatewayのmetadataとrollback契約は削除しない。

## Privacy

入力text、`compressed_text`、Authorization token、Gemini key、system prompt全文、Gemini raw response全文を本文ログへ残さない。構造化ログで許可するのはrequest ID、route、status、elapsed time、input/output chars、圧縮率、model、prompt version、rate-limit結果、safe error categoryだけである。input/output hashは通常ログへ出さない。
