# Jev Audit Remote 利用ガイド

Status: Production verified

この文書は、`kinotch-api`上の **Jev Audit Remote** について、**何をする機能か、どんな用途に使うか、REST APIとRemote MCPのどちらを選ぶか、どう呼び出すか**を単独で把握するための利用者向けガイドである。

bootstrap、secret ownership、release、rollback、Cloudflare Access設定等の運用正本は [jev-audit.md](jev-audit.md) を参照する。

## 1. Jev Audit Remoteとは

Jev Audit Remoteは、local `jev-audit` v0.2.12で使っている一次監査の意味論を、Cloudflare Workers上から **REST API / Remote MCP** として呼び出せるようにしたRemote surfaceである。

目的は、通常のLLMへrepository全体を長時間レビューさせる前に、file群を軽量に一次監査して、詳細確認すべき箇所を絞ることにある。

主に次のsignalを見る。

| signal | 意味 |
|---|---|
| `concrete_issue` | 入力file群から直接確認できる具体的な欠陥・矛盾・危険な挙動の兆候 |
| `spec_mismatch` | 同じ入力範囲で確認できる仕様・説明・設定・実装の食い違い |
| `regression_risk` | 具体的な変更・実装から直接読み取れる回帰リスク |
| `local_status` | `clear / review / rework / unknown` の局所状態 |

Remote版も「見つからない外部証拠を違反扱いしない」「入力内から直接確認できる問題を重く見る」という方針を維持する。

## 2. Local版との違い

Local `jev-audit`はrepositoryやGitを直接読むことができる。

Remote版は**callerが明示的に送ったfile snapshotだけ**を監査する。

```text
Local
repository / Git
  ↓
scanner
  ↓
Audit Core

Remote
callerがfile snapshotを構成
  ↓ REST or MCP
private jev-audit Worker
  ↓
validation / batching / TypeSafe / aggregate
```

Remote v1は次を行わない。

- filesystem pathを指定してserver側で読む
- Git `changed_only`
- Git diff discovery
- untracked file discovery
- repository clone
- 任意profile fileの読込
- callerによるmodel override

差分監査が必要な場合は、caller側で変更fileと必要な`change` contextを構成して送る。

## 3. どの入口を使うか

| 入口 | 適する状況 | 認証 |
|---|---|---|
| REST API | script、app、CI、独自AgentがHTTP/JSONで直接組み込みたい | Bearer `JEV_AUDIT_API_TOKEN` |
| Remote MCP | Codex等のMCP client / Agentからtoolとして呼びたい | Cloudflare Access Service Token |
| Local CLI / STDIO MCP | 同じPC上のrepository / Gitを直接監査したい | local `TYPESAFE_API_KEY` |

判断基準は単純である。

```text
repository/Gitをその場で直接見たい
  → Local CLI / Local MCP

file本文を自分で用意してHTTPで渡したい
  → REST

file本文をAgentが用意し、MCP toolとして呼びたい
  → Remote MCP
```

## 4. 適する用途

### Agentのpreflight監査

Agentが詳細コードレビューや修正へ入る前に、関連file snapshotを`audit_files`へ渡して要確認領域を絞る。

### CI / scriptからの一次判定

build/test後に変更file snapshotをRESTへ送り、`review` / `rework`の兆候を次工程へ渡す。

### 仕様と実装の比較

仕様文書と関連実装を同じrequestへ含め、直接確認できる`spec_mismatch`候補を探す。

### 大きなfile集合の軽量triage

詳細LLMレビューの前にfile群をbatch分割して監査し、優先確認すべきbatch/pathを絞る。

## 5. 非目標

Remote Jev Auditは次の代替ではない。

- 正しさの証明
- unit / integration / E2E test
- lint / typecheck / static analysis
- 完全なsecurity audit
- 自動修正
- repository品質score

`clear`は「安全の証明」ではなく、**今回送ったsnapshot内で強い問題signalが出なかった**ことを示す。

## 6. REST API

Endpoint:

```text
POST https://api.kinotch.workers.dev/v1/audit
```

認証:

```text
Authorization: Bearer <JEV_AUDIT_API_TOKEN>
Content-Type: application/json
```

最小request例:

```json
{
  "files": [
    {
      "path": "SPEC.md",
      "content": "add(a,b) returns the sum of a and b."
    },
    {
      "path": "app.py",
      "content": "def add(a,b):\n    return a-b\n"
    }
  ],
  "profile": "development"
}
```

`change` contextを持っている場合だけ各fileへ追加できる。

```json
{
  "path": "app.py",
  "content": "def add(a,b):\n    return a-b\n",
  "change": "- return a+b\n+ return a-b"
}
```

REST callerはrepository pathを送るのではなく、**監査してよい本文そのものをsnapshotとして送る**。

### RESTが向くcaller

- Node/Python/PowerShell等のscript
- CI job
- backend service
- 独自Agent loop
- MCPを必要としない単純なHTTP統合

## 7. Remote MCP

Endpoint:

```text
https://jev-audit-mcp.kinotch.workers.dev/mcp
```

通常Production認証はCloudflare Access Service Token。

HTTP header:

