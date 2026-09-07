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

このリポジトリは`standby-display`とは別責任で管理します。API変更はテストと
dry-run、本番4ルートの疎通確認を行ったうえでデプロイしてください。
