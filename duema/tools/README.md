# 中CPU 開発ツール(Playwright + Node)

ゲーム本体(`../index.html`)には不要。中CPUの学習・評価をやり直すときに使う。
実行には Playwright + Chromium が必要。各スクリプトはページを `file:///home/user/duema/index.html`
から読むので、環境が違う場合はパスを書き換えること。

- `duema_mid_bench.js` — 中CPU vs 弱CPU のベンチマーク
  `node duema_mid_bench.js [games] [depth] [budget] [samples] [weights.json] [seed0]`
- `duema_h2h.js` — 重みセット同士の直接対決(席交互・ペア化シード)
  `node duema_h2h.js <wA.json> <wB.json|weak> <games> [budget] [samples] [seed0]`
- `duema_train.js` — Texel流学習(対局収集→ロジスティック回帰)
  `collect <games> <out.json> [lv0] [lv1] [depth] [budget] [samples] [weights]` / `fit [--prior w.json λ] [--freeze k] <files...>`
- `duema_evolve.js` — メメティック進化(9個体が生涯学習→リーグ淘汰→交配)。
  `auto [seconds]` で時間分だけ進めて `evolve_state.json` にチェックポイント(再開可能)、`status` で確認
- `evolve_state.json` — 進化の現在状態(世代5・チャンピオン g4-e1<g3-x1 まで進行済み)
- `w_evolved.json` — 進化チャンピオンの重み。**注意**: 進化時の適応度は軽量設定(予算2000)で
  測ったため、その環境では現行重みに10勝4敗で勝つが、本番設定(予算30000)では1勝8敗と逆転する
  (環境過適応)。本番重みを進化で更新するなら、リーグを本番予算で回すこと(1世代≈2時間)

本体に焼き込まれている重み(`MID2_W`)の出自: ゼロ初期化→弱CPU同士300局+中対弱100局の
Texel回帰(基礎13特徴)→基礎を凍結して山札ヒンジ3特徴を追加学習。
