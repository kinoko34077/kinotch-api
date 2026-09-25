# Jev Audit Remote API / MCP

この文書は、`jev-audit` v0.2.12 の監査意味論を `kinotch-api` 上で利用するRemote surfaceの利用・運用境界を定義する。

Remote版はローカルのPython CLI / STDIO MCPを置き換えない。ローカル版はrepositoryやGit状態を直接扱える一方、Remote v1はcallerが送信した **explicit file snapshots** だけを監査対象にする。

## 1. Surface

| Surface | Endpoint / tool | 認証 | 役割 |
|---|---|---|---|
| REST | POST `/v1/audit` | `Authorization: Bearer <JEV_AUDIT_API_TOKEN>` | 明示的なfile snapshotを監査する |
| Remote MCP | `https://jev-audit-mcp.kinotch.workers.dev/mcp` | Cloudflare Access | `audit_files` / `list_profiles` を公開する |
| Private Worker | Service Binding `JEV_AUDIT` | public accessなし | validation、batching、TypeSafe呼出、集約を所有する |

Remoteの監査意味論provenanceは `0.2.12`、既定modelは `jev-1.13.0` で固定される。callerからmodel overrideや任意profile pathは指定できない。

## 2. Local版との境界

Remote v1 does not read the local filesystem or Git; callerが送信したsnapshot以外へ到達しない。

そのためRemote v1には no `changed_only` support があり、Git diff、untracked file discovery、repository path指定、remote cloneも行わない。差分監査が必要なcallerは、監査対象のfile snapshotをcaller側で構成して送信する。

Remote profileは `development` と `generic` の2種類だけである。status threshold、Noul、profile textはローカル `jev-audit` v0.2.12から固定した意味論を使用する。

## 3. REST

公開入口:

```text
POST https://api.kinotch.workers.dev/v1/audit
```

例:

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

`files`はexplicit file snapshotsであり、各entryはpathとcontentを持つ。必要な場合だけchangeを付与できる。

主なRemote v1制限:

| 項目 | 上限 |
|---|---:|
| request body | 1 MiB |
| files | 100 |
| path | 512 Unicode code points |
| supplied content + change | 500,000 Unicode code points |
| effective content / file | 12,000 Unicode code points |
| batch target | 32,000 estimated chars |
| batches | 32 |
| concurrent TypeSafe calls | 4 |
| TypeSafe request timeout | 45 seconds |

1 fileが12,000 code pointsを超える場合はhead / truncation marker / tail方式で正規化される。batchの一部だけprovider failureになった場合も部分的なclear/review結果は返さず、request全体を失敗させる。

REST bearer認証に使う `JEV_AUDIT_API_TOKEN` は Gateway Secretとして所有する。raw tokenをprivate Workerへforwardしない。

## 4. Remote MCP

Endpoint:

```text
https://jev-audit-mcp.kinotch.workers.dev/mcp
```

Remote MCPはCloudflare Accessで保護し、公開toolは次の2個だけである。

- `audit_files`: explicit file snapshotsを監査し、full audit reportをstructuredContentで返す。
- `list_profiles`: Remote v1で利用可能な固定profileを返す。

Remote MCPもfilesystem/Gitを読まず、`changed_only`、repository path、任意model、任意profile fileは受け付けない。

`TEAM_DOMAIN` は jev-audit-mcp WorkerのCloudflare Access issuer設定に使う。
`JEV_AUDIT_MCP_POLICY_AUD` は jev-audit-mcp Workerへdeploy時に `POLICY_AUD` として渡す専用audienceである。

Codex等の通常利用はCloudflare Access Managed OAuth、Production release / recoveryの自動MCP smokeは既存のCloudflare Access Service Tokenを使用する。自動smokeは `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` をHTTP headerとして送り、session cookieを使用しない。Service Token値はWorker varやrepositoryへ保存しない。

## 5. Secret / var ownership

| 名前 | 所有境界 | 用途 |
|---|---|---|
| `JEV_AUDIT_API_TOKEN` | Gateway Secret | REST caller認証 |
| `TYPESAFE_API_KEY` | private jev-audit Worker Secret | TypeSafe System One HTTP認証 |
| `TEAM_DOMAIN` | jev-audit-mcp Worker var | Cloudflare Access issuer |
| `JEV_AUDIT_MCP_POLICY_AUD` | operator release input → jev-audit-mcp `POLICY_AUD` var | Cloudflare Access audience |
| `JEV_AUDIT_SMOKE_TOKEN` | operator local secret input | Production REST smoke |
| `CF_ACCESS_CLIENT_ID` | operator local secret input | Compression/Jev Audit automated MCP smoke用Service Token ID |
| `CF_ACCESS_CLIENT_SECRET` | operator local secret input | Compression/Jev Audit automated MCP smoke用Service Token secret |

`TYPESAFE_API_KEY` must not be configured on the Gateway or MCP Worker; TypeSafe credentialはprivate jev-audit Workerだけが所有する。

Production secret mapperではJev Audit専用の `JEV_AUDIT_MCP_POLICY_AUD` / `JEV_AUDIT_SMOKE_TOKEN` と、既存のAccess Service Token 2値をproduction releaseへ渡す。値そのものをrelease metadataや通常ログへ保存しない。

## 6. Logging / privacy

source or diff contents must not be logged by normal Gateway, private Worker, MCP Worker, smoke helper, or release metadata paths.

同様に、Authorization bearer、Cloudflare Access credential、`TYPESAFE_API_KEY`、TypeSafe raw response bodyを通常ログへ出さない。ログに必要な情報はrequest id、stable error code、HTTP status等の安全な診断値へ限定する。

Remote監査対象は外部providerへ送信されるため、callerは送信可能なsourceだけをsnapshotとして構成する必要がある。filename/extensionによるDLPをRemote serviceが保証するものではない。

## 7. Deployment

専用Worker config:

```text
wrangler.jev-audit.jsonc
wrangler.jev-audit-mcp.jsonc
```

private `jev-audit` Workerは `workers_dev: false` でpublic endpointを持たない。Gateway RESTとRemote MCPはService Binding `JEV_AUDIT`を通じてのみ到達する。

通常のProduction deploy authorityはrepository既存のproduction release経路であり、Jev Auditだけを独立した正式release authorityにはしない。releaseはdry-run、active version capture、deploy、smoke、失敗時rollbackを既存gateへ統合する。

Jev Audit production releaseに追加で必要なoperator入力:

```text
JEV_AUDIT_MCP_POLICY_AUD
JEV_AUDIT_SMOKE_TOKEN
```

MCP自動smokeには既存release用の `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` を共用する。加えてCloudflare側で、Gatewayの `JEV_AUDIT_API_TOKEN` Secret、private Workerの `TYPESAFE_API_KEY` Secret、jev-audit-mcp Access application/policy、Service Tokenを許可するAccess policy、専用rate-limit namespaceが必要である。

## 8. Verification state

Remote implementation、unit/integration test、Wrangler設定、release/smoke helperは実装済みである。

ただし、live TypeSafe REST E2E、Production deploy、authenticated Remote MCP tool-call E2Eは、実際にoperator-managed secretsとCloudflare設定を用いて成功するまで **pending** と扱う。dry-runやfake binding testだけでProduction verifiedへ昇格しない。

live E2E完了後にだけ、deployed Worker version id、smoke result、実施日を`project/docs/CURRENT_STATE.md`と`docs/releases/`へ証跡として記録する。
