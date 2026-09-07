# クライアント移行メモ

## 共通client

[`src/client/text-transform.js`](../src/client/text-transform.js) の
`createTextTransformClient()`を各クライアントのAPI adapterとして利用する。
clientはDOMやChrome APIに依存しない。

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

## 移行順

1. 歌詞Reader：`ruby-parser.js`と`transformer.js`をAPI adapter経由へ変更
2. `standby-display`：`kanji-conversion.mjs`の重複マップを除去
3. Chrome拡張：オフライン時はcore、通常時はAPIを利用

表示、DOM、設定、本文保存の責務は各クライアントに残す。
