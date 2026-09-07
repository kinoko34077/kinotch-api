# kinotch-api

`standby-display`から切り離したHono API Gatewayです。

## 開発・検証

```sh
npm ci
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

本番URLは`https://api.kinotch.workers.dev`です。時刻・天気・六曜・月情報を
Service Binding経由で既存Workerへ中継します。

共通日本語テキストAPIの抽出計画と現在のPhaseは
[`docs/API_PLAN.md`](docs/API_PLAN.md) に記録しています。Phase 1では変換coreと
ルールデータを配置し、Phase 2ではルビ解析・旧字体変換・能力一覧を
`text-transform` WorkerからService Binding経由で公開しています。

```text
GET  /v1/capabilities
POST /v1/ruby/parse
POST /v1/transform
```

送り仮名などKuromojiを必要とする変換も、Worker Assetsの辞書を使って実行します。
クライアント共通の呼び出し入口は
[`src/client/text-transform.js`](src/client/text-transform.js) です。
移行手順は[`docs/CLIENT_MIGRATION.md`](docs/CLIENT_MIGRATION.md)に記録しています。

このリポジトリは`standby-display`とは別責任で管理します。API変更はテストと
dry-run、本番4ルートの疎通確認を行ったうえでデプロイしてください。
