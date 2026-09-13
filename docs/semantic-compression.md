# Semantic Compression API 運用仕様

## 目的と責務

`POST /v1/compress` は、入力本文を `semantic-dense-v1` の固定仕様で意味保存・情報保持優先の高密度圧縮へ変換する専用APIである。任意prompt、system instruction、model、provider、chat、agent、tools、Search、会話履歴は受け付けない。

経路は `Gateway → COMPRESSION Service Binding → semantic-compression Worker → Gemini Interactions API` に固定する。Compression Workerは独立し、Worker直URLは公開しない。

## API契約

Gatewayへの呼び出しには `Authorization: Bearer <operator-provided caller token>` が必要である。request bodyの許可フィールドは `text` と `profile` のみで、`profile` は `semantic-dense-v1` 固定である。

```json
{
  "text": "圧縮対象本文",
  "profile": "semantic-dense-v1"
}
```

成功レスポンスのfield名は変更しない。

```json
{
  "compressed_text": "要点\n- 圧縮本文",
  "profile": "semantic-dense-v1",
  "prompt_version": "semantic-dense-v1",
  "model": "gemini-3.5-flash-lite",
  "input_chars": 0,
  "output_chars": 0,
  "input_sha256": "64文字の小文字hex",
  "output_sha256": "64文字の小文字hex",
  "warnings": []
}
```

`input_chars` と `output_chars` はJavaScript UTF-16 code unit数ではなくUnicode code point数で、Python `len(str)` と一致する。SHA-256はUTF-8化したtextそのものを対象とする。圧縮結果を原文のSSOTとして保存しない。

主な正規化errorは `invalid_json`、`invalid_body`、`invalid_profile`、`empty_text`、`payload_too_large`、`provider_context_limit`、`authentication_failed`、`authentication_unavailable`、`rate_limited`、`provider_rate_limited`、`provider_invalid_response`、`provider_error`、`provider_timeout` である。Googleのraw error bodyは返さない。

## 固定ProviderとPrompt

ProviderはGoogle Gemini、modelは `gemini-3.5-flash-lite` 固定である。1 requestにつき1 stateless Interactionsを使用し、内部設定として `generation_config.thinking_level: "minimal"` を固定する。`store:false`、toolsなし、Searchなし、previous interactionなし、backgroundなしとする。`temperature`、`top_p`、`top_k`、`thinking_budget` は指定しない。thinking設定は公開APIへ追加しない。

