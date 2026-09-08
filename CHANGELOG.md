# Cloudflare移行・API運用変更履歴

この記録は、Cloudflare旧Accountから新Accountへの移行、`standby-display`の共通API化、
旧側Workerの凍結、GitHub管理、自動デプロイ設定までを時系列でまとめたものです。
Cloudflareの時刻はUTC、括弧内に日本時間（JST、UTC+9）を記載します。

## 現在の構成

```text
standby-display main
  └─ Workers Builds自動デプロイ
       └─ standby-display.kinotch.workers.dev
             └─ api.kinotch.workers.dev
                  └─ Service Binding: clock-server / weather-proxy / rokuyo-proxy

kinotch-api main
  └─ Workers Builds自動デプロイ設定済み

旧Account
  ├─ clock-server / weather-proxy / rokuyo-proxy / legacy-clock: HTTP 410で凍結
  └─ detemuhann-redirect: 変更せず稼働継続
```

## 2026-09-08（Gateway関門・snapshot互換性・release gate）

- Gatewayの全公開routeをroute Policy経由へ統一し、method guard、lat/lon/dateのdomain validation、JSON schema validation、POST body byte limitを追加。
- GatewayにCloudflare Rate Limit bindingを追加。一般routeは60 requests/60 seconds、Text routeは30 requests/60 secondsをIP単位で制限し、超過時は429／Retry-Afterを返す。
- request IDを生成・検証してGatewayからService Bindingへ伝播し、`Content-Type`、cache、ETag、Retry-After、RateLimit、request IDだけを下流レスポンスから転送。
- Gatewayのquery redactionと構造化request/error logを有効化し、本文・query stringをログへ残さない運用へ統一。
- `text-transform`を`workers_dev:false`へ変更し、Gateway Service Bindingを唯一の公開経路とする構成へ移行。
- Text Coreのengine／shared／dictionary／Kuromoji／rulesからsnapshot hashとdictionary hashを生成し、Workerのcapabilities／transform／rubyレスポンスへmetadataを追加。
- common clientの429即時retryを廃止し、Retry-Afterがある場合だけ待機、5xx／通信失敗はbackoff+jitterで再試行する契約へ変更。snapshot hash不一致もlocal fallback対象に追加。
- batch transformでruntime planをbatch単位に再利用。
- `deploy:production`とproduction smokeを追加し、生成物check、全テスト、dry-run、Text Worker、境界確認、Gateway、最終smoke、release metadata記録を単一手順化。

## 2026-09-07（本番後検証・Golden回帰）

- `text-transform` Workerの本番後ベンチマークを再実行。
  12,000文字で初回3.45秒、暖機後5回平均273msを確認。
- 送り仮名の活用形、語彙置換、旧字体、長音省略、表層正規化、ルビ解析の代表結果をGolden回帰テストへ追加。
- APIレスポンスの`engineVersion`とprofileの追跡をテストで固定。
- 本番Gateway経由のbatchを5回再確認し、全てHTTP 200。初回コールド約3.28秒、暖機後平均約40msを記録。
- 共通APIクライアントに既定8秒のAbortControllerタイムアウトを追加し、停滞時のfallback切替をテストで固定。

## 2026-09-08（ロードマップ改訂）

- Gateway CORS、Text Coreの正本・hash管理、generated ruleの検証、2 Workerの同期deploy、クライアント配布・プライバシー境界、batch最適化の順に実施する計画へ整理。
- 歌詞Readerと`historical-kana`は基盤整備後の後段として継続保留。

## 2026-09-08（Gateway契約・rule生成検証）

