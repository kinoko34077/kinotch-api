# kinotch-api

`standby-display`から切り離したHono API Gatewayです。

## 開発・検証

```sh
npm ci
npm test
npx wrangler deploy --dry-run
npm run deploy:production
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
POST /v1/transform/batch
```

送り仮名などKuromojiを必要とする変換も、Worker Assetsの辞書を使って実行します。
クライアント共通の呼び出し入口は
[`src/client/text-transform.js`](src/client/text-transform.js) です。
移行手順は[`docs/CLIENT_MIGRATION.md`](docs/CLIENT_MIGRATION.md)に記録しています。

このリポジトリは`standby-display`とは別責任で管理します。API変更はテストと
dry-run、`npm run deploy:production`の本番疎通確認を行ったうえでデプロイしてください。
Production deploy authorityは`npm run deploy:production`だけです。`main`へのpushはGitHub Actionsの
`test`を実行しますが、Production deployを直接起動しません。Cloudflare Workers Builds / Git integrationの
Production auto-deployは無効化し、GitHub `main`のrequired check `test`、force push禁止、branch deletion禁止を
operator設定として維持します。詳細は[`docs/OPERATIONS.md`](docs/OPERATIONS.md)を正本とします。
`text-transform`はworkers.devの直接公開を無効化し、GatewayのService Bindingからだけ
到達させます。Gatewayにはroute policy、JSON schema、byte body limit、Cloudflare
Rate Limit binding、request ID、レスポンスヘッダーallowlistを適用しています。

意味保存型の高密度圧縮専用API `/v1/compress` も、認証済みGatewayから
`semantic-compression` WorkerのService Binding経由で提供します。固定profile、固定model、
本文非ログ、secret登録、live test、deploy／rollback手順は
[`docs/semantic-compression.md`](docs/semantic-compression.md) にまとめています。
ローカルlive testのGemini credentialには専用の
`KINOTCH_COMPRESSION_GEMINI_API_KEY` を使用し、Cloudflare Worker Secretの
`GEMINI_API_KEY` と分離します。

Text Coreのrules・engine・dictionary・Kuromojiを含むsnapshot metadataは
`npm run build:text-snapshot`で生成し、`npm test`の前段でstaleチェックします。
