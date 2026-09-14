// 絵札の貫通: シミュ(midResolveBattle)のユニットテスト
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///home/user/duema/index.html');
  const r = await page.evaluate(() => {
    const mkSt = atkCode => ({
      turn: 0, tn: 10, landSetUsed: 1, blankUsed: 0,
      hand: [[], []],
      deck: [new Array(20).fill(99), new Array(20).fill(99)],
      lands: [[], []],
      field: [[{ code: atkCode, tapped: false, sick: false, pz: false, dmg: 0, indest: false }],
              [{ code: 2, tapped: false, sick: false, pz: false, dmg: 0, indest: false }]],   // ♠3
      grave: [[], []],
    });
    const out = {};
    // ケース1: ♠K(13)が本体攻撃 → ♠3がブロック → 3点で討ち取り+余剰10点が貫通ミル
    {
      const st = mkSt(12);   // ♠K
      midResolveBattle(st, 0, [{ cre: 12, tt: "player" }], [{ attacker: 12, blocker: 2 }]);
      out.kLeak = 20 - st.deck[1].length;          // 期待 10
      out.kBlockerDead = st.field[1].length === 0; // 期待 true
    }
    // ケース2: ♠10(非絵札)が本体攻撃 → ♠3がブロック → 余剰は通らない
    {
      const st = mkSt(9);    // ♠10
      midResolveBattle(st, 0, [{ cre: 9, tt: "player" }], [{ attacker: 9, blocker: 2 }]);
      out.tenLeak = 20 - st.deck[1].length;        // 期待 0
    }
    // ケース3: ♠Q(12)がタップ中のクリーチャー(♦5)を攻撃 → ♠3がブロック → 余剰9点が対象へ追撃
    {
      const st = mkSt(11);   // ♠Q
      st.field[1].push({ code: 30, tapped: true, sick: false, pz: true, dmg: 0, indest: false });   // ♦5 (2*13+4=30)
      midResolveBattle(st, 0, [{ cre: 11, tt: "cre", tv: 30 }], [{ attacker: 11, blocker: 2 }]);
      out.qTargetDead = !st.field[1].some(f => f.code === 30);   // 余剰9 >= 5 → 死 期待 true
      out.qLeakDeck = 20 - st.deck[1].length;                    // 本体には行かない 期待 0
    }
    // ケース4: 貫通の絵札でも致死圏内(ブロッカー合計>=パワー)なら余剰なし: ♠J(11) vs ♠Q(12/12)ブロック
    {
      const st = mkSt(10);   // ♠J rank11
      st.field[1][0] = { code: 11, tapped: false, sick: false, pz: false, dmg: 0, indest: false };  // ♠Q blocker
      midResolveBattle(st, 0, [{ cre: 10, tt: "player" }], [{ attacker: 10, blocker: 11 }]);
      out.jLeak = 20 - st.deck[1].length;          // 致死12>11 → 全部吸収 期待 0
    }
    // ケース5: ブランク11/11(code 111)は貫通なし
    {
      const st = mkSt(111);
      midResolveBattle(st, 0, [{ cre: 111, tt: "player" }], [{ attacker: 111, blocker: 2 }]);
      out.blankLeak = 20 - st.deck[1].length;      // 期待 0
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  const ok = r.kLeak === 10 && r.kBlockerDead && r.tenLeak === 0 && r.qTargetDead && r.qLeakDeck === 0 && r.jLeak === 0 && r.blankLeak === 0;
  console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
  console.log(ok && !errors.length ? 'TRAMPLE-SIM: ALL OK' : 'TRAMPLE-SIM: FAIL');
  await b.close();
  process.exit(ok && !errors.length ? 0 : 1);
})();
