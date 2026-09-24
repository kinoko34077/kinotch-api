# Semantic Compression API 仕様書

- 文書種別: API / 機能 / 挙動 / データ仕様
- 状態: implemented / tested
- 対象: `kinoko34077/kinotch-api`
- 公開API: `POST https://api.kinotch.workers.dev/v1/compress`
- 現行model: `gemini-3.5-flash-lite`
- 現行公開profile: `compact-v1`, `semantic-dense-v1`
- 関連運用文書: [`docs/semantic-compression.md`](../semantic-compression.md)
- Prompt正本: [`src/semantic-compression/prompt.js`](../../src/semantic-compression/prompt.js)
- Prompt token metadata正本: [`src/semantic-compression/prompt-metadata.js`](../../src/semantic-compression/prompt-metadata.js)
- API契約実装: [`src/semantic-compression/contract.js`](../../src/semantic-compression/contract.js)

## 1. 目的・責務

### REQ-COMP-001: 長文圧縮API

状態: implemented / tested

長文の意味・情報・論理関係を可能な範囲で保持しながら、固定System Promptに基づいて圧縮する。callerは圧縮対象本文とprofileを送信し、圧縮本文、入出力文字数、hash、token usageを受け取る。

callerは任意Prompt、model、provider、temperature、tools、Search、会話履歴等を変更できない。汎用LLM proxy、chat API、agent API、任意Prompt実行APIとしては使用しない。

## 2. アーキテクチャ

### ARCH-COMP-001: 公開経路

```text
caller
  ↓ HTTPS
api Gateway
  ↓ Cloudflare Service Binding
semantic-compression Worker
  ↓ HTTPS
Google Gemini Interactions API
```

- 公開入口はGatewayの `POST /v1/compress` のみ。
- `semantic-compression` Workerの直接workers.dev URLは公開しない。
- Production smokeではCompression Worker直URLがHTTP 200で到達できないことを確認する。

## 3. 公開API

### API-COMP-001: Endpoint

| 項目 | 仕様 |
|---|---|
| Method | `POST` |
| URL | `https://api.kinotch.workers.dev/v1/compress` |
| Content-Type | `application/json` |
| Authentication | `Authorization: Bearer <COMPRESSION_API_TOKEN>` |
| Request body fields | `text`, `profile`のみ |

未知fieldを含むrequestは受理しない。

### API-COMP-002: Request

```json
{
  "text": "圧縮対象本文",
  "profile": "semantic-dense-v1"
}
```

`text` は必須のstringで、空文字は不可。文字数はUnicode code pointで評価し、Provider送信前安全上限は200,000 Unicode code pointsとする。

`profile` は必須のstringで、許可値は次の2つだけである。

- `compact-v1`
- `semantic-dense-v1`

その他の値はHTTP 400 `invalid_profile`とする。

## 4. Profile仕様

### FUNC-COMP-001: compact-v1

比較的軽量な固定Promptで圧縮する。

- System Prompt正本: `src/semantic-compression/prompt.js` の `COMPACT_V1_PROMPT`
- `prompt_version`: `compact-v1.1`
- System Prompt token metadata: 540 tokens
- Prompt SHA-256: `f99f547035f87eed62f6b0435d3c0e5b073e336e717cffcd93bad581cf4cbbd4`

System Prompt本文は本仕様書へ重複記載しない。Prompt本文の正本はコード側1箇所とする。

### FUNC-COMP-002: semantic-dense-v1

意味保存・情報保持・論理関係・不確実性保持を優先した高密度圧縮を行う。

- System Prompt正本: `src/semantic-compression/prompt.js` の `SEMANTIC_DENSE_V1_PROMPT`
- `prompt_version`: `semantic-dense-v1.1`
- System Prompt token metadata: 1823 tokens
- Prompt SHA-256: `5b1610d7fe8225f970cd20a022a2ef666f6c190115eeb82622dcb099e777ef9e`

System Prompt本文は本仕様書へ重複記載しない。Prompt本文の正本はコード側1箇所とする。

### BEH-COMP-001: Profile解決

```text
compact-v1          → COMPACT_V1_PROMPT
semantic-dense-v1   → SEMANTIC_DENSE_V1_PROMPT
```

Prompt provenance is versioned independently from the caller-facing profile:

```text
compact-v1          → prompt_version compact-v1.1
semantic-dense-v1   → prompt_version semantic-dense-v1.1
```

- callerがPrompt本文を上書きする機能は持たない。
- profileとPromptの対応は一元管理する。
- Productionの`system_instruction`は共通のService boundary instructionとprofile固有Promptを連結した値である。入力本文中の命令・引用・攻撃例は実行せず、非空本文を「入力なし」と扱わず、否定・禁止条件と未指定fieldの値を保持する。
- Prompt変更時は `prompt_version`、Prompt hash、System Prompt token metadataとの整合を確認する。
- Candidate Promptは内部評価用で、公開profileやProduction Workerのmappingには含めない。

