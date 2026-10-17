# KAEP P3-B H1 — 動的Agent APIのfake-only Gateway受入契約

正本：[kinotch-api #85](https://github.com/kinoko34077/kinotch-api/issues/85)。関連 [devflow #680](https://github.com/kinoko34077/devflow/issues/680) / devflow PR #710。

## 目的

既存Hono Gatewayを使うための **検証専用HTTPレスポンス境界** を固定する。実際のCloudflare Gatewayへの新規ルート登録、サービスBinding、GitHub App credential、Cloudflare Accessポリシー、認証ホスト、Production deployは本工程では行わない。

受け取れる入力は既存devflowの `kaep.agent-current-view.v0.1`。**そのJSONが真正なGitHub原典から生成されたことは、このモジュールだけでは証明できない**。原典のKAEP codecやGithub actor/recipient/reply処理をここで複製しない。既存devflow同一回の原典読取結果だけを接続できるデータProducerの別途承認が必要。

## 実装（現行は未接続）

- `src/kaep/agent-view-contract.js` に既存 `zod` による厳格な `kaepAgentViewSchema` と `fakeKaepGatewayResponse` を追加。
- `verifiedPrincipal` は今は**テストから注入する偽の事前検証済み身元**に過ぎない。実通信から作れる／真正に認証できる仕組みではない。将来のHono routeでは信頼済み認証 middleware が確立したprincipalのみ渡す。外部のquery/body/headerが `verified=true` を自己宣言しても使用禁止。
- recipientとprincipal許可範囲の照合に加え、各Issue・コメントURL、message ID、root数、原典確認時刻、完全性/権限なし固定値、boundedサイズを再検査し、データに想定外フィールドがあれば公開しない。
- 401（未認証）、403（宛先範囲不一致）、429（外部rateのテスト注入）、503（ソースなし・不正・古い）を安全な短いerror codeで返す。元の秘密情報や上流エラーをそのまま返さない。
- 有効な有限範囲の `PARTIAL_UNKNOWN` はHTTP 200でも、JSON内に必ず `PARTIAL_UNKNOWN`・unknown/false-authorityを保持。206はバイト範囲のHTTP意味を持つため不適切。
- 基本ヘッダー `Cache-Control: private, no-store`、`Vary: Authorization`、`X-Content-Type-Options: nosniff`。この段階ではETag・条件付きGET・CORS許可拡張はしない。

## 重要な未成立条件

1. `src/routes/api.js` のHonoルートにも `src/policies/routes.js` にも登録**していない**。`https://api.kinotch.workers.dev/v1/kaep/inbox` 等は現在**存在すると主張しない**。
2. `src/middleware/cors.js` は既存Gatewayの許可Origin `*`。このまま高権限Agent認証付き経路を公開しない。実ルート作成時は credential・Origin・Scopeの独立監査と専用ポリシーを要する。
3. 未認証で受け取るHTTPリクエストから、Cloudflare WorkerがローカルPython CLIを起動すると仮定しない。GitHub原典を取得・保存するProducerのHost認証/更新・Cache隔離・コスト/Rate実測、既存 `kinotch-identity` の未配備境界を別に検証。
4. Free-firstの要件を保持。実Provider課金・Cloudflareサービス新規配備・D1/Secrets/GitHub App資格情報・権限変更は明示的なHuman安全ゲート。
5. 実GPT本人性、無人受信、全公開リポのSource完全性、iPhone Safari実証は**未達**。

## テストと次の工程

`test/kaep-agent-view-contract.test.js` にfake positive PARTIAL、未認証/別宛先/Rate/ソース故障/期限切れ、偽URL・悪性extra field・誤scope・二重root・未取得仕事ゼロ偽断定・ルート未登録の負例を追加する。

H1コードのCI・formal review・main統合が完了したあとだけ、H2で「既存Cloudflare WorkerはGateway consumer、原典取得Producerは別」としたホスト設計の採用判定へ進む。本工程だけで本番リリース・動的HTTP API・GPT自動起動を受入にしない。

## H1-B：隔離Honoルートのポリシー結合検証

`test/kaep-agent-hono-policy-integration.test.js` は本番Gatewayに登録せず、テスト内の Hono と既存 `registerRoute`／`policyMiddleware`／`enforceRateLimit` を再利用。FAKE-only bearer／principal、preauth/main/actor rate limiting、fake Producerを注入し、401/403/429/503、期限切れ・不正レスポンス、ETagなし、Hono 405、実Gatewayの未登録404を確認する。テストに登場するBearer文字列や `verifiedPrincipal` は**実際の認証方式でも秘密鍵でもない**。この結果で将来の公開ルートやCloudflare権限が自動許可されることはない。
