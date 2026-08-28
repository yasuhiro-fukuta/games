/* 中CPU v2 ベンチマーク: mid vs weak をN局回して勝率と時間を測る
   usage: node duema_mid_bench.js [games] [depth] [budget] [samples] */
const { chromium } = require('playwright');
const N = parseInt(process.argv[2] || '8', 10);
const DEPTH = parseInt(process.argv[3] || '2', 10);
const BUDGET = parseInt(process.argv[4] || '50000', 10);
const SAMPLES = parseInt(process.argv[5] || '3', 10);
const WFILE = process.argv[6] || null;
const SEED0 = parseInt(process.argv[7] || '1000', 10);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///home/user/duema/index.html');
  const W = WFILE ? JSON.parse(require('fs').readFileSync(WFILE)) : null;
  await page.evaluate(([depth, budget, samples, W]) => {
    if (W) MID2_W = W;
    TEST_AUTO = true; CPU_DELAY = 0;
    profile = null;
    midDepth = depth; MID2_BUDGET = budget; MID2_SAMPLES = samples;
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
  }, [DEPTH, BUDGET, SAMPLES, W]);

  let midWins = 0, weakWins = 0, draws = 0, stuck = 0, totalMs = 0;
  for (let g = 0; g < N; g++) {
    const midSide = g % 2;   // 交互に先手席を入れ替え
    const r = await page.evaluate(async ([seed, midSide]) => {
      trainSides = midSide === 0 ? ['mid', 'weak'] : ['weak', 'mid'];
      return await window.__game(seed);
    }, [SEED0 + g * 7919, midSide]);
    totalMs += r.ms;
    if (r.w === null) stuck++;
    else if (r.w === -1) draws++;
    else if (r.w === midSide) midWins++;
    else weakWins++;
    console.log(`game ${g}: midSide=${midSide} winner=${r.w} turns=${r.tn} ${(r.ms / 1000).toFixed(1)}s`);
    if (errors.length) { console.log('ERRORS:', errors.slice(0, 5)); break; }
  }
  console.log(`\nmid ${midWins} - ${weakWins} weak (draw ${draws}, stuck ${stuck}) / avg ${(totalMs / N / 1000).toFixed(1)}s/game`);
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await b.close();
})();
