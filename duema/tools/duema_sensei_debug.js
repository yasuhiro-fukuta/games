// 師範CPUデバッグ: 1局回して全ログを吐く
const { chromium } = require('playwright');
const SEED = parseInt(process.argv[2] || '1000', 10);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///home/user/duema/index.html');
  const r = await page.evaluate(async seed => {
    TEST_AUTO = true; CPU_DELAY = 0; profile = null;
    midDepth = 2; MID2_BUDGET = 30000; MID2_SAMPLES = 1;
    const logs = [];
    const origLog = log;
    log = (...a) => { logs.push(a.join(' ')); return origLog(...a); };
    mode = 'cpu'; myIdx = 0; ruleMode = 'original'; aliceVariant = false; deckLists = null;
    trainSides = ['sensei', 'weak'];
    SCREENS.forEach(sid => document.getElementById(sid).classList.remove('show'));
    if (transport) { try { transport.stop(); } catch (e) {} }
    transport = new LocalTransport();
    transport.start(onActionArrived);
    runGame(seed);
    const t0 = Date.now();
    while (winner === null && Date.now() - t0 < 120000 && turnNo < 80) {
      await new Promise(r2 => setTimeout(r2, 40));
    }
    return { w: winner, tn: turnNo, logs, d0: players[0].deck.length, d1: players[1].deck.length };
  }, SEED);
  console.log('winner(0=sensei,1=weak):', r.w, 'turns:', r.tn, 'decks:', r.d0, r.d1);
  console.log(r.logs.join('\n'));
  console.log('pageerrors:', errors.length ? errors.slice(0, 5) : 'none');
  await b.close();
})();
