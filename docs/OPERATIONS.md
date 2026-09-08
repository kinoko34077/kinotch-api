# Text API 運用確認手順

## 本番の基本確認

対象はGateway `https://api.kinotch.workers.dev`。本文そのものはログへ保存せず、ステータス、件数、profile、engineVersion、ruleSetHash、処理時間だけを確認する。

1. `GET /health` がHTTP 200であること。
2. `GET /v1/capabilities` の`engineVersion`、`ruleSetHash`、profile一覧、制限値を確認する。
3. Origin付き`OPTIONS /v1/transform` がHTTP 204で、`Access-Control-Allow-Methods`にPOSTを含むこと。
4. Origin付き`POST /v1/transform/batch` がHTTP 200で、入力件数と出力件数が一致すること。
5. 存在しないprofileがHTTP 400 `invalid_profile`になること。
6. `X-Request-ID`がレスポンスにあり、指定したIDは下流にも引き継がれること。
7. `/v1/capabilities`に`metadataVersion`、`ruleSetVersion`、`snapshotHash`、
   `dictionaryHash`があること。

## 遅延の見方

- 初回のTokenizer利用リクエストは辞書初期化のため遅くなる。現在の目安は約1.8〜3.3秒。
- 同一Workerが暖機された後は、短いbatchで約20〜65ms、長文では入力サイズに応じて増加する。
- クライアント側の最大待機時間は8秒。timeout、5xx、一時通信失敗、レスポンス不整合、ruleSetHash不一致はlocal fallbackへ切り替える。
- API側だけではlocal fallback発生率は測れない。実クライアントのdebug／運用計測で別途確認する。

## Gatewayの関門

`src/policies/routes.js`が各公開routeのmethod、body byte limit、rate limit、query／JSON
validationを定義する。新しい公開routeは`registerRoute()`経由でPolicyを必須化する。

- `transform`／`ruby/parse`: 512 KiB、30 requests/60 seconds/IP
- `transform/batch`: 1 MiB、30 requests/60 seconds/IP
- その他の公開route: 60 requests/60 seconds/IP
- 制限超過はGatewayでHTTP 429、`Retry-After`、`RateLimit-*`を返す。
- 本文の文字数・profileの意味検証は下流Text Workerにも残し、Gatewayのbyte制限と二重化する。
- `text-transform`のworkers.dev URLは無効化し、GatewayのService Bindingだけを公開経路とする。
- 下流Service Bindingの例外は502、下流503は503、上流応答の500は502、タイムアウトは504へ分類する。

Cloudflare Rate Limitingは厳密な会計用途ではなく、公開・未認証APIの過剰利用を抑える
境界として扱う。認証や利用量課金を導入する場合は、IP単位のkeyを利用者ID／API key単位へ
置き換える。

## snapshot互換性

`src/text-core`が正本で、次の情報を生成物とText Workerのレスポンスへ載せる。

- `ruleSetVersion`／`ruleSetHash`: rule dataの契約
- `metadataVersion`／`snapshotHash`: engine、shared parser、dictionary、Kuromoji、rulesを
  含むfallback runtime全体の契約
- `dictionaryHash`: Worker Assets辞書の契約
- `sourceRevision`: release metadataで追跡するsource revision（ローカル生成時は`unknown`）

`rules.generated.mjs`と`metadata.generated.mjs`は手編集せず、`npm run build:text-snapshot`
で再生成する。`npm test`は両方のcheckを先に実行する。

## Cloudflareログ

`wrangler.jsonc` と `wrangler.text-transform.jsonc` はObservabilityを有効化済み。tailを使う場合も本文・request body・response bodyを出力せず、ステータス、パス、処理時間、エラー種別だけを対象にする。

```sh
npx wrangler tail api --format json
npx wrangler tail text-transform --format json
```

## リリース後の確認

`npm run deploy:production`を使い、build／check／test／dry-run → Text Worker → 境界smoke →
Gateway → 全smokeの順で実行する。成功時は両WorkerのVersion ID、commit、engine／rule／snapshot
metadata、JST時刻を`docs/releases/`へ記録する。手動で個別deployする場合もこの順序を守る。

境界smokeでは、Text Workerの直URLがHTTP 200にならないことと、Gateway経由のcapabilitiesが
正常であることを確認する。直URLが200なら、Gateway唯一入口の条件を満たしていないため公開
完了と扱わない。

## 拡張機能の再読み込み

Chromeの`chrome://extensions`を開き、対象の開発者モード拡張機能の「再読み込み」を押す。その後、対象ページを再読み込みして標準bundleのremote API経路と、custom ruleのlocal経路をそれぞれ確認する。
