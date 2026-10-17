# KAEP P3-B H2 — 実Producer／認証・無料枠の採用判定

正本: [kinotch-api #85](https://github.com/kinoko34077/kinotch-api/issues/85)。親: [devflow #680](https://github.com/kinoko34077/devflow/issues/680)。前工程: [H1 fake-only contract](./KAEP_AGENT_VIEW_H1.md)。本書は**実装方式の実現可能性・保留条件**を記録し、本番接続の承認ではない。

## 結論

- **採用すべき分離:** KAEP原典読取・actor/recipient/reply検証は既存devflow Python reader側のProducer責務。Gatewayは既存 `kaep.agent-current-view.v0.1` を認可された受信者へ投影する責務。WorkersからローカルPythonを直接起動する前提は採用しない。
- **否定:** 公開Cloudflare Workerから、認証なしのGitHub RESTを利用して、40公開リポジトリの新着を毎分全件取得する方式は、下限呼出し数だけでGitHubの基本Rate上限を上回る。原典／履歴の全面取得はさらに重い。
- **保留:** キーを各repoへ登録せずに無人Producerを継続する正式経路は未受入。認証・GitHub Appインストール・Cloudflare Bindings/Secret・Cron・Webhookは未承認の実環境操作。どの方式もまだ `H3_READY` にしない。
- **継続可能な部分:** GitHub原典を既存認証経路で一回限り読むことと、fake producerを使うH1レスポンス契約のofflineテスト。これらは自動配備・モデル受信・本人性を意味しない。

## 数量根拠

参照（2026-10-17時点、正式枠の**一般値**であり当該アカウントの実測残枠ではない）:

- [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api): 公開GETの認証なし基本値60回／時／送信元IP。GitHub Actions組込 `GITHUB_TOKEN` は原則1000回／時／repoであり、任意のcross-repo・外部HTTPへの認証を保証しない。GitHub App installationやOAuth認証は別途作成・権限・token保持の承認が必要。
- [Cloudflare Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/): 無料の目安は10万リクエスト／日、CPU 10ms／リクエスト、外部subrequest 50／リクエスト。実契約・既存アカウント残枠や将来変更は別検証。

既存の `devflow #680` 所有者PCでの一回限りの公開40リポ履歴走査は**129 GitHub REST GET**、174件の未検証KAEP marker候補。これは未処理依頼174件を意味しない。

最低でも、所有者repo一覧取得1回＋40repoの最新コメント各1回だけで1巡41 GET（Issue全コメント・actor検証・返答追跡は**含まない**）。毎分継続すると `41 × 60 = 2460 GET／時`、5分間隔でも `41 × 12 = 492 GET／時`。認証なし60回／時を大幅超過する。初回履歴全走査129 GETは単一Worker呼出しでの無料外部subrequest上限50も超過。並列化・時間分割してもGitHub Rateと証拠の有効時点は別問題。

実装テストは `src/kaep/producer-feasibility.js` と `test/kaep-producer-feasibility.test.js` に下限・無効引数・Host権限未証明の判定を固定。いかなる入力でも `can_authorize_deployment=false`、`http_endpoint_deployed=false`、`admission=HOLD_H3_HOST_IDENTITY_AND_SOURCE_PROOF` を維持する。これはライセンスや課金上限の公式計測器、実API Rate monitor、本番レートリミッタではない。

## 候補方式と依存関係

| 方式 | 再利用範囲 | 未達・安全上の課題 | 現時点判定 |
|---|---|---|---|
| A. 既存owner PCで要求時の認証済み `gh`＋devflow CLI | 原典検証実証済、資格情報を追加しない | 稼働中のユーザー／AIから起動する必要。無人で毎分動くHostを証明しない | **一回限りの要求時GETのみ可** |
| B. GitHub Actionsイベント／組込GITHUB_TOKENによるbounded Producer | 各repoに独立の長期secret不要 | 全公開repoのイベントを中央へどう届かせるか未証明。ワークフロー設定/Actions利用枠/継続起動・中央読取権限を別評価 | **offline案のみ** |
| C. 中央GitHub App/OIDC + `kinotch-identity` + Cloudflare private Worker/cache | 単一Broker、operation-scopedの原典read、原則repo個別secret不要 | Appインストール・Identity／Issuer・署名検証・secret custody・server-side認可・フリープラン測定・失効運用が未受入 | **H3実設定はHuman security gate** |
| D. 認証なし公開Workerが都度40repo API取得 | 常駐ホスト不要 | GitHub Rate不足、Worker無料subrequest不足、呼出し元認可なし | **通常候補から除外** |

## 分離すべき4つの証明

1. **Producer本人性と原典真正性:** 原典読取は対象repo/Issue固定、GitHub actor/recipient/replyまで既存devflow codecで検査。Providerトークンや無制限GET proxyを返さない。Producerの出力がfake/unverifiedな場合H1は本番証明にならない。
2. **更新と鮮度:** `observed_at` は原典GETの時刻。Producerが止まった、最新1〜3ページ上限・40Issue cap超過、コメント編集・Issue閉鎖未走査なら `PARTIAL_UNKNOWN` / stale / 503。保存時刻を現在時刻に上書きして鮮度を捏造しない。
3. **受信者認可:** Hostは既存正式認証middlewareからprincipalを受取り、サーバー側でrecipientを固定・照合する。リクエストJSONに `verified:true` と書くだけでは不可。異なる宛先や認可scopeのcache/ETagを共有しない。既存公開CORS `*` を秘匿ルートへ流用しない。
4. **権限・料金・可用性:** source read（GET）は書込Claimを付与しない。GitHub secondary limit、429/403、Cloudflare CPU/サブリクエスト、10万/日枠、障害/再送/backoffに関する実ホストの測定が必要。Paid Providerを自動的に利用しない。

## H3最初の受入試験と必要操作

**事前にコード・fake fixtureで進められる部分:** original codecとの契約一致、製品UI非公開、認可なし401・別recipient403・レート429・鮮度切れ503・悪性URL/Body拒否、時間差/再送・重複・partialがfalse-completeにならない試験。

**Human security gateが必要な部分:** 正式なProducer実行Hostと稼働主体を選ぶこと、中央GitHub App／OIDC発行資格・CloudflareのWorker Secret/Service Binding・実認証設定、外部公開ルートとdeployment、持続トリガー、追加費用が発生する設定。登録済み `kinotch-api #9` Codex専用Policy Bと機密tokenを流用しない。正式なproduction releaseは既存 `npm run deploy:production` 経由のみ。

完了は**実データのproducer→認証済みGateway→宛先別動的GET**において、限界到達・失効・ソース更新時の遅延・無効な送信元・HTTP認証／rateと費用の受入結果が揃った場合のみ。H2自体は設計・offline判定であり、H3/公開/API完成へ昇格させない。