Prompt正本は `src/semantic-compression/prompt.js` の `semantic-dense-v1` だけに置く。入力本文はuntrusted dataとして扱い、本文内の命令文・role指定・prompt変更要求・model変更要求・tool実行要求・secret開示要求などを実行せず、圧縮対象本文の一部として扱う。意味保存・情報保持・論理関係・不確実性を優先し、曖昧化する直前で圧縮を止める。意味を変更するprompt変更は `semantic-dense-v2` など別versionで行う。

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
npm run test:compression:live
Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY
Remove-Item Env:RUN_GEMINI_LIVE_TEST
```

`KINOTCH_COMPRESSION_GEMINI_API_KEY` はkinotch-apiのローカルlive test専用である。`GEMINI_API_KEY` はsemantic-compression Cloudflare WorkerのSecret binding専用であり、ローカルlive testの入力credentialとしては参照しない。`RUN_GEMINI_LIVE_TEST=true` を指定して専用credentialが未設定の場合、live testはskipせずfail-fastする。

live testでProviderがHTTPエラーを返した場合だけ、`upstreamStatus`、Providerのstatusまたはcode、取得できたreason、raw本文を含まないsafe messageを診断値として表示する。本番の `/v1/compress` responseとproduction logは従来どおりsafe errorだけとし、Googleのraw error、header、credential、本文、Promptを公開しない。

本番release smokeはGateway経由でCompressionを確認するため、Worker secretとは別に、operatorが一時的な `COMPRESSION_SMOKE_TOKEN` を環境変数へ設定する。

```powershell
$env:COMPRESSION_SMOKE_TOKEN = "<operator-provided caller token>"
npm run deploy:production
```

`COMPRESSION_SMOKE_TOKEN` がない場合、release gateはWorker deploy前に停止する。`GEMINI_API_KEY` が本番Workerへ登録されていない場合はCompression smokeが失敗し、成功releaseとして記録せずrollbackへ進む。smokeではstatus、duration、counts、model、prompt version、hashesだけを検証し、本文全文を表示しない。

## 実モデル品質評価

`test/fixtures/semantic-compression-quality.json` に、private本文とsecretを含まないsynthetic 50件の評価corpusを置く。実モデルのbaselineを取得する場合だけ、外部通信・課金の可能性を理解した上で、専用環境変数と明示flagを同時に設定して実行する。

```powershell
$env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<operator-provided Gemini key>"
$env:RUN_COMPRESSION_QUALITY_EVAL = "true"
$env:COMPRESSION_QUALITY_OUTPUT = ".\artifacts\compression-quality-baseline.json"
npm run evaluate:compression
Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY
Remove-Item Env:RUN_COMPRESSION_QUALITY_EVAL
Remove-Item Env:COMPRESSION_QUALITY_OUTPUT
```

`COMPRESSION_QUALITY_OUTPUT` を指定した場合だけ、synthetic入力、実際の圧縮結果、機械的marker確認を人手レビュー用JSONへ保存する。通常の `npm test` はこのscriptを呼ばず、外部Geminiへ接続しない。出力は現行 `semantic-dense-v1` のbaselineであり、因果・否定範囲・不確実性・事実／推測境界を自動判定せず、合格thresholdも定義しない。

## Token usage の実測

Interactions API responseのusageを、opt-inの測定scriptから数値だけ観測できる。`system-only` は共通prefixを持たない短いsynthetic文4件、`shared-input-prefix` は長い共通prefixを持つsynthetic文4件を送る。外部通信・課金の可能性を理解した上で実行する。

```powershell
$env:KINOTCH_COMPRESSION_GEMINI_API_KEY = "<operator-provided Gemini key>"
$env:RUN_COMPRESSION_USAGE_MEASURE = "true"
npm run measure:compression:usage
Remove-Item Env:KINOTCH_COMPRESSION_GEMINI_API_KEY
Remove-Item Env:RUN_COMPRESSION_USAGE_MEASURE
```

出力するのはscenario、request数、status、文字数、model、`inputTokens`、`outputTokens`、`thoughtTokens`、`cachedTokens`、`totalTokens`だけで、本文・圧縮結果・Prompt・secret・raw provider responseは含めない。`cachedTokens` が0またはnullでも失敗とは扱わず、観測値として記録する。stateless Interactions、`store:false`、Explicit Context Cacheなし、`generateContent`移行なしを維持し、cache効果のthresholdは定義しない。

## Deployとrollback

`npm run deploy:production` は、generated checks → tests → Text Worker dry-run → Compression Worker dry-run → Gateway dry-run → 直前100% active version capture → Text deploy → Text smoke → Compression deploy → Gateway deploy → 非課金のCompression Gateway readiness確認（反映待ち時のみ再試行）→ Gateway経由Compression smoke（Gemini生成は1回）→ Compressionを再実行しない完全Gateway smoke → release metadata の順に実行する。

Compression smokeは新しいGateway Service Binding経路を実際に検証する必要があるため、Compression Worker deploy直後ではなくGateway deploy後に実行する。反映待ちのGET readiness確認は再試行するが、Provider受理不明の通信失敗やGemini生成自体は無条件再送しない。production smokeのdirect checkでは `https://semantic-compression.kinotch.workers.dev/health` も確認し、HTTP 200で直接到達できる場合は失敗とする。

smoke失敗時のrollback対象は `Gateway → Compression → Text` の順である。release metadataには `compressionVersionId`、`previousCompressionVersionId`、`compressionSmoke`、`compressionRecovery`、`compressionModel`、`compressionPromptVersion` を含める。既存Text/Gatewayのmetadataとrollback契約は削除しない。

## Privacy

入力text、`compressed_text`、Authorization token、Gemini key、system prompt全文、Gemini raw response全文を本文ログへ残さない。構造化ログで許可するのはrequest ID、route、status、elapsed time、input/output chars、圧縮率、model、prompt version、rate-limit結果、safe error categoryだけである。input/output hashは通常ログへ出さない。
