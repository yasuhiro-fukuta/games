/* 強CPU(NN評価)ベンチマーク: lvA vs lvB をN局(席交互)で回す
   usage: node duema_strong_bench.js <strong_w.json> [games] [lvA] [lvB] [depth] [budget] [seed0] */
const { chromium } = require('playwright');
const SWFILE = process.argv[2];
const N = parseInt(process.argv[3] || '28', 10);
const LVA = process.argv[4] || 'strong';
const LVB = process.argv[5] || 'mid';
const DEPTH = parseInt(process.argv[6] || '2', 10);
const BUDGET = parseInt(process.argv[7] || '30000', 10);
const SEED0 = parseInt(process.argv[8] || '1000', 10);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///home/user/duema/index.html');
  const SW = JSON.parse(require('fs').readFileSync(SWFILE));
  await page.evaluate(([depth, budget, SW]) => {
    STRONG_W = SW;
    TEST_AUTO = true; CPU_DELAY = 0;
    profile = null;
    midDepth = depth; MID2_BUDGET = budget; MID2_SAMPLES = 1;
    window.__game = async seed => {
      mode = 'cpu'; myIdx = 0; ruleMode = 'original'; aliceVariant = false; deckLists = null;
      SCREENS.forEach(sid => document.getElementById(sid).classList.remove('show'));
      if (transport) { try { transport.stop(); } catch (e) {} }
      transport = new LocalTransport();
      transport.start(onActionArrived);
      runGame(seed);
      const t0 = Date.now();
      while (winner === null && Date.now() - t0 < 180000 && turnNo < 80) {
        await new Promise(r => setTimeout(r, 40));
      }
      const w = winner;
      const tn = turnNo;
      gameToken++;
      return { w, tn, ms: Date.now() - t0 };
    };
  }, [DEPTH, BUDGET, SW]);

  let aWins = 0, bWins = 0, draws = 0, stuck = 0, totalMs = 0;
  for (let g = 0; g < N; g++) {
    const aSide = g % 2;
    const r = await page.evaluate(async ([seed, aSide, lvA, lvB]) => {
      trainSides = aSide === 0 ? [lvA, lvB] : [lvB, lvA];
      return await window.__game(seed);
    }, [SEED0 + g * 7919, aSide, LVA, LVB]);
    totalMs += r.ms;
    if (r.w === null) stuck++;
    else if (r.w === -1) draws++;
    else if (r.w === aSide) aWins++;
    else bWins++;
    console.log(`game ${g}: ${LVA}Side=${aSide} winner=${r.w} turns=${r.tn} ${(r.ms / 1000).toFixed(1)}s`);
    if (errors.length) { console.log('ERRORS:', errors.slice(0, 5)); break; }
  }
  console.log(`\n${LVA} ${aWins} - ${bWins} ${LVB} (draw ${draws}, stuck ${stuck}) / avg ${(totalMs / N / 1000).toFixed(1)}s/game`);
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await b.close();
})();
