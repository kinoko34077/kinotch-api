# 共通日本語テキストAPI計画

## 方針

`txt-auto-replace` の変換実装を正本となる text core にし、ルビ解析・表記変換・辞書処理を共通化する。`kinotch-api` は公開Gateway、変換処理は別WorkerのService Bindingで配信する。Reader、`standby-display`、Chrome拡張は表示・DOM・設定を保持し、変換仕様だけcore/APIへ寄せる。

## 対象

- 最優先：変換engine、matcher、なろう式ルビparser、旧字体rule
- 次点：送り仮名、省略・長音・同音表記rule、structured dictionary
- 後段：体系的な `historical-kana` stage
- 対象外：DOM描画、MutationObserver、Chrome storage、Reader UI

## Phase 1：core抽出

- [x] `txt-auto-replace` のrevisionを固定（`d7e2e21`）
- [x] `transform-engine.js`、`transform-shared.js`、`structured-dictionary.js` をruntime-neutralな配置へ抽出
- [x] 変換bundleをJSON5データとして同梱
- [x] Node向けの安定入口と再利用テストを追加
- [x] APIや既存4ルートの挙動を変更しない

確認コマンド：`npm test`（Phase 1時点で7 tests passed）

## Phase 2：Worker配信

- [x] `text-transform-worker` を追加
- [x] `POST /v1/ruby/parse`、`POST /v1/transform`、`POST /v1/transform/batch`、`GET /v1/capabilities` を実装
- [x] `kinotch-api` GatewayからService Binding経由で公開
- [x] Kuromoji辞書をWorker Assets Bindingから遅延初期化
- [x] Kuromojiを使う送り仮名変換をWorkerで実行
- [x] 辞書初期化・基本変換をテスト
- [x] 代表的な長文・反復実行ベンチマークを追加
- [x] 本番デプロイ後の実運用レイテンシを計測

ベンチマーク実行：`npm run benchmark:text-transform`

ローカル実測（12,000文字、送り仮名profile）：初回3.73秒、同一Worker内の反復平均209ms。初回辞書初期化は本番デプロイ後に継続観測する。

本番デプロイ（2026-09-07 JST）：`text-transform` Version ID `a7a0c1d3-413a-47fa-b7ec-60606bb21f9c`、Gateway Version ID `60152732-fbd3-4969-9412-28e4d06334ac`。Gateway経由のbatch（2 text run、`legacy-kanji` + `general-character-replacements`）は3回で487ms / 313ms / 221ms。Tokenizerを必要とするextension profile（2 text run）は疎通確認済み。

追加確認（2026-09-07 JST）：12,000文字のローカルベンチマークは初回3.45秒、同一Worker内の暖機後5回平均273ms。代表的な活用形・語彙・長音・ルビ解析をGolden回帰テストとして固定した。本文をログへ残す計測は行わない。

本番再確認（2026-09-07 JST）：Gateway経由のbatch 5回は全てHTTP 200、初回コールド約3.28秒、2回目以降約26.6〜65ms（暖機後平均約40ms）。レスポンスの`engineVersion`と件数も全て検証済み。

## Phase 3：本番後安定化

- [x] 代表的な活用形・語彙・旧字体・長音・表層正規化のGolden回帰テスト
- [x] ルビ解析のGolden回帰テスト
- [x] 本番Gateway経由のbatch疎通とコールド／ウォーム遅延の確認
- [ ] 実クライアント利用時のエラー・fallback発生率を継続観測
- [ ] API／rule versionの更新手順を運用化

## 次段階：クライアント移行

- [x] 共通API clientの呼び出し契約を追加
- [x] 5xx・通信失敗時に注入できるローカルfallback境界を追加
- [ ] 歌詞ReaderのルビparserをAPI契約へ移行
- [ ] 歌詞Readerの旧字体変換をAPI利用へ移行
- [x] `standby-display` の重複旧字体マップをAPI正本へ切り替え
- [x] `standby-display` のAPI障害時ローカルfallbackを確認
- [x] Chrome拡張のページ本文API送信を許可範囲内でbatch APIへ移行

## 移行順

1. 歌詞Readerのルビparser・旧字体変換（後回し）
2. `standby-display` の旧字体マップ（完了）
3. Chrome拡張のcore利用/API fallback（batch APIへ移行）
4. historical-kanaの新規実装

## 受入条件

golden testで旧実装との出力一致、既存4 APIの回帰なし、rule/engine versionの追跡、本文をログへ残さないこと、API障害時のクライアントfallbackを確認してから公開する。Golden回帰、API回帰、version追跡、fallback確認は完了。残る作業は実クライアントでの継続的な遅延・エラー・fallback観測と、歌詞Readerの編集完了後の移行である。