- Gateway CORSをPOST API契約に合わせ、ブラウザのPOST preflight回帰テストを追加。
- `check:text-rules`を追加し、`npm test`前にJSON5 sourceとgenerated ruleの一致を検証するよう変更。
- Gateway CORS修正版をデプロイ。Version ID: `6eb4a53b-e70c-4b22-955c-379cff6b9bd2`。Origin付きPOST preflightとbatch POSTを本番で確認。
- rule sourceからSHA-256の`ruleSetHash`を生成し、capabilities／transformレスポンスへ追加。
- ruleSetHash対応Text Transform Workerをデプロイ。Version ID: `e788d84c-a0e9-4e81-bb89-de8ee9ca9e95`。Gateway経由でcapabilitiesとbatchレスポンスのhash一致を確認。
- Ruby parseレスポンスにもruleSetHashを付与し、共通clientでhash不一致時に`rule_set_mismatch`としてfallbackする契約を追加。
- Text WorkerのRuby parse対応版を再デプロイ。Version ID: `4f04a7ef-3ab3-4edd-9d22-3c83265e5d41`。Gateway経由でRuby parseのruleSetHashを確認。
- 共通clientに一時障害の最大1回再試行と、transform／batch／rubyレスポンス形状の検証を追加。
- `docs/OPERATIONS.md`を追加し、本番疎通、遅延、Observability、本文非ログ、拡張機能再読み込みの確認手順を整理。
- 3件batchの本番再計測で、初回約1.82秒、暖機後平均23.9ms、異常profileの400応答を確認。
- `txt-auto-replace`のlocal runtime全fixture合格を確認し、API側に活用形・語彙・長音・旧字・句読点のfallback互換Goldenを追加。全27テスト合格。

## 2026-09-06（移行開始・新Account構築）

### 14:43:52 UTC（23:43:52 JST）

- 新Accountへ`clock-server`を移行。
- Version ID: `916668e0-e015-4d46-b4c2-d7d2ea931db8`

### 15:06:42 UTC（翌日00:06:42 JST）

- 新Accountへ`rokuyo-proxy`を移行。
- Version ID: `111109cd-1363-4353-b707-da023981a58b`

### 15:09:49 UTC（翌日00:09:49 JST）

- 新Accountへ`legacy-clock`を移行。
- Version ID: `a4ec8e90-a335-4dae-bde5-d087748ce0ec`

### 15:12:31 UTC（翌日00:12:31 JST）

- 新Accountへ`detemuhann-redirect`を移行。
- Version ID: `1cdf9a6c-0918-43fd-9c44-e6ddf5362601`

### 15:14:12 UTC（翌日00:14:12 JST）

- 新Accountの`weather-proxy`へ`OPENWEATHER_API_KEY` Secretを登録。
- Secret変更Version ID: `51534517-ea8e-4f27-81c9-65e54cf3fab7`

### 15:14:41 UTC（翌日00:14:41 JST）

- `weather-proxy`をSecret参照版として再デプロイ。
- Version ID: `20feffa8-02a1-44c4-94e5-25b180a07a86`

### 16:15:46〜16:16:11 UTC（翌日01:15:46〜01:16:11 JST）

- 旧Account側5 Workerを、旧本体処理から最小リダイレクト構成へ変更する準備版をデプロイ。
- `legacy-clock`: `e371711a-877b-4f1a-b227-0dce419b93af`
- `detemuhann-redirect`: `4817f989-d93f-4188-a4ca-b90891913f16`
- `rokuyo-proxy`: `aba85679-5578-44ac-a0a8-b26a5e0ce519`
- `clock-server`: `e371711a-877b-4f1a-b227-0dce419b93af`
- `weather-proxy`: `314a915a-911e-48f7-bcd9-a1928a58ce21`

### 16:18:07〜16:18:39 UTC（翌日01:18:07〜01:18:39 JST）

- 旧Account側を最小リダイレクト構成として確定。
- `clock-server`: `9eb27dd1-d6f6-40ae-b754-bef9084fcfe2`
- `detemuhann-redirect`: `0aedf17a-3f8f-4ffe-9344-e474971c9af5`
- `legacy-clock`: `abe5d777-9050-4232-b8d9-e20f457cd635`
- `rokuyo-proxy`: `9227226f-8135-4dc4-8777-d0d0033007ac`
- `weather-proxy`: `0973e1e3-58f2-48cc-995e-60ff9c78d55e`

