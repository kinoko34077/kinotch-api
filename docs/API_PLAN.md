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
- [x] `kinotch-api` 共通クライアントのタイムアウトとfallback切替を追加
- [ ] `standby-display`・`txt-auto-replace` の配布用クライアントへ同じタイムアウト設定を反映
- [ ] 実クライアント利用時のエラー・fallback発生率を継続観測
- [ ] API／rule versionの更新手順を運用化

## 2026-09-08 改訂ロードマップ：正本・互換性・配布整合性を先に固める

### 0. 着手前の固定（完了済み）

- [x] 本番Workerのコールド／ウォーム遅延を計測
- [x] 代表変換・ルビ解析のGolden回帰を追加
- [x] `kinotch-api` 共通clientのtimeout／fallbackを追加
- [x] 歌詞Readerは編集完了まで対象外として明示

### 1. P0：ブラウザ公開契約を修正

目的は、別originのReaderからPOST APIを安全に呼べる状態にすること。

- [x] Gateway CORSを`GET`・`POST`・`OPTIONS`へ統一
- [x] GatewayのPOST preflightと実POSTを回帰テスト化
- [x] CORS修正後にGateway単体をデプロイし、`/v1/capabilities`・`/v1/transform/batch`を実ブラウザ相当のOrigin付きで確認

### 2. P0：Text Coreの正本と互換性情報を一意化

`kinotch-api/src/text-core`を正本とし、`txt-auto-replace`側のcore／ruleは正本から生成するfallback snapshotへ移行する。いきなり別npm packageには分けない。

- [ ] core・rule・dictionaryを含むsnapshot生成コマンドを設計
- [x] rule sourceから決定論的な`ruleSetHash`を生成し、API capabilities／transformレスポンスへ追加
- [ ] `engineVersion`、`ruleSetVersion`、`sourceRevision`を生成物とAPI capabilitiesへ追加
- [ ] transform／rubyレスポンスにも互換性確認に必要なversion情報を返す
- [ ] 拡張・standby側はsnapshot hash不一致時にremoteを使わずlocal fallbackへ切り替える
- [x] 共通clientでAPIのruleSetHash不一致を検出し、fallbackへ切り替える契約を追加
- [ ] snapshot生成物にsource revisionと生成日時を記録し、手編集を禁止

### 3. P1：生成ruleとテストの一致を保証

- [x] JSON5 sourceからの生成内容を一時出力と比較する`check:text-rules`を追加
- [x] `npm test`の前段でcheckを必須化し、stale generated版でPASSできないようにする
- [ ] CI／deployでも同じcheckを実行
- [ ] rule変更時にGoldenとruleSetHashが同時に更新されることを確認

### 4. P1：2 Workerのリリースを同期

deploy順を「build／metadata生成 → text-transform → smoke test → Gateway → smoke test」に固定する。

- [ ] `deploy:production`または同等の単一手順を追加
- [ ] GatewayとText WorkerのVersion ID、engine／rule metadataをリリース記録へ保存
- [ ] 片方だけ更新された状態を検出するsmoke checkを追加
- [ ] 手動実行とCloudflare側の自動デプロイで同じ手順を参照する

### 5. P1：クライアント配布とプライバシー境界を整備

- [ ] `standby-display`・`txt-auto-replace`へtimeoutとversion/hash判定を反映
- [ ] API clientをESM／browser IIFEの生成物として一本化し、各repoの手書きコピーを廃止
- [ ] 拡張機能にAPI変換ON/OFFとローカルのみモードを追加
- [ ] 送信許可domain／除外domainを設定可能にする
- [ ] `<all_urls>`環境で本文が外部送信されること、送信しない条件、ログに本文を残さないことを利用者向けに明記

### 6. P2：batch処理を最適化

- [ ] profile選択後のruntime planをbatch単位で1回だけcompile
- [ ] 全textを同一planで処理し、現行との出力一致をGolden／回帰で確認
- [ ] 代表的な256件・長文batchでcompile回数とレイテンシを比較
- [ ] 改善が確認できた場合のみ本番Workerへデプロイ

### 7. 後段：歌詞Readerとhistorical-kana

- [ ] 歌詞Readerの編集完了後、ルビparserを`/v1/ruby/parse`へ移行
- [ ] 歌詞Readerの旧字体変換をtransform／batch APIへ移行
- [ ] Readerの既存UI・DOM・storage責務とlocal fallbackを維持
- [ ] 既存基盤の互換性確認後に`historical-kana` stageを別途設計・実装

### 各段階の完了条件

各段階は、テスト合格、Golden出力一致、対象Workerのsmoke test、version/hash追跡、本文非ログ、障害時fallback確認を満たしてから次へ進む。CORS修正とAPI側rule hash公開まで完了したため、現時点の次アクションは**各クライアントのsnapshot hash照合**であり、歌詞Readerの移行とhistorical-kanaの実装はその後に行う。

進捗更新（2026-09-08 JST）：Gateway CORS修正版はVersion ID `6eb4a53b-e70c-4b22-955c-379cff6b9bd2`、ruleSetHash／Ruby parse対応Text Workerの最新Versionは `4f04a7ef-3ab3-4edd-9d22-3c83265e5d41`で本番確認済み。公開hashは`31e924e79d21c231a12db31c917f32529c5968bc9148cfce046de6cba249c0ef`。次の実装対象は各クライアントのsnapshot hash照合である。

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
