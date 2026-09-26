# Semantic Compression（超圧縮）概要・用途・利用ガイド

## 文書の役割

Semantic Compression（以下「超圧縮」）は、長文の意味・条件・例外・否定・不確実性・数値・固有名詞・論理関係を可能な限り保持しながら、後段で扱いやすい高密度テキストへ圧縮する `kinotch-api` のサブシステムである。

この文書は、超圧縮が「何をするものか」「何に使うか」「REST APIとRemote MCPをどう使い分けるか」「実際にどう呼び出すか」を単独で把握するための利用者向け入口である。

厳密なAPI契約・MCP契約・運用条件の正本は次を参照する。

- REST API仕様: [`docs/specs/semantic-compression-api.md`](specs/semantic-compression-api.md)
- REST運用仕様: [`docs/semantic-compression.md`](semantic-compression.md)
- Remote MCP仕様: [`docs/specs/semantic-compression-mcp.md`](specs/semantic-compression-mcp.md)
- Remote MCP運用仕様: [`docs/semantic-compression-mcp.md`](semantic-compression-mcp.md)
- 現在状態: [`project/docs/CURRENT_STATE.md`](../project/docs/CURRENT_STATE.md)

---

## 1. 超圧縮とは何か

超圧縮は、自由な要約指示を受け付ける汎用LLM APIではない。

入力された本文を、あらかじめ固定された圧縮方針・model・Prompt・生成条件で処理し、意味保存を優先した短い表現へ変換する専用機能である。

特に `semantic-dense-v1` は、単純な要約よりも次の保持を重視する。

- 主題・結論
- 条件・前提
- 例外
- 否定・禁止
- 不確実性・留保
- 数値・割合・日付
- URL・ID・commit SHA・file path
- 固有名詞
- 因果・対比・依存関係などの論理関係

圧縮結果は「原文を短くして再利用しやすくする中間表現」であり、原文そのもののSSOTではない。

---

## 2. 主な用途

### 2.1 LLM間・Agent間の長文受け渡し

長い調査結果、実装状況、会話要約、監査結果などを次のLLMやAgentへそのまま渡す代わりに、超圧縮してから渡す。

```text
長い中間結果
  ↓
Semantic Compression
  ↓
高密度な圧縮結果
  ↓
次のLLM / Agent / workflow
```

目的は、context消費量を減らしながら、後段の判断に必要な条件・例外・数値・論理関係をできるだけ残すことである。

### 2.2 長文のcontext再利用

同じ長文を複数回LLMへ渡す場合、毎回原文全体を投入せず、用途に応じて圧縮結果を中間contextとして利用できる。

### 2.3 MCP toolとしての自動圧縮

Remote MCPでは `compress_text` の1 toolだけを公開し、AgentやCodex等が必要な長文を固定方式で圧縮できる。

### 2.4 API組込み

独自アプリ、workflow、CLI、batch処理等からREST APIを呼び出し、圧縮結果・token usage・hash・warningを利用できる。

---

## 3. 向いていない用途

超圧縮は次の用途を目的としない。

- 「この観点だけで要約して」等の自由なPrompt実行
- chat API
- 汎用Gemini proxy
- 任意model切替
- 任意temperature / top-p / top-k調整
- tools / Search付き生成
- 会話履歴を持つAgent
- 完全可逆圧縮
- 原文を廃棄して圧縮結果だけを唯一の正本にする運用

意味保存は重視するが、生成モデルによる圧縮である以上、完全無損失を保証する仕組みではない。

---

## 4. 全体構造

RESTとMCPは別々の圧縮実装を持たず、同じCompression Coreを共有する。

```text
REST caller
  -> API Gateway
  -> semantic-compression Worker
  -> Gemini

MCP client
  -> Cloudflare Access
  -> semantic-compression-mcp Worker
  -> Service Binding
  -> semantic-compression Worker
  -> Gemini
```

`semantic-compression` Workerが次を一元管理する。

- provider call
- model
- Prompt
- profile mapping
- character counts
- SHA-256
- token usage normalization
- integrity warnings
- provider error normalization

MCP Workerは薄いadapterであり、圧縮ロジックを複製しない。

---

## 5. 現行model・profile

現行provider / modelは固定である。

