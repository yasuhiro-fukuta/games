/* 中CPU同士の直接対決: 席を交互に入れ替えてペア化シードで対戦
   usage: node duema_h2h.js <wA.json> <wB.json|weak> <games> [budget] [samples] [seed0] */
const { chromium } = require('playwright');
const fs = require('fs');
const A = JSON.parse(fs.readFileSync(process.argv[2]));
const Bv = process.argv[3] === 'weak' ? null : JSON.parse(fs.readFileSync(process.argv[3]));
const N = parseInt(process.argv[4] || '14', 10);
const BUDGET = parseInt(process.argv[5] || '30000', 10);
const SAMPLES = parseInt(process.argv[6] || '2', 10);
const SEED0 = parseInt(process.argv[7] || '60000', 10);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///home/user/duema/index.html');
  await page.evaluate(([budget, samples]) => {
    TEST_AUTO = true; CPU_DELAY = 0; profile = null;
    midDepth = 2; MID2_BUDGET = budget; MID2_SAMPLES = samples;
    window.__game = async (seed, sides, W) => {
      trainSides = sides; trainW = W;
      mode = 'cpu'; myIdx = 0; ruleMode = 'original'; aliceVariant = false; deckLists = null;
      SCREENS.forEach(sid => document.getElementById(sid).classList.remove('show'));
      if (transport) { try { transport.stop(); } catch (e) {} }
      transport = new LocalTransport();
      transport.start(onActionArrived);
      runGame(seed);
      const s0 = Date.now();
      while (winner === null && Date.now() - s0 < 240000 && turnNo < 80) await new Promise(r => setTimeout(r, 30));
      const w = winner; const tn = turnNo;
      trainW = null; gameToken++;
      return { w, tn };
    };
  }, [BUDGET, SAMPLES]);
  let aw = 0, bw = 0, other = 0;
  for (let g = 0; g < N; g++) {
    const aFirst = g % 2 === 0;
    const seed = SEED0 + (g >> 1) * 7919;   // 同一シードを両席で1回ずつ
    let r;
    if (Bv) {
      r = await page.evaluate(async a => window.__game(...a),
        [seed, ['mid', 'mid'], aFirst ? [A, Bv] : [Bv, A]]);
    } else {
      r = await page.evaluate(async a => window.__game(...a),
        [seed, aFirst ? ['mid', 'weak'] : ['weak', 'mid'], [A, A]]);
    }
    if (r.w === (aFirst ? 0 : 1)) aw++; else if (r.w === (aFirst ? 1 : 0)) bw++; else other++;
    console.log(`game ${g}: aFirst=${aFirst} winner=${r.w} turns=${r.tn}`);
    if (errors.length) { console.log('ERRORS', errors.slice(0, 3)); break; }
  }
  console.log(`A ${aw} - ${bw} B (other ${other})`);
  await b.close();
})();