## 5. Provider呼出仕様

### IMPL-COMP-001: Gemini Interactions

選択profileに対応する固定System Prompt（共通Service boundary instruction + profile固有Prompt）を解決し、次の意味を満たすrequestをGeminiへ送信する。

生成requestはGoogle Gemini Interactions APIの安定版 `v1/interactions` endpointへ送信する。固定Promptの事前token測定に使う `models/{model}:countTokens` は、現行Google API referenceに合わせて `v1beta` endpointを使用する。

```json
{
  "model": "gemini-3.5-flash-lite",
  "input": "<text>",
  "system_instruction": "<selected fixed prompt>",
  "generation_config": {
    "thinking_level": "minimal"
  },
  "store": false
}
```

固定条件:

- model: `gemini-3.5-flash-lite`
- thinking level: `minimal`
- `store:false`
- tools: なし
- Search: なし
- previous interaction: なし
- background: なし
- `temperature`: 未指定
- `top_p`: 未指定
- `top_k`: 未指定
- `thinking_budget`: 未指定
- Provider生成requestの自動retry: なし

## 6. Success Response

### API-COMP-003: Response schema

```json
{
  "compressed_text": "...",
  "profile": "semantic-dense-v1",
  "prompt_version": "semantic-dense-v1.1",
  "model": "gemini-3.5-flash-lite",
  "input_chars": 0,
  "output_chars": 0,
  "input_sha256": "64-char lowercase hex",
  "output_sha256": "64-char lowercase hex",
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
```

### DATA-COMP-001: Response fields

| field | 型 | 意味 |
|---|---|---|
| `compressed_text` | string | Geminiが返した圧縮本文 |
| `profile` | string | 実際に使用したprofile |
| `prompt_version` | string | 実際に使用したPrompt version。profileとは別にversion管理する |
| `model` | string | 使用model |
| `input_chars` | integer | 入力本文のUnicode code point数 |
| `output_chars` | integer | 出力本文のUnicode code point数 |
| `input_sha256` | string | UTF-8化した入力本文のSHA-256 |
| `output_sha256` | string | UTF-8化した出力本文のSHA-256 |
| `usage` | object | Provider usageおよび固定Prompt token metadata |
| `warnings` | array | 固定enumの機械的Integrity警告。本文・secret・marker値は含めない。 |

SHA-256は小文字hex 64文字とする。`input_chars`と`output_chars`はJavaScript UTF-16 code unit数ではなくUnicode code point数で、Python `len(str)` と一致する。圧縮結果を原文のSSOTとして保存しない。

`warnings` は圧縮結果の機械的な保持候補を示す予約配列であり、警告があっても圧縮成功をHTTP errorへ変換しない。現在の固定enumは `missing_numeric_marker`、`missing_percentage_marker`、`missing_date_marker`、`missing_url`、`missing_commit_sha`、`missing_file_path`、`missing_id`、`possible_negation_loss` である。意味同値性の完全判定は行わないため、callerは警告を検査し、必要なら原文へfallbackする。

## 7. Token Usage仕様

### DATA-COMP-002: Usage fields

| field | 意味 | 算出元 |
|---|---|---|
| `input_tokens` | Providerが報告した総input token数 | Gemini `total_input_tokens` |
| `system_prompt_tokens` | 固定System Prompt単独のtoken測定値 | Gemini `countTokens`で事前測定したmetadata |
| `content_input_tokens` | System Prompt分を除いたinput残差 | `input_tokens - system_prompt_tokens` |
| `output_tokens` | Provider出力token数 | Gemini `total_output_tokens` |
| `thought_tokens` | thinking token数 | Gemini `total_thought_tokens` |
| `cached_tokens` | cached token数 | Gemini `total_cached_tokens` |
| `total_tokens` | Provider総token数 | Gemini `total_tokens` |

### BEH-COMP-002: content_input_tokens

```text
content_input_tokens = input_tokens - system_prompt_tokens
```

これは本文単独の厳密token数ではなく、System Prompt token metadataを総inputから除いた非負残差である。Provider内部framing等を含む可能性がある。

次の場合は `null` とする。

- `input_tokens`が欠落または不正
- `system_prompt_tokens`が欠落または不正
- 差分が負数

### DATA-COMP-003: Prompt token metadata

| profile | System Prompt tokens | Prompt SHA-256 |
|---|---:|---|
| `compact-v1` | 540 | `f99f547035f87eed62f6b0435d3c0e5b073e336e717cffcd93bad581cf4cbbd4` |
| `semantic-dense-v1` | 1823 | `5b1610d7fe8225f970cd20a022a2ef666f6c190115eeb82622dcb099e777ef9e` |