### 16:27:25 UTC（翌日01:27:25 JST）

- `detemuhann-redirect`から警告表示を除去。
- 警告なしの即時308転送へ変更。
- Version ID: `50c88f7f-0b6b-4657-b0c5-23f575e8a105`

## 2026-09-07（standby-display・Gateway・自動化）

### GitHub履歴（JST）

| 時刻 | Commit | 内容 |
|---|---|---|
| 00:34:29 | `e4fdf78` | ランダム色範囲スライダーのグラデーション追加 |
| 00:59:01 | `7dc0a71` | ランダム色切替時の再ロール |
| 01:08:02 | `f7bf162` | API参照先を新Accountへ変更 |
| 01:21:06 | `e880d07` | API Endpoint管理と色操作の整理 |
| 12:26:10 | `5e4e99b` | 旧iPad向けlegacy表示フォールバック統合 |
| 13:49:54 | `c3ce9e0` | 共通API Gateway経由へ切替 |
| 18:28:33 | `3ea12e7` | Gateway endpoint module wiring修正 |
| 19:25:49 | `74c029c` | 自動デプロイとAPI手動デプロイの責任境界を文書化 |
| 19:44:51 | `5f41999` | Workers Builds接続済みの運用注記を追加 |

### API GatewayのCloudflare履歴

| 時刻（UTC / JST） | Version ID | 内容 |
|---|---|---|
| 04:31:20 / 13:31:20 | `e73cb3c6-8138-4e64-bce5-b263f637df97` | 初回アップロード |
| 04:35:53 / 13:35:53 | `23fbabbe-10fb-4ee1-9ab9-efc6fb96c17e` | Hono Gateway初版 |
| 04:41:42 / 13:41:42 | `820b576f-c7d9-4efe-a129-08041ab2f062` | Hono Gateway更新 |
| 04:44:28 / 13:44:28 | `c114a1e2-1ddb-4565-8d0f-255b077d7bb8` | Service Binding経路化 |
| 04:45:18 / 13:45:18 | `e4b96797-8188-4244-928a-8885cd420301` | Service Binding経路更新 |
| 09:15:57 / 18:15:57 | `869c937a-ae1d-4015-b09d-3a31afded49f` | Gateway初回手動デプロイ |
| 09:19:25 / 18:19:25 | `8ff1295b-759a-4274-a159-6e0be2e372a1` | 公開URL fetch失敗をService Bindingへ修正 |
| 10:17:00 / 19:17:00 | `38b880e7-80aa-4e0a-9c10-61ecfdf0e4bd` | routes/services/middlewareへ責務分離 |

### standby-displayのCloudflare履歴

| 時刻（UTC / JST） | Version ID | 内容 |
|---|---|---|
| 02:50:08 / 11:50:08 | `79e650f9-3805-4c1b-a6a4-205c7eff0554` | Static Assets初回公開 |
| 04:17:20 / 13:17:20 | `b028f070-868f-4975-84f9-7e1d0a532a27` | 更新デプロイ |
| 04:50:46 / 13:50:46 | `7840c7a9-7abb-4dac-84ef-2a5386d49a8e` | Hono API Gateway利用版 |
| 09:20:25 / 18:20:25 | `80795ec0-18b0-48cc-9c41-917c82b4069d` | Gateway配線修正版 |
| 10:45:10 / 19:45:10 | `32ec888c-fa18-4927-b08e-0b542e1c34d4` | Workers Builds初回自動デプロイ |

### 12:14:59〜12:15:00 UTC（21:14:59〜21:15:00 JST）

- 旧Account側4 Workerのリダイレクトを物理停止。
- 旧URLへのアクセスはHTTP 410、Locationなしとした。
- `clock-server`: `60687a87-f3fb-40f7-a553-8026a17e7145`
- `weather-proxy`: `e2f1282b-7588-439f-a253-38749d95fb68`
- `rokuyo-proxy`: `50e26bfd-45f7-4d9e-98f6-6e7930ce178b`
- `legacy-clock`: `210f6d9a-4946-4827-be56-2757662d2668`
- `detemuhann-redirect`と新Account側Workerは変更していない。

