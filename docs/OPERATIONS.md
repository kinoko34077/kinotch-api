# Text API 運用確認手順

## 本番の基本確認

対象はGateway `https://api.kinotch.workers.dev`。本文そのものはログへ保存せず、ステータス、件数、profile、engineVersion、ruleSetHash、処理時間だけを確認する。

1. `GET /health` がHTTP 200であること。
2. `GET /v1/capabilities` の`engineVersion`、`ruleSetHash`、profile一覧、制限値を確認する。
3. Origin付き`OPTIONS /v1/transform` がHTTP 204で、`Access-Control-Allow-Methods`にPOSTを含むこと。
4. Origin付き`POST /v1/transform/batch` がHTTP 200で、入力件数と出力件数が一致すること。
5. 存在しないprofileがHTTP 400 `invalid_profile`になること。

## 遅延の見方

- 初回のTokenizer利用リクエストは辞書初期化のため遅くなる。現在の目安は約1.8〜3.3秒。
- 同一Workerが暖機された後は、短いbatchで約20〜65ms、長文では入力サイズに応じて増加する。
- クライアント側の最大待機時間は8秒。timeout、5xx、一時通信失敗、レスポンス不整合、ruleSetHash不一致はlocal fallbackへ切り替える。
- API側だけではlocal fallback発生率は測れない。実クライアントのdebug／運用計測で別途確認する。

## Cloudflareログ

`wrangler.jsonc` と `wrangler.text-transform.jsonc` はObservabilityを有効化済み。tailを使う場合も本文・request body・response bodyを出力せず、ステータス、パス、処理時間、エラー種別だけを対象にする。

```sh
npx wrangler tail api --format json
npx wrangler tail text-transform --format json
```

## リリース後の確認

Text Workerを先にdeployし、health／capabilities／batchを確認してからGatewayをdeployする。両WorkerのVersion ID、engineVersion、ruleSetHashを`docs/API_PLAN.md`と`CHANGELOG.md`へ記録する。

## 拡張機能の再読み込み

Chromeの`chrome://extensions`を開き、対象の開発者モード拡張機能の「再読み込み」を押す。その後、対象ページを再読み込みして標準bundleのremote API経路と、custom ruleのlocal経路をそれぞれ確認する。