```text
Provider: Google Gemini
Model: gemini-3.5-flash-lite
thinking_level: minimal
store: false
```

### `compact-v1`

比較的軽量な固定Promptによる圧縮。

```text
profile: compact-v1
prompt_version: compact-v1.1
system prompt token metadata: 540
```

### `semantic-dense-v1`

意味・条件・例外・否定・不確実性・数値・固有名詞・論理関係の保持を重視した高密度圧縮。

```text
profile: semantic-dense-v1
prompt_version: semantic-dense-v1.1
system prompt token metadata: 1823
```

RESTでは両profileを選択できる。

Remote MCPは常に `semantic-dense-v1` を使用し、callerからprofileを変更できない。

---

## 6. REST APIの使い方

### 6.1 Production endpoint

```text
POST https://api.kinotch.workers.dev/v1/compress
```

### 6.2 認証

```http
Authorization: Bearer <COMPRESSION_API_TOKEN>
```

`COMPRESSION_API_TOKEN` はREST caller用credentialであり、Gemini API keyやMCP Service Tokenとは別物である。

### 6.3 Request

許可されるfieldは `text` と `profile` のみ。

```json
{
  "text": "圧縮対象本文",
  "profile": "semantic-dense-v1"
}
```

未知fieldは無視せず拒否する。

### 6.4 PowerShell例