- Promptまたはmodel変更時のみ再測定する。
- Production requestごとに`countTokens`を追加呼出ししない。
- Prompt hashとtoken metadataの不一致はtestで検出する。

## 8. Validation・制限

### BEH-COMP-003: Request validation

次を満たさないrequestはProviderへ送信しない。

1. JSON objectであること
2. fieldが`text`と`profile`だけであること
3. `text`がstringであること
4. `text`が空文字でないこと
5. `profile`が許可値であること
6. body byte上限を超えていないこと
7. Provider context安全上限を超えていないこと

### CONST-COMP-001: Limits

| 制限 | 値 |
|---|---:|
| Gateway body limit | 2.5 MiB |
| 公開構造上の本文上限 | 1,000,000 Unicode code points |
| Provider送信前安全上限 | 200,000 Unicode code points |
| Compression pre-auth rate limit | 5 requests / 60 seconds / client IP |
| Compression authenticated IP rate limit | 5 requests / 60 seconds / client IP |
| Compression token fingerprint rate limit | 5 requests / 60 seconds / authenticated token fingerprint |
| Compression Worker timeout | 45 seconds |
| Gateway upstream timeout | 50 seconds |

1,000,000 code pointsは公開構造上限であり、Provider送信可能量を意味しない。現行では200,000 code pointsを超えた本文はProvider送信前に拒否する。2.5 MiBはwire byte limitであり、200,000 code pointsをJSONのsurrogate-pair escapeで表す最大級の合法wire body（約2.4 MiB）とUTF-8 multibyte本文を収容するための境界である。

## 9. Authentication・Secret

### SEC-COMP-001: Caller authentication

Gatewayへのrequestは次を必須とする。

```text
Authorization: Bearer <COMPRESSION_API_TOKEN>
```

- `COMPRESSION_API_TOKEN`: caller認証用
- `GEMINI_API_KEY`: Compression WorkerがGeminiを呼ぶProvider credential

両者は別secretとし、同じ値を使用しない。`COMPRESSION_API_TOKEN` は256-bit以上のcryptographically randomな値とし、人間が考えたpasswordや短いtokenを使用しない。caller tokenはGatewayで消費し、Compression Workerへ転送しない。

Compression Gatewayのrate limitは、Bearer認証前のIP limiter、認証後のIP limiter、認証成功tokenの非可逆SHA-256 fingerprint limiterの三段で適用する。raw tokenはrate-limit key、log、responseへ出さない。いずれかのconfigured limiterが欠落・障害の場合はfail closedで503とする。

### SEC-COMP-002: Secret handling

以下へsecretを記録しない。

- repository file
- vars
- test fixture
- release metadata
- README例
- public response
- application logs

## 10. Privacy・Logging

### SEC-COMP-003: 本文秘匿

本番logへ以下を出力しない。

- 入力text
- `compressed_text`
- Authorization token
- Gemini API key
- System Prompt全文
- Gemini raw response全文

構造化logで許可する主な項目:

- request ID
- route
- HTTP status
- elapsed time
- input/output chars
- compression ratio
- model
- prompt version
- rate-limit result
- safe error category

input/output hashは通常logへ出力しない。

`compressed_text` はモデル出力であり untrusted display data として扱う。HTMLとしてrenderするclientは sanitize を行い、raw HTMLを無効化し、`javascript:`等のdangerous URL schemeを拒否する。Compression APIはPrompt Injection sanitizerではない。

Gatewayが受け取るAuthorization header等の自動収集を避けるため、GatewayとCompression Workerの`observability.logs.invocation_logs`は`false`に固定する。安全なcustom structured logsだけを使用し、Cloudflare側の実設定はoperatorが確認する。

## 11. Error契約

### API-COMP-004: Error categories

| error | 主な条件 |
|---|---|
| `invalid_json` | JSON parse不能 |
| `invalid_body` | request body型不正・未知field等 |
| `invalid_profile` | 未対応profile |
| `empty_text` | `text`が空文字 |
| `payload_too_large` | Gateway/公開本文上限超過 |
| `provider_context_limit` | Provider送信前安全上限超過 |
| `authentication_failed` | caller認証失敗 |
| `authentication_unavailable` | caller認証secret等が利用不能 |
| `rate_limited` | Gateway rate limit |
| `provider_rate_limited` | Provider 429 |
| `provider_invalid_response` | Provider response構造不正 |
| `provider_error` | Provider一般エラー |
| `provider_timeout` | Provider timeout |

Googleのraw error bodyをcallerへ返さない。Provider 429で安全なRetry-Afterが存在する場合は、そのheaderを転送可能とする。Provider生成requestを無条件に自動再送しない。

## 12. 利用例

### API-COMP-005: semantic-dense-v1