```text
CF-Access-Client-Id: <service-token-id>
CF-Access-Client-Secret: <service-token-secret>
```

公開toolは2つだけである。

### `list_profiles`

Remoteで利用可能なprofileを返す。

現行:

- `development`
- `generic`

### `audit_files`

RESTと同様のexplicit file snapshotsを監査し、structured audit reportを返す。

Remote MCPもserver側のfilesystem/Gitを読まない。MCP client / Agent側が監査対象の本文をtool argumentとして構成する。

Jev固有のManaged OAuthはProduction利用の必須条件ではない。**Service Token経路が通常Production認証**であり、実Production E2Eもこの経路で確認済みである。

## 8. RESTとMCPの監査結果は別物か

監査ロジックは別物ではない。

```text
REST Gateway ─┐
              ├→ Service Binding JEV_AUDIT
Remote MCP ───┘       ↓
                private jev-audit Worker
                       ↓
                validation / batching
                       ↓
                TypeSafe System One
                       ↓
                deterministic aggregate
```

RESTとMCPは入口・認証・protocolが違うが、private `jev-audit` Workerを共用する。

したがって同じprofile・同じfile snapshotを渡す限り、監査意味論は共通である。

## 9. Profile / model / semantics

Remote v1は再現性を優先して次を固定する。

- profiles: `development` / `generic`
- model: `jev-1.13.0`
- audit semantics: `0.2.12`

callerは任意modelや任意profile fileを指定できない。

providerが固定modelと異なるmodelを返した場合も、現行repository contractではdriftとしてfail-closedする。

## 10. 主な入力上限

| 項目 | Remote v1 |
|---|---:|
| request body | 1 MiB |
| files | 100 |
| path | 512 Unicode code points |
| supplied `content + change` | 500,000 Unicode code points |
| effective content / file | 12,000 Unicode code points |
| batch target | 32,000 estimated chars |
| batches | 32 |
| concurrent TypeSafe calls | 4 |
| provider timeout | 45 s |

1 fileがeffective上限を超える場合、contentはhead / truncation marker / tail方式で正規化される。

一部batchだけprovider failureになった場合も、残りbatchの結果を部分成功として返さずrequest全体を失敗させる。

## 11. 認証とsecretの役割を混ぜない

3つの認証境界は別である。

| credential | 所有者 | 用途 |
|---|---|---|
| `JEV_AUDIT_API_TOKEN` | Gateway | REST caller認証 |
| Cloudflare Access Service Token | caller / Access | Remote MCP認証 |
| `TYPESAFE_API_KEY` | private `jev-audit` Worker | TypeSafe provider認証 |

REST bearer tokenをMCP認証へ流用しない。

Cloudflare Access Service TokenをREST bearerとして使わない。

`TYPESAFE_API_KEY`をGatewayやMCP Workerへ置かない。

## 12. Privacy / source送信

Remote serviceは、callerが送ったsource / diffをTypeSafe providerへ送る。

そのためcaller側で、**外部providerへ送信してよいfileだけをsnapshotへ含める**必要がある。

Remote側はfilename/extensionによる完全DLPを保証しない。

通常ログ・release metadataには次を保存しない契約である。

- source本文
- diff本文
- REST Authorization token
- Cloudflare Access credential
- `TYPESAFE_API_KEY`
- TypeSafe raw response body

## 13. Production状態

Jev Audit RemoteはProduction verifiedである。

正式Production releaseで確認済み:

- REST: HTTP 200
- live TypeSafe到達
- model `jev-1.13.0`
- semantics `0.2.12`
- Remote MCP Service Token認証: HTTP 200
- `audit_files`実tool call成功
- private / MCP Worker deploy成功
- rollback不要

Production evidence:

- `docs/releases/20260925T144351192Z.json`
- `docs/releases/jev-audit-20260925T144353075Z.json`

release後にrepositoryへ追加されたhardening（Unicode path契約統一、model drift rejection、`list_profiles` actual smoke等）はCI/Verify済みだが、次回の明示承認されたformal releaseまでは「Productionへdeploy済み」とは扱わない。

## 14. よく使う選択例

### PC上の現在repoを監査したい

RemoteではなくLocal `jev-audit . --changed-only`を使う。

### Web appから監査したい

app側でfile snapshotを作りREST `/v1/audit`へ送る。

### Codex等からRemote toolとして使いたい

MCP endpointをCloudflare Access Service Token付きで登録し、`list_profiles` / `audit_files`を使う。

### GitHub上の差分をRemoteで監査したい

Remote service自身にrepositoryをcloneさせない。caller / CI側で対象fileとdiff contextを取得してsnapshot化し、RESTまたはMCPへ渡す。

## 15. 関連正本

- **Remote契約・認証・bootstrap・release・rollback**: [jev-audit.md](jev-audit.md)
- **現在状態**: [`project/docs/CURRENT_STATE.md`](../project/docs/CURRENT_STATE.md)
- **Production release evidence**: [`docs/releases/`](releases/)
- **Local CLI / Local STDIO MCP**: <https://github.com/kinoko34077/jev-audit>
- **Local Jev Audit総合ガイド**: <https://github.com/kinoko34077/jev-audit/blob/main/docs/OVERVIEW.md>