```powershell
$headers = @{
  Authorization = "Bearer <your-compression-api-token>"
}

$body = @{
  text = "The red train arrived at the station at 08:30. The passenger carried two blue bags."
  profile = "semantic-dense-v1"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.kinotch.workers.dev/v1/compress" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

実credentialをrepository、Issue、PR、chat transcript等へ記録しない。

### 6.5 Response

RESTでは圧縮本文に加えて、provenance・character count・hash・token usage・warningを返す。

```json
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
```

`content_input_tokens` は `input_tokens - system_prompt_tokens` の非負残差であり、caller本文だけの厳密token数とは限らない。

---

## 7. Remote MCPの使い方

### 7.1 Production endpoint

```text
https://semantic-compression-mcp.kinotch.workers.dev/mcp
```

Transportはstateless MCP Streamable HTTP。

### 7.2 Tool

公開toolは1つだけである。

```text
compress_text
```

Input:

```json
{
  "text": "圧縮対象本文"
}
```

MCP側では内部的に必ず次を使用する。

```text
profile = semantic-dense-v1
```

callerはPrompt、profile、model、provider、generation option、tools、Search、historyを変更できない。

### 7.3 MCP lifecycle

```text
initialize
-> notifications/initialized
-> tools/list
-> tools/call compress_text
```

`initialize` と `tools/list` はcompression generation用rate limitを消費しない。

### 7.4 MCPの返却範囲

model-facing resultには圧縮本文を返す。

必要最小限のstructured provenanceとして次を含められる。

- `profile`
- `prompt_version`
- `model`
- `input_chars`
- `output_chars`
- `warnings`

RESTと異なり、token usage・SHA-256・raw provider output・raw upstream body・credentialは標準ではMCPへ露出しない。

---

## 8. RESTとMCPの使い分け

| 条件 | REST | MCP |
|---|---|---|
| アプリから直接HTTP呼出 | 適する | MCP clientが必要 |
| `compact-v1`を使いたい | 可能 | 不可 |
| `semantic-dense-v1`を使いたい | 可能 | 固定で使用 |
| token usage / hashを取得したい | 可能 | 標準では非公開 |
| Agent/Codexからtoolとして使いたい | 別実装が必要 | 適する |
| 認証 | Bearer token | Cloudflare Access |

RESTはprogrammatic APIとして詳細metadataが必要な場合に使用する。

MCPはAgent/LLM clientから「長文を超圧縮するtool」として直接利用する場合に使用する。

---

## 9. MCP認証

RESTの `COMPRESSION_API_TOKEN` はMCPでは使用しない。

MCPはCloudflare Accessで保護する。

### Managed OAuth

対話的client向け。

```text
Codex / MCP client
-> Managed OAuth
-> Cloudflare Access
-> semantic-compression-mcp
```

KiNoTch. ProductionではCodexによるManaged OAuth、tool discovery、`compress_text` 実呼出まで検証済みである。

### Service Auth

非対話利用向け。

```text
CF-Access-Client-Id
CF-Access-Client-Secret
```

KiNoTch. ProductionではService Token経路自体はrelease smokeで検証済みである。

Codex固有の `http_headers_helper` を用いたmachine-local Service Auth E2Eは、repository実装完了後の実機確認としてIssue #9で追跡する。

---

## 10. Integrity warning

圧縮結果に、機械的に検出可能な情報欠落候補がある場合、REST responseまたはMCP provenanceの `warnings` に固定enumを返す。

現行enum:

```text
missing_numeric_marker
missing_percentage_marker
missing_date_marker
missing_url
missing_commit_sha
missing_file_path
missing_id
possible_negation_loss
```

warningは「意味が失われたことの証明」ではなく、callerが原文fallbackや追加確認を判断するための補助signalである。

warningが存在しても、成功した圧縮結果を自動的に原文へ置換しない。

---

## 11. 現行の主な制限

REST:

| Boundary | Current value |
|---|---:|
| Gateway body limit | 2.5 MiB |
| Public structural text limit | 1,000,000 Unicode code points |
| Provider pre-send safety limit | 200,000 Unicode code points |
| Pre-auth rate limit | 5 requests / 60 s / IP |
| Authenticated IP rate limit | 5 requests / 60 s / IP |
| Authenticated token fingerprint limit | 5 requests / 60 s / token |
| Compression Worker timeout | 45 s |
| Gateway upstream timeout | 50 s |

MCP `compress_text`:

```text
5 generations / 60 seconds
```

MCP側もCompression Coreの200,000 Unicode code point安全上限を共有する。

---

## 12. Privacy / security境界

次をrepositoryや通常logへ記録しない。

- 入力本文
- intended result以外の圧縮本文
- Gemini API key
- REST caller token
- Cloudflare Access JWT
- Service Token
- system prompt本文の不要な複製
- raw Gemini error body
- raw upstream body

認証やrate limiterが不完全な場合はfail closedとする。

Cloudflare Accessの問題を回避するために `Bypass` policyへ変更したり、Worker側JWT検証を無効化したりしない。

---

## 13. self-host

実装は構造的にself-host可能である。

第三者はpublic repositoryをcloneし、自身のGemini / Cloudflare credentialとaccount固有resourceを設定すれば、同じSemantic Compression挙動を独立環境で再現できる。

ただし現状はzero-edit installerではない。

少なくとも次をself-host環境向けに用意・差替する必要がある。

- Gemini API key
- Cloudflare account
- `account_id`
- Worker namesまたはそれに対応するService Binding
- rate-limit namespace IDs
- REST caller credential
- Gateway / MCP hostname
- MCPを使う場合はCloudflare Access Application
- `TEAM_DOMAIN`
- `POLICY_AUD`
- Managed OAuthまたはService Token policy

利用形態は3つに分けられる。

```text
REST only
MCP only
REST + MCP
```

MCP onlyの場合でも、public REST Gatewayは必須ではない。MCP adapterはService Bindingでprivate Compression Workerへ直接接続する。

self-hostの詳細はIssue #23および各運用仕様を参照する。

---

## 14. 現在のProduction状態

KiNoTch. Productionでは次が完了している。

- REST API実装
- `compact-v1` / `semantic-dense-v1`
- Production deploy
- Gateway / Compression smoke
- Remote MCP実装
- Cloudflare Access保護
- MCP `compress_text`
- Service Token release smoke
- Codex Managed OAuth E2E
- Codexからの `compress_text` 実呼出

残っているCodex Service Auth Issue #9は、`http_headers_helper` を利用するmachine-local接続方式の追加E2Eであり、REST/MCP本体のProduction利用可否をblockしない。

---

## 15. 最短の理解

超圧縮は、次の1機能へ用途を絞ったサービスである。

```text
長い本文
  ↓
固定された意味保存型圧縮
  ↓
条件・例外・否定・数値・論理関係をできるだけ残した短い本文
```

- アプリやworkflowから使うならREST。
- AgentやCodexのtoolとして使うならMCP。
- RESTでは `compact-v1` と `semantic-dense-v1` を選べる。
- MCPは `semantic-dense-v1` 固定。
- Prompt/model/providerをcallerが自由変更する仕組みではない。
- 圧縮結果は再利用用の中間表現であり、原文のSSOTではない。