### 18:17〜21:18 JST頃

- `kinotch-api`専用リポジトリを初期化。
- `40ad37a`でHono Gateway本体、テスト、Wrangler設定を初期登録。
- `4e204d8`でREADMEと`.gitignore`を追加。
- GitHubへpush済み。
- 自動デプロイ設定はGitHub連携後、`main`・`npm test`・`npx wrangler deploy`・プレビュー無効で構成。
- Cloudflareダッシュボード上で`kinoko34077/kinotch-api`接続済み。

## 旧AccountのCloudflare履歴（取得できた全件）

Cloudflareが保持していた旧本体版のうち、移行作業に関係する履歴を記録する。

### `clock-server`

- 2025-05-05 03:21:38 UTC（12:21:38 JST）: `d9fbf250-03c9-4fcd-b17c-d20f42e0d210`
- 2025-05-05 03:21:40 UTC（12:21:40 JST）: `f7b54080-1f9f-40ca-b366-cca642756a07`
- 2025-05-05 03:21:59 UTC（12:21:59 JST）: `ec6c3b59-5b90-4d82-b37a-9bf8ec34051b`
- 2026-09-06 16:15:46 UTC（翌日01:15:46 JST）: `e371711a-877b-4f1a-b227-0dce419b93af`
- 2026-09-06 16:18:07 UTC（翌日01:18:07 JST）: `9eb27dd1-d6f6-40ae-b754-bef9084fcfe2`
- 2026-09-07 12:14:59 UTC（21:14:59 JST）: `60687a87-f3fb-40f7-a553-8026a17e7145`（410凍結）

### `weather-proxy`

- 2025-05-05 02:37:15 UTC（11:37:15 JST）: `2c526425-7c48-4645-8f45-df3c1c405e7b`
- 2025-05-05 02:37:17 UTC（11:37:17 JST）: `bc4d2767-fe1c-4ea0-b74b-2c28c59062e3`
- 2025-05-05 02:39:25 UTC（11:39:25 JST）: `8d760e48-8db2-48a6-97b8-6ca8154f76b6`
- 2026-09-06 16:16:11 UTC（翌日01:16:11 JST）: `314a915a-911e-48f7-bcd9-a1928a58ce21`
- 2026-09-06 16:18:38 UTC（翌日01:18:38 JST）: `0973e1e3-58f2-48cc-995e-60ff9c78d55e`
- 2026-09-07 12:14:59 UTC（21:14:59 JST）: `e2f1282b-7588-439f-a253-38749d95fb68`（410凍結）

### `rokuyo-proxy`

- 2025-05-04 18:00:02 UTC（05-05 03:00:02 JST）: `bf794650-c3ad-474d-aba9-50fff6391655`
- 2025-05-04 18:00:04 UTC（03:00:04 JST）: `32a8b8c0-37fe-4635-9b29-184d625456fb`
- 2025-05-04 18:00:35 UTC（03:00:35 JST）: `88930154-9db1-4426-8e13-76d2bfc72f10`
- 2025-05-04 18:03:45 UTC（03:03:45 JST）: `1f719a5d-0736-4287-aed4-9724e07d71eb`
- 2026-09-06 16:16:05 UTC（翌日01:16:05 JST）: `aba85679-5578-44ac-a0a8-b26a5e0ce519`
- 2026-09-06 16:18:30 UTC（翌日01:18:30 JST）: `9227226f-8135-4dc4-8777-d0d0033007ac`
- 2026-09-07 12:14:59 UTC（21:14:59 JST）: `50e26bfd-45f7-4d9e-98f6-6e7930ce178b`（410凍結）

### `legacy-clock`

