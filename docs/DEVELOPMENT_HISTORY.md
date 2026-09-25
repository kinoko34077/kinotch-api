# kinotch-api 開発・変更・リリース履歴

- 対象: kinoko34077/kinotch-api
- 履歴基準: origin/main の first-parent 履歴
- 作成時点: 2026-09-24
- 作成時点の先頭: 088943a27f03bb5e3c3d21ec63b12326c61fa982
- 収録コミット数: 123

## この文書の読み方

この文書は、Gitで追跡できる変更を再現可能な形でまとめたスナップショットである。コミットの順序・SHA・日付・subjectは git log の出力をそのまま基礎にし、実装上の意味は既存の仕様書、テスト、release metadataを照合して整理している。

Gitはcommitとrefを記録するが、GitHubへいつpushされたかという全pushイベントの監査履歴をcommit objectだけから完全には復元できない。そのため、以下を分けて扱う。

- 変更履歴: origin/main から取得したfirst-parent commitの全件。
- 本番反映の証拠: trackedな docs/releases/*.json の gitRevision、status、Worker Version。
- GitHub検証: commitに紐づくActionsの実行結果。push時刻そのものの代替にはしない。
- 外部設定: Cloudflare Access、GitHub branch protection、Workers Builds等。repo文書だけで設定済みとは扱わない。

既存の CHANGELOG.md はCloudflare移行と旧Worker凍結を中心にした運用記録であり、本書はrepoのcommit履歴を網羅するGit-firstの記録である。

## 現在地

作成時点では、実装・運用の大きな到達点は次のとおり。

- Hono Gateway、Text Transform Worker、Semantic Compression Worker、Remote MCP Workerを同一repoで管理。
- 通常のProduction authorityは npm run deploy:production に一本化。
- REST Compression APIは POST https://api.kinotch.workers.dev/v1/compress。
- Remote MCPはCloudflare Access保護下の /mcp とし、compress_textを提供。
- Compressionは compact-v1 / semantic-dense-v1、Gemini gemini-3.5-flash-lite、thinking_level=minimal、store:falseを固定。
- 最新Production metadata（コード履歴上の直近記録）は docs/releases/20260923T182557522Z.json で、source revisionは 204d15eb382802aa776d5026421e197d52725300。現行main `088943a27f03bb5e3c3d21ec63b12326c61fa982` の後続修正はProductionへ未反映である。
- 現行main `088943a` のGitHub Actions `CI` と `Verify` はsuccess。Base-managed Verifyのcheckout SHA pinはBase側で `60592ce` に反映済みで、個別repoのv0.3.8 snapshotは一括同期していない。
- a56cdd3 は本履歴と利用ガイドを公開し、284e27c は文書公開計画を完了した。
- c15a100 はCompression provenance、release child secret isolation、MCP pre-parse body guardを実装した。
- 263b98a はhardening実装計画の完了記録を追加した。
- f8e7c3c はProduction smokeの対象Workerを固定し、38dd1fa はその計画を完了した。
- 2298101 はrelease child環境のallowlist化、deploy結果のremote reconciliation、rollback後のactive Version／非課金recovery smoke検証、Node 22.18.0固定、MCP actor fingerprint rate limit、MCP endpoint port拒否を実装した。CIとVerifyはsuccessだが、Production deploy自体はまだ行っていない。
- 99cd489 はrelease reliabilityのCurrent State、Operations、MCP運用、変更履歴を更新した。GitHub main protectionはその後APIでrequired check `verify`を追加し、`test`／`verify`の両方をrequiredとして確認した。
- 852d7e4 はGitHub main protectionのrequired check確認結果をCurrent Stateへ記録した。
- 2da4440 はGemini生成requestをInteractions API安定版 `v1/interactions`へ移行した。固定Promptの`countTokens`測定endpointは`v1beta`のまま維持し、生成endpointとの責務を文書化した。focused regression 34件を通過したが、Production deployはまだ行っていない。
- 088943a はCurrent State、Operations、履歴スナップショットを現行release境界へ更新した。現行mainとProduction metadataの差分を明示し、Production deployはまだ行っていない。

### 8. Production Secret Mapper（2026-09-25）

- Production operator値の反復入力を減らし、agentがsecret file本文を直接参照しない境界を設けるため、固定外部pathの`production-secret-mapper.mjs`を追加した。
- mapperはProduction releaseで7 key（`TEAM_DOMAIN`、`POLICY_AUD`、`MCP_ENDPOINT`、`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`、`COMPRESSION_SMOKE_TOKEN`、`CLOUDFLARE_API_TOKEN`）を扱い、mode別に必要値だけを子processへ渡す。必須key不足・未知modeはfail closed、未知file keyは無視して転送しない。secret値、file本文、`process.env`全体は出力しない。
- `npm run smoke:mcp:local`と`npm run release:local`は既存のMCP smoke／`npm run deploy:production`を起動するlauncherであり、既存release gate（Production release authority、test、dry-run、smoke、rollback）を変更しない。

## 大きな変更段階

### 1. GatewayとText APIの基盤化（2026-09-07〜09-08）

- Hono Gatewayを初期化し、clock、weather、rokuyo等の既存WorkerをService Binding経由で中継。
- Text Transform Worker、Ruby parse、単発・batch transform、capabilities、Tokenizer/Kuromoji Assetsを追加。
- 共通Text client、timeout、fallback、retry、CORS、request ID、response header allowlistを整備。
- route policy、JSON/domain validation、stream実測body limit、Cloudflare Rate Limit、fail-closed、upstream error分類を実装。
- Text Workerをprivate化し、Gatewayのみを公開入口に固定。
- Text Core、rule、dictionary、Kuromojiを含むsnapshot metadata、ruleSetHash、dictionaryHash、sourceRevisionを導入。
- generated snapshot／browser clientのstale check、Golden回帰、production smoke、release metadata、Text/Gateway rollbackを追加。
- 実運用での反映遅延、body 413、direct Worker 404、rate-limit 429、CORS、request ID、snapshot一致を確認。

### 2. Text client・生成物・決定性の強化（2026-09-09〜09-10）

- canonical ESM clientとbrowser IIFEを生成物として統一。
- release atomicityとoffline assetの欠落を補修。
- kanji fallback生成をlocale依存からUTF-16 code unit基準の決定的順序へ変更。
- Text Coreと生成物の互換性をGolden／snapshot checkで固定。

### 3. Semantic Compression APIの追加（2026-09-13）

- 固定contract、Unicode code point count、UTF-8 SHA-256、provenance responseを追加。
- semantic-compression private Workerを新設し、GatewayのCOMPRESSION Service Bindingからだけ接続。
- /v1/compress、COMPRESSION_API_TOKEN、専用body limit、pre-auth/authenticated IP/token fingerprint rate limitを追加。
- Gemini Interactions APIを固定model・固定Prompt・stateless store:false・Provider自動retryなしで呼出。
- malformed response、provider timeout、quota、raw provider error、本文・secret非ログの境界を実装。
- Compression smoke、fake provider integration、Golden fixture、release gate、rollback metadataを追加。
- provider context安全上限、escaped JSON body、live test用専用環境変数を整備。

### 4. Gemini 3.5・usage・評価の実測（2026-09-13〜09-14）

- modelをgemini-3.5-flash-liteへ移行。
- generation_config.thinking_level=minimalを固定。
- quality corpus、long corpus、Candidate評価、Control/Candidate比較のtoolingを追加。
- usage測定をsystem-only／shared-input-prefixへ分離し、15秒既定間隔・429自動retryなしへ整理。
- input_tokens、output_tokens、thought_tokens、cached_tokens、total_tokensを正規化。
- profileをcompact-v1／semantic-dense-v1の2系統へ拡張。
- Prompt token breakdown、countTokens metadata、Prompt SHA、content_input_tokensを追加。
- Compression API仕様書、運用文書、production release metadataを追加。
- rate limit、request boundary、security dependency、GitHub Actions、escaped JSON bodyをhardening。
- 失敗releaseをmetadataへ残し、Service Binding propagation待ちをreadiness retryへ限定して成功releaseを成立。

### 5. Remote MCP adapterの追加（2026-09-23）

- MCP contract、compress_text、strict {text} input、semantic-dense固定を追加。
- Cloudflare Access JWTのissuer／audience／signature／expiration検証を実装。
- stateless Streamable HTTP MCP WorkerとCOMPRESSION Service Bindingを追加。
- MCP WorkerへGemini、Prompt、REST caller token、圧縮処理を複製せず、既存Compression Workerへ委譲。
- MCP rate limit、upstream response validation、safe error、cookie smoke、MCP initialize lifecycleを追加。
- bootstrap deployと通常Production releaseを分離し、Access設定未完了をsuccess扱いしないrelease gateへ変更。
- Codex Managed OAuth、MCP Inspector、Access cookie smokeの手順を文書化。

### 6. KiNoTch Repository Base導入（2026-09-23）

- .kinotch/、AGENTS.md、project/、Base/Project diagnostics、Verify workflowを導入。
- Base version 0.3.4〜0.3.8へ同期。
- API、MCP、CI、generated-integrityの既存責務をProject-owned／Overrideとして明示。
- knt doctor、knt setup、knt verifyをCIへ接続。

### 7. 現行release hardening（2026-09-24）

- MCP smoke endpointを実deploy対象hostへ固定し、検証済みendpointをmetadataへ記録。
- Production release冒頭で npm ci を実行し、lockfile準拠のdependency treeを再構築。
- CF-Connecting-IPがない場合にX-Forwarded-Forを信用せず、rate-limit identityをunknownへ固定。
- MCPのprofileとexpected prompt versionを別定数化。
- MCP smoke errorをstatus／content-type／bounded codeだけへ安全に拡張。
- Current StateとOperationsへCI／Verifyの実測状態を反映。
- Verify workflowはBase管理対象であるため、個別repoでのcheckout SHA pinは取り消し、Base側更新事項として残した。
- Production smokeのGateway／Text／Compression対象はrelease時に固定し、standalone診断時の環境変数overrideと分離した。
- release child process環境はallowlistから再構成し、npm ci・test・buildへrelease専用secretを継承しないようにした。WranglerへはCloudflare credentialだけを限定注入する。
- deploy commandの曖昧失敗ではremote active Versionを再取得してdeploy済み状態を判定し、rollback後はactive Versionと非課金recovery smokeを検証する。
- Node 22.18.0をpackage engines、.node-version、Project-owned CIへ固定した。
- MCPのAccess subject/emailをログへ出さずSHA-256 fingerprint化し、actor単位のrate-limit keyへ優先利用する。安定claimがない場合だけCloudflare IPへfallbackする。
- MCP endpointの明示portを拒否し、Access cookieを誤った送信先へ送らない構造を固定した。

## Production release evidence

以下はtrackedな docs/releases/*.json から確認できる反映記録である。古いmetadataは後から追加されたstatus/version fieldを持たないため、status=fieldなしは成功・失敗を推定する意味ではない。

| metadata | status | gitRevision | Text | Gateway | Compression | MCP |
|---|---|---|---|---|---|---|
| 20260908T044636284Z.json | fieldなし | 488aad3 | — | — | — | — |
| 20260908T045423455Z.json | fieldなし | f4a4907 | fdd927ef | 44448464 | — | — |
| 20260908T050423934Z.json | fieldなし | a6770da | 3801c8f9 | 40a14c9e | — | — |
| 20260908T051457449Z.json | fieldなし | 3bad1c8 | 4c7bf561 | 98422ded | — | — |
| 20260908T052253147Z.json | fieldなし | 8379b55 | c894aa8b | 74f7a77d | — | — |
| 20260908T052729261Z.json | fieldなし | 55aacf7 | a7b5f15f | 5653f519 | — | — |
| 20260908T113518296Z.json | failed | 6c82e17 | 30190cad | — | — | — |
| 20260908T114058242Z.json | succeeded | b60a4c0 | 6c08d383 | d9c2a9a9 | — | — |
| 20260913T112035207Z.json | failed | 965a621 | 6c1aad06 | 65d1c358 | 610e7abd | — |
| 20260913T140641731Z.json | succeeded | 965a621 | 382c6e91 | c1fb8b16 | cf667094 | — |
| 20260913T153053838Z.json | failed | eef619e | 033b762a | db66aa64 | 960d4ce6 | — |
| 20260913T154750359Z.json | succeeded | 7eef9b4 | 25dba63e | ba1ba1ef | 7882022e | — |
| 20260913T224258735Z.json | failed | 9787a7a | — | — | — | — |
| 20260914T002941278Z.json | succeeded | 6ddbddc | 65a08a29 | a3068921 | 34f1222b | — |
| 20260914T152818909Z.json | succeeded | db17352 | 26141b32 | fd23e4cd | 5aadee4f | — |
| 20260923T182557522Z.json | succeeded | 204d15e | 7eebc04e | 21c9d846 | 4658e423 | 48ffebd8 |

## 完全commit inventory

以下は作成時点の origin/main first-parentを古い順に全件収録する。subjectはGit commitの記録を尊重し、推測で書き換えていない。

| # | date | commit | subject |
|---:|---|---|---|
| 1 | 2026-09-07 | 9fff9750612fc080b3f329d4e9545b079be0c9b4 | Initial commit |
| 2 | 2026-09-07 | 40ad37a73bae22ff218f764022891cd673ef95f2 | Initialize Hono API gateway |
| 3 | 2026-09-07 | 4e204d83b25dd143bfae844dd8bb01fd917153a4 | Document API gateway workflow |
| 4 | 2026-09-07 | 85385abecc1ab5ef81b9758853e607391196ac64 | Add comprehensive migration changelog |
| 5 | 2026-09-07 | 0bf8bf9a3c127fb3fdceb95a6d6efb3662c43f18 | Record API build verification |
| 6 | 2026-09-07 | bda824a1ce361bf72f395025e127fab3020aafd4 | Add text transformation API proxy routes |
| 7 | 2026-09-07 | 3c1ec54a42fc24e0311deaf566475bf3f8a48fb9 | Enable tokenizer-backed transforms in Worker |
| 8 | 2026-09-07 | d847787e1515764a98fda6336d417c072a6d67bb | Add batched text transform client API |
| 9 | 2026-09-07 | 94c0c1496c68e1638222d02217a2f8998e37410a | Cover extension profile batch transformation |
| 10 | 2026-09-07 | 0c440979895d4a33efa2bfd0da90abaf53a368bd | Record production text API deployment |
| 11 | 2026-09-07 | 327502b4a189d4fda2defea2fb207cd11d6d66e5 | Add post-deploy golden regression checks |
| 12 | 2026-09-07 | e12c25c30930a240832e56de084bdc0dad523fab | Harden text API client timeout fallback |
| 13 | 2026-09-07 | 5d9533966308fcecddd6a99961422796087e5221 | Track client adapter timeout rollout |
| 14 | 2026-09-08 | b7aba27684ee0214f7ccf04b6b51e264a3c4fe22 | Revise text API hardening roadmap |
| 15 | 2026-09-08 | 625117aadaffc6de291e0b95486ffa0ac5ed6f18 | Align Gateway CORS and verify generated rules |
| 16 | 2026-09-08 | de9a0c8925953661bab7c9b983500211ff4f3e33 | Expose deterministic text rule set hash |
| 17 | 2026-09-08 | ad879d3db01a225ab48dd3cc1ff4d7f74e48bda4 | Record CORS and rule hash deployments |
| 18 | 2026-09-08 | cb7bd4e483aecf61bec4fa997ba1064e1cc0feb7 | Validate API rule set compatibility in clients |
| 19 | 2026-09-08 | 3ce1a5c705a1bcc4883aa41aa49a062819c4aae7 | Record client compatibility deployment |
| 20 | 2026-09-08 | fbd3e9a146e7f587768491742ad9218a5f771a8e | Harden client retries and response validation |
| 21 | 2026-09-08 | a6201d1b9e9dbc2487d52b9c8e769b4d0fd84952 | Document text API operations and observability |
| 22 | 2026-09-08 | 55b01ec5db5aa15be746bf966dbfb6f8d42104f9 | Verify local fallback fixture parity |
| 23 | 2026-09-08 | 1966f998880b9755bc7c4e3307623ee094a3ca6e | Complete gateway guard and release gate |
| 24 | 2026-09-08 | 42be3b32303c2f217d50deaf37b6d2c188c1a1ae | Fix Windows release gate process spawning |
| 25 | 2026-09-08 | 488aad3225fe756b9338d9040effe80fdc36aab5 | Harden private worker boundary smoke |
| 26 | 2026-09-08 | f4a4907de2ae006bef04e5cd8a38e9f61be19e39 | Harden body limits and release metadata |
| 27 | 2026-09-08 | 39d5bb255c9ae722b7bce6f82323e72f5307e084 | Record guarded production release |
| 28 | 2026-09-08 | a6770daeac4e3a68e2a02af7f75facf6d36e0e84 | Generate browser client and classify upstream failures |
| 29 | 2026-09-08 | 871e1596aa67e4a7451515a43d896a5778ba474e | Document final guard verification |
| 30 | 2026-09-08 | 3bad1c80d2d11b400c34240b0b2020bba7802fc7 | Enforce actual request body byte limits |
| 31 | 2026-09-08 | bc9f4991b7000a693fc5cad313554570f5e352b0 | Complete metadata and guard smoke contracts |
| 32 | 2026-09-08 | 8379b559e9ba9df62e70a9bd8c8d16c4207f8e73 | Harden release metadata and guard smoke |
| 33 | 2026-09-08 | a28b09bb92a71678870d6952db97d027639003c6 | Record final guarded release |
| 34 | 2026-09-08 | 55aacf717a9556b6ddc6f5907dc3f4c79395a185 | Fail closed when rate limiting is unavailable |
| 35 | 2026-09-08 | 69f23e726cb8ae1fd77a52796e353b0db0f5436e | Record final fail-closed release |
| 36 | 2026-09-08 | 9bfb5b4bec372c1b5f4f2d1a88220a1302461e21 | Document boundary hardening plan |
| 37 | 2026-09-08 | 70373980683e8fcb6e81a728bf50ec476c5f4494 | Expose Gateway contract headers to browsers |
| 38 | 2026-09-08 | 1519710c5d7d4828e1db60f4f32e0908b6b4ccd7 | Assert private Worker config and source revision |
| 39 | 2026-09-08 | 24cd855192ab068d0df06f895d91a709c39bacd7 | Rollback Text Worker after failed smoke |
| 40 | 2026-09-08 | fe45e6ddb7445e9900992b1192c7325b034809e7 | Add overall deadline to shared text client |
| 41 | 2026-09-08 | 6c82e17f252bc75260f14b37574cff62741bb25c | Verify CORS headers in production smoke |
| 42 | 2026-09-08 | b60a4c0cdd341ad733d24e37b3e714e4e0567044 | Harden smoke propagation and rollback execution |
| 43 | 2026-09-08 | 0d7756697d5fb1fe31c8262755c27311b2775bd6 | Record boundary hardening release |
| 44 | 2026-09-09 | da3fc04ce4ba8056aa9c9f63237c864411600abd | Publish canonical ESM text client |
| 45 | 2026-09-09 | 28dcd23949eaa5095cf4c364defe14aafb2edcf5 | Close release atomicity and offline asset gaps |
| 46 | 2026-09-10 | 96727bd05fedb6979b2c29177e97210a84bf62db | Make kanji fallback generation deterministic |
| 47 | 2026-09-13 | c1f7096ef022866f36565c4f2423e1b4fe20cea6 | docs: design semantic compression API |
| 48 | 2026-09-13 | 8c8e44f04f6f839b9877cc38cccdeb82b2296258 | docs: plan semantic compression implementation |
| 49 | 2026-09-13 | d80393dd52d2f8cb4a02ee349b7f567675815766 | feat: define semantic compression contract |
| 50 | 2026-09-13 | 69b2edd7f96f79df767da716c8d641b4a02e68c8 | feat: add private semantic compression worker |
| 51 | 2026-09-13 | 0eb4436983760bc4134f232074ce262b8bbd9a85 | feat: expose authenticated compression route |
| 52 | 2026-09-13 | d0924767e08b85c2711196adcbe86cb315fe9202 | build: configure private compression worker |
| 53 | 2026-09-13 | 29dc7c959ecb955e9203d44aeecdc67fb5ffcd9d | test: add compression smoke and golden coverage |
| 54 | 2026-09-13 | 3e97e6ec2f086ccf15696f732416f8a7b75e8163 | ci: integrate compression into production release gate |
| 55 | 2026-09-13 | 30af465526aa29a88d766849beb4a4a6765ca5aa | docs: operate semantic compression API |
| 56 | 2026-09-13 | 0969ef97c657162bfe3206d216a3a7353f4c2286 | test: harden compression integration boundaries |
| 57 | 2026-09-13 | 21cf957c0feb3fa69cc72a6e6671fc369cc7d5ef | chore: record compression verification boundary |
| 58 | 2026-09-13 | 6c2fde54fa8c99c260ed01998191f9d93fb89ed9 | fix: harden compression release smoke |
| 59 | 2026-09-13 | 09154dd549663ad1c77beafd02322185b31ff5cd | fix: guard compression provider context size |
| 60 | 2026-09-13 | 49e53effd4b8d3e086271fc05cd366e308bfeb9a | chore: record compression production hardening |
| 61 | 2026-09-13 | 45b5697b5659f46ce16de30609b062e160eaf434 | docs: define production deploy authority |
| 62 | 2026-09-13 | 8f4788b91f666d50e6b55a0e960ca258bd1b2969 | test: isolate compression live-test credential |
| 63 | 2026-09-13 | 17a6882c164bd7cc0fcfb0d774c33870cc5d938e | feat: migrate compression model to Gemini 3.5 |
| 64 | 2026-09-13 | 48f83504d12d33ba2b28f15f31279058876e6c7f | feat: pin compression thinking level to minimal |
| 65 | 2026-09-13 | 203d004fab8a0992717f5fab2be9559acaeae2bf | test: add semantic compression quality evaluation corpus |
| 66 | 2026-09-13 | bc34bd03ec1d042b7aace39389474f4d8b5c0beb | test: expose safe compression usage measurements |
| 67 | 2026-09-13 | 15003c32fd68c066ef744f8ef1c9c58258703691 | test: split compression usage scenarios |
| 68 | 2026-09-13 | 9c87b94ba0f816648a67e853d80836d5fdb085d7 | test: pace compression measurements after rate limits |
| 69 | 2026-09-13 | 84b7e08597622f52948dcbe645dca368abc95654 | chore: ignore local compression evaluation artifacts |
| 70 | 2026-09-13 | cb5bfe1d9d427412e7a754e36250163a5956d7a7 | docs: record compression measurement evidence |
| 71 | 2026-09-13 | 995d99a7f3624034b1adb9342479cbd2a2babea1 | test: add compression baseline analysis and long corpus |
| 72 | 2026-09-13 | 0265b749195f1618b1c632d09c0d97d25914e139 | test: add candidate compression prompt evaluation |
| 73 | 2026-09-13 | d5f8f452194da901f430de106545c03f8671fc4f | test: tighten candidate field preservation |
| 74 | 2026-09-13 | 570935b367d5c0078a7e422c5a521ce168689c1e | test: record compression quality comparison tooling |
| 75 | 2026-09-13 | 93a8e0b8c1b39c43de69cb3496adecd6fa18be2a | test: align quality review with observed outputs |
| 76 | 2026-09-13 | 965a621ebc80c69dc045c9c66d6152476c54882b | feat: expose dual compression profiles and usage |
| 77 | 2026-09-13 | 8b66fb22c0b034755e6f6bf1b8848f82a9bfffab | docs: record compression production release |
| 78 | 2026-09-14 | eef619e3277ee8de2429a947d15842640c88d16b | feat: expose compression prompt token breakdown |
| 79 | 2026-09-14 | fc10ddd88e7fc205eade62fb2dc49443d97d46ef | docs: record failed prompt token release |
| 80 | 2026-09-14 | 7eef9b4af97b90ecbe00bc67d5dae5635b1cdb16 | fix: allow service binding propagation before compression smoke |
| 81 | 2026-09-14 | c80a1237b21928b5c8e5a16fc6146da564231275 | docs: record prompt token release |
| 82 | 2026-09-14 | a579a06a1fddd1d198dd493b92907a010f071fe5 | docs: publish semantic compression API specification |
| 83 | 2026-09-14 | 401770a20ff35d339c70d81aabeb02c2c3848077 | fix: harden compression rate limiting |
| 84 | 2026-09-14 | 4fa14dc7135da4893d94f9f0e67c21e917840ed5 | fix: harden compression request boundaries |
| 85 | 2026-09-14 | 16a3b0c4f8c113213d2e0ce37bc70492f3ce70a6 | chore: update wrangler security dependency |
| 86 | 2026-09-14 | 9787a7dd6870314e5d0b4ac7a8277cac3bb5e43a | ci: pin GitHub actions to verified commits |
| 87 | 2026-09-14 | e5b9def14afd91bdaf630a3b74a6a190601e65d0 | ops: record failed security release |
| 88 | 2026-09-14 | 6ddbddce8d8a418d4d93b6e36fe6f12b452220d9 | fix: account for escaped compression request bodies |
| 89 | 2026-09-14 | db173521842a10844d7d13859e3541f0949fbc9d | ops: record successful security release |
| 90 | 2026-09-15 | d2464cc2c492f955528aa57802a002e1946f5b6f | ops: record repeat security release |
| 91 | 2026-09-23 | 4278aa82611fed6656c15ab5c5fd870ae86dce43 | test: probe Runtime contract semantics |
| 92 | 2026-09-23 | e6ad244c5fabe3c7b19bc67252f5cfc0d52ba394 | feat: add semantic compression mcp contract |
| 93 | 2026-09-23 | 4826728d5636524312626ec18923d15ac4f9496c | feat: add access auth and compression mcp adapter |
| 94 | 2026-09-23 | 81e0289e7ab4767d7c30890b368d71434549c1ad | feat: add stateless semantic compression mcp worker |
| 95 | 2026-09-23 | 0298d5b453e8b2fc7459c0cdbc0c8db0f3eabf5e | feat: integrate semantic compression mcp into release gate |
| 96 | 2026-09-23 | 4e872b78eba208af1a3dfc7953106e8abd10b1c4 | test: add authenticated semantic compression mcp smoke |
| 97 | 2026-09-23 | 99c8b3717f4ab64dbb06b34295ea703a395301cd | docs: remove plan trailing whitespace |
| 98 | 2026-09-23 | 92c60abc377007461b147121042ae95491fcdd70 | fix: gate semantic compression mcp release |
| 99 | 2026-09-23 | 06f0bff60316a5289d45e367679f5d0d8caf9843 | fix: harden compression semantic boundary |
| 100 | 2026-09-23 | 1ce99cd563d9d9fe29b9bd049533d5e54c8363ab | fix: bind production releases to main |
| 101 | 2026-09-23 | 3a4c529e1e1885b9e931f64c6ba21d2c02707010 | fix: separate MCP bootstrap from production release |
| 102 | 2026-09-23 | 2eb9676188aee2aa11203e7bc1a21e2915fb75b5 | docs: close MCP bootstrap lifecycle plan |
| 103 | 2026-09-23 | 77cd89fea011edcd7b0c60473bac0cd4340ffec1 | fix: harden remote MCP compression boundary |
| 104 | 2026-09-23 | 8bf82e8a24d75f4922c454c4f0624d8ede186bc6 | chore: adopt KiNoTch Base in kinotch-api |
| 105 | 2026-09-23 | 6d3911f5e0cae17169b2971bfa40329c8e6b23d4 | chore: align kinotch-api with Base v0.3.4 |
| 106 | 2026-09-23 | 117e2f5136504ee93acf057aacef76cd0c76bb10 | chore: sync Repository Base v0.3.5 |
| 107 | 2026-09-23 | 188b3c9131cb81b9f12147acf0fe833134c892f5 | chore: sync Repository Base v0.3.7 |
| 108 | 2026-09-23 | 204d15eb382802aa776d5026421e197d52725300 | chore: sync Repository Base v0.3.8 |
| 109 | 2026-09-24 | a5e2dbe6340ded6e18b1a9e143fcddcfc50e4333 | chore: record production release |
| 110 | 2026-09-24 | c8ae4aa942fbc9012ad22e42eff5c4a8caefa432 | fix: harden MCP production release checks |
| 111 | 2026-09-24 | b7795fc68ec36141b86a1ffb8e849612575d3d69 | docs: record release hardening and verify gate |
| 112 | 2026-09-24 | 7d474f49eefc976acc970cf3a69635111d347a3a | chore: respect Base-managed Verify workflow |
| 113 | 2026-09-24 | a56cdd3e606dfd12972d17ac6fd9eeb1452bc4a2 | docs: publish repository history and usage guide |
| 114 | 2026-09-24 | 284e27cc5299029dd704f84d8b916e7e08878f30 | docs: close documentation publication plan |
| 115 | 2026-09-24 | c15a1002148fad5cc91996b553a14b90baf4a77f | fix: harden compression provenance and release boundaries |
| 116 | 2026-09-24 | 263b98a49a12da9c57f13799882fc71bee88c98c | docs: close hardening implementation plan |
| 117 | 2026-09-24 | f8e7c3c947376156436f3aee1dc9a1c205d9c58e | fix: bind production smoke to fixed endpoints |
| 118 | 2026-09-24 | 38dd1fa66d3e5cdd678b9cf1543c4ad6c0681fc6 | docs: close production smoke target plan |
| 119 | 2026-09-24 | 2298101b1e6cbfac2911436cace2bf4f838a2807 | fix: harden release reliability boundaries |
| 120 | 2026-09-24 | 99cd48910e57c4def88bfc6c48ecdca80db93303 | docs: record release reliability state |
| 121 | 2026-09-24 | 852d7e4157a7af4c2425309e66a35ecd68518b58 | docs: record main protection verification |
| 122 | 2026-09-24 | 2da444092577ba335c802f901afaf08c2c0fe9f2 | fix: use stable Gemini interactions endpoint |
| 123 | 2026-09-24 | 088943a27f03bb5e3c3d21ec63b12326c61fa982 | docs: refresh current release state |

## 再生成・更新

履歴を再取得する場合は、repo rootで次を実行する。

~~~powershell
git fetch origin main
git log --first-parent --reverse --date=short --pretty=format:"%H|%ad|%s" origin/main
Get-ChildItem docs/releases -File | Sort-Object Name
~~~

この文書自身の公開commitは、そのcommitを含む次回の履歴スナップショット更新時にinventoryへ追加する。pushイベントの正確な監査が必要な場合は、GitHubのAudit Log／EventsとCloudflareのdeployment historyを別途参照する。
