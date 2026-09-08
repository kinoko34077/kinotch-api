# クライアント移行メモ

## 共通client

[`src/client/text-transform.js`](../src/client/text-transform.js) の
`createTextTransformClient()`を各クライアントのAPI adapterとして利用する。
clientはDOMやChrome APIに依存しない。
同じソースから`src/client/text-transform.iife.js`も生成できるため、browser script
環境では`npm run build:browser-client`の生成物を読み込む。IIFE生成物は手編集せず、
`npm test`の前段でstaleチェックする。

```js
const textApi = createTextTransformClient({
  baseUrl: "https://api.kinotch.workers.dev",
});

const ruby = await textApi.parseRuby(sourceText);
const legacy = await textApi.transform(sourceText, {
  profile: ["legacy-kanji"],
});
```

## fallback

通信障害時だけ既存のローカル実装へ戻す場合は、fallbackを注入する。
4xxの入力エラーはfallbackせず、そのまま呼び出し側へ返す。

```js
const textApi = createTextTransformClient({
  fallback: {
    parseRuby: (text) => localRubyParser(text),
    transform: (text, options) => localTransform(text, options),
  },
});
```

## 移行状況

- `standby-display`：起動時に `legacy-kanji` の正本マップをAPIから一度取得。初期表示と通信障害時は既存のローカルマップを使用する。
- 歌詞Reader：後回し。
- Chrome拡張：ページ本文を許可された外部APIへbatch送信。通信障害時は既存のkuromojiローカルルールへfallbackする。

## 移行順

1. 歌詞Reader：`ruby-parser.js`と`transformer.js`をAPI adapter経由へ変更
2. `standby-display`：`kanji-conversion.mjs`の重複マップをAPI正本へ切り替え（完了）
3. Chrome拡張：batch APIを利用し、オフライン時は既存ローカル実装へfallback（完了）

表示、DOM、設定、本文保存の責務は各クライアントに残す。