- 2025-05-05 01:16:32 UTC（10:16:32 JST）: `3106568d-4a19-4d9f-8629-de3f84e2b157`
- 2025-05-05 01:18:59 UTC（10:18:59 JST）: `e8222dae-147b-406a-b080-9c4bd6010721`
- 2025-05-05 02:05:09 UTC（11:05:09 JST）: `fe913532-c873-4b68-bdef-2a9010e70604`
- 2025-05-05 02:08:51 UTC（11:08:51 JST）: `7787a131-b82f-4a07-862c-002de1c1ca78`
- 2025-05-05 02:10:05 UTC（11:10:05 JST）: `82c40989-73d8-4cde-ab73-b4e63afdafae`
- 2025-05-05 02:12:54 UTC（11:12:54 JST）: `50c48a78-d7e6-4d76-a41a-cb170cd749e5`
- 2025-05-05 02:18:11 UTC（11:18:11 JST）: `bf6f83ba-4a20-4c23-90cb-1450e20b13f6`
- 2026-09-06 16:15:58 UTC（翌日01:15:58 JST）: `0f1f59a8-0d9a-4300-a757-13e22b8cddbe`
- 2026-09-06 16:18:24 UTC（翌日01:18:24 JST）: `abe5d777-9050-4232-b8d9-e20f457cd635`
- 2026-09-07 12:14:59 UTC（21:14:59 JST）: `210f6d9a-4946-4827-be56-2757662d2668`（410凍結）

### `detemuhann-redirect`（変更対象外、履歴のみ）

- 2026-04-13 12:16:28 UTC（21:16:28 JST）: `7b6d6b6d-33ec-4022-9bc6-0a200696bda8`
- 2026-04-13 12:17:56 UTC（21:17:56 JST）: `e56d2ef1-229e-4eb8-94ee-c71fc86f547c`
- 2026-04-14 16:34:33 UTC（翌日01:34:33 JST）: `3bf11736-af7f-4b98-a384-42af2dfa9fb7`
- 2026-04-14 16:37:32 UTC（翌日01:37:32 JST）: `0fa07adc-949d-482c-b38b-6730016502d8`
- 2026-04-14 17:00:16 UTC（翌日02:00:16 JST）: `67e51d70-a344-478a-b12e-eb41c4dc8fff`
- 2026-04-14 17:07:10 UTC（翌日02:07:10 JST）: `411adfcf-9d8f-4672-8bab-0fc2276a08f0`
- 2026-04-14 17:07:20 UTC（翌日02:07:20 JST）: `a526414f-886c-4ad3-ad29-f45bc13fb7d0`
- 2026-09-06 16:15:52 UTC（翌日01:15:52 JST）: `4817f989-d93f-4188-a4ca-b90891913f16`
- 2026-09-06 16:18:12 UTC（翌日01:18:12 JST）: `0aedf17a-3f8f-4ffe-9344-e474971c9af5`
- 2026-09-06 16:27:25 UTC（翌日01:27:25 JST）: `50c88f7f-0b6b-4657-b0c5-23f575e8a105`

## 検証結果・残課題

- API Gatewayのhealth、時刻、天気、六曜、月情報は本番`200`を確認済み。
- `standby-display`の互換性テスト13件、`kinotch-api`の単体テスト4件が成功。
- 旧Account側4 Workerは410、`detemuhann-redirect`は308、新Account側は200を確認済み。
- `standby-display`のWorkers Builds自動デプロイは初回成功済み。
- `kinotch-api`のWorkers Builds接続は設定済み。`85385ab`を対象に初回ビルド成功を確認。
- Build ID: `68776146-5b69-411c-b684-b616346dd82e`
- 旧端末版の天気・フォント問題は本記録時点では未対応。
- iPad第3世代など実機確認は未実施。

## 記録上の限界

Cloudflareの`wrangler deployments list`で取得できた履歴を収録した。Cloudflareが保持していない
操作画面のクリック時刻、GitHub OAuthの認証時刻、会話内のすべての中間操作時刻は、厳密な時刻として
復元できないため、確認できたGit commit時刻・Worker作成時刻・検証時刻を基準に記録している。