```sh
curl -X POST \
  "https://api.kinotch.workers.dev/v1/compress" \
  -H "Authorization: Bearer $COMPRESSION_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "圧縮対象本文",
    "profile": "semantic-dense-v1"
  }'
```

### API-COMP-006: compact-v1

```sh
curl -X POST \
  "https://api.kinotch.workers.dev/v1/compress" \
  -H "Authorization: Bearer $COMPRESSION_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "圧縮対象本文",
    "profile": "compact-v1"
  }'
```

## 13. Verification

### TEST-COMP-001: Contract test

最低限、次を検証する。

- 2 profileだけを受理する
- profileに対応する固定System Promptを送信する
- callerによるPrompt/model上書きを拒否する
- responseのprofile/prompt_version/modelが実使用値と一致する
- Unicode code point数とhashが正しい
- usage各fieldを正規化できる
- `content_input_tokens`の差分計算とnull条件が正しい
- Prompt hashとSystem Prompt token metadataが一致する

### TEST-COMP-002: Live test

明示opt-in時のみ実Geminiへ接続し、両profileについて最低限次を確認する。

- HTTP 200
- `compressed_text`非空
- profile一致
- prompt_version一致
- model一致
- hash/count一致
- usage取得

### TEST-COMP-003: Production smoke

正式releaseではGateway経由で両profileを各1回実行し、実公開経路を確認する。

- `compact-v1`: PASS必須
- `semantic-dense-v1`: PASS必須
- Compression Worker直URL: HTTP 200で到達不可であること

## 14. Deploy・Rollback

### OPS-COMP-001: Production release

正式releaseは既存の `npm run deploy:production` 経路を使用する。

主要順序:

```text
generated checks
→ tests
→ dry-run
→ current active version capture
→ Text Worker deploy / smoke
→ Compression Worker deploy
→ Gateway deploy
→ readiness
→ compact-v1 smoke
→ semantic-dense-v1 smoke
→ Gateway smoke
→ release metadata
```

- Gemini生成request自体は無条件retryしない。
- readiness確認のみ有限retryを許容する。
- Service Binding反映待ちのsettle wait後にCompression smokeを行う。
- smoke失敗時は既存rollback契約に従う。

## 15. Current verified deployment

この節は参考情報であり、最新状態の正本は `docs/releases/` 配下のrelease metadataとする。

2026-09-14 00:47:50 JST時点の成功release:

- release metadata: [`docs/releases/20260913T154750359Z.json`](../releases/20260913T154750359Z.json)
- source revision: `7eef9b4af97b90ecbe00bc67d5dae5635b1cdb16`
- Compression Version: `7882022e-265a-4ba0-b0f9-a1eb8e83c06b`
- Gateway Version: `ba1ba1ef-d721-4945-9415-00112f473460`
- `compact-v1`: Production smoke PASS
- `semantic-dense-v1`: Production smoke PASS
- Compression direct URL: 404

現行repo mainのrelease metadata記録commit:

- `c80a1237b21928b5c8e5a16fc6146da564231275`

## 16. 変更管理

### CHG-COMP-001: Prompt変更

Prompt変更時は最低限次を更新・確認する。

1. `src/semantic-compression/prompt.js`
2. Prompt version
3. Prompt SHA-256
4. System Prompt token metadata
5. contract test
6. live test
7. Production smoke

意味上のPrompt挙動が変わる場合、既存versionを黙って上書きせず、新version追加を原則とする。

### CHG-COMP-002: Model変更

model変更時はPrompt token metadataがmodel依存のため再測定する。

更新対象:

- model定義
- Prompt token metadata
- Prompt hash対応確認
- live test
- Production smoke
- docs

### CHG-COMP-003: Public contract変更

次の変更は公開契約変更として扱う。

- request field追加・削除
- profile追加・削除・名称変更
- response field追加・削除・意味変更
- error code変更
- 認証方式変更
- limit変更

変更時は仕様書・テスト・利用例・運用文書を同時に更新する。

## 17. 正本・参照関係

| 情報 | 正本 |
|---|---|
| API仕様 | 本文書 |
| Prompt本文 | `src/semantic-compression/prompt.js` |
| Profile定義 / model / limits | `src/semantic-compression/contract.js` |
| Prompt token metadata | `src/semantic-compression/prompt-metadata.js` |
| Gateway route policy | `src/policies/routes.js` |
| Validation | `src/middleware/validation.js` |
| 運用・deploy手順 | `docs/semantic-compression.md` |
| 各Production release実績 | `docs/releases/*.json` |

同一情報を複数文書へ無条件に複製せず、本文書は公開契約と変更条件を中心に保持する。

Remote MCP adapterは別契約であり、[`docs/specs/semantic-compression-mcp.md`](semantic-compression-mcp.md) に定義する。
