/* メメティック進化: 9個体それぞれが生涯学習(Texel微調整)し、リーグ戦で淘汰・交配する
   usage: node duema_evolve.js auto [seconds=440]   … 制限時間ぶんだけ作業を進めて checkpoint して終了
          node duema_evolve.js status               … 現在の状態と世代ログを表示
   状態は evolve_state.json に保存。何度でも再開できる。

   1世代 = ①生涯学習: 各個体がチャンピオンと10局(5+5席)→自ゲノム錨のTexel微調整(ラマルク遺伝)
           ②リーグ:   各個体が 弱CPU 8局 + チャンピオン8局(ペア化シード)
           ③淘汰:     上位3エリート残留 / ブレンド交叉+突然変異6体(下位スロットほどσ大)/ 移民1体
*/
const { chromium } = require('playwright');
const fs = require('fs');
const STATE = __dirname + '/evolve_state.json';
const NF = 16;
const POP = 9;
const LIFE_GAMES = 8;         // 生涯学習の対局数(対チャンピオン、4+4席)
const LEAGUE_W = 6, LEAGUE_C = 6;   // リーグ: 対弱 / 対チャンピオン
const BUDGET = 2000, DEPTH = 2, SAMPLES = 1;   // 進化用の軽量設定(全個体同一条件の相対比較)
const CHAMP0 = [0.3884, 0.7868, 1.1748, 0.4382, 0.0233, 0.1146, 0.0718, 0.4587, 0.1105, 0.8457, 0.4181, 0.4382, -0.1114, 0.9662, 0.6592, 0.3457];

const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function newState() {
  const pop = [];
  pop.push({ id: 'g0-champ', w: CHAMP0.slice() });
  for (let i = 0; i < 4; i++) pop.push({ id: `g0-s${i}`, w: CHAMP0.map(x => x + gauss() * 0.08) });
  for (let i = 0; i < 2; i++) pop.push({ id: `g0-b${i}`, w: CHAMP0.map(x => x + gauss() * 0.25) });
  for (let i = 0; i < 2; i++) pop.push({ id: `g0-r${i}`, w: Array.from({ length: NF }, () => gauss() * 0.5) });
  for (const p of pop) { p.life = []; p.lifeDone = 0; p.learned = null; p.lw = 0; p.lc = 0; p.leagueDone = 0; }
  return { gen: 0, phase: 'life', champ: CHAMP0.slice(), champId: 'origin', pop, log: [] };
}
const load = () => fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE)) : newState();
const save = st => fs.writeFileSync(STATE, JSON.stringify(st));

/* ---- ロジスティック回帰(自ゲノム錨・緩やか) ---- */
function texelNudge(genome, samples) {
  if (samples.length < 40) return genome.slice();
  const X = [], Y = [];
  for (const s of samples) {
    X.push(s.f); Y.push(s.y);
    X.push(s.f.map(v => -v)); Y.push(1 - s.y);
  }
  const n = X.length, lambda = 0.02;
  let w = genome.slice();
  for (let ep = 0; ep < 150; ep++) {
    const grad = new Array(NF).fill(0);
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < NF; j++) z += w[j] * X[i][j];
      const err = 1 / (1 + Math.exp(-z)) - Y[i];
      for (let j = 0; j < NF; j++) grad[j] += err * X[i][j];
    }
    const lr = 0.3 / (1 + ep / 60);
    for (let j = 0; j < NF; j++) w[j] -= lr * (grad[j] / n + lambda * (w[j] - genome[j]));
  }
  return w;
}

/* ---- 淘汰・交配 ---- */
function nextGeneration(st) {
  const ranked = [...st.pop].sort((a, b) => (b.lw + b.lc) - (a.lw + a.lc) || b.lc - a.lc);
  const g = st.gen;
  const summary = ranked.map(p => `${p.id}:${p.lw}+${p.lc}`).join(' ');
  st.log.push(`gen${g} league: ${summary}`);
  // チャンピオン更新: リーグ首位が現チャンピオンに勝ち越していたら交代
  const top = ranked[0];
  if (top.lc > LEAGUE_C / 2) {
    st.champ = top.learned.slice();
    st.champId = `${top.id}(gen${g})`;
    st.log.push(`gen${g}: champion -> ${st.champId} (vs-champ ${top.lc}/${LEAGUE_C})`);
  }
  const elites = ranked.slice(0, 3);
  const pop = elites.map((p, i) => ({ id: `g${g + 1}-e${i}<${p.id}`, w: p.learned.slice() }));
  const sig = [0.05, 0.05, 0.1, 0.1, 0.2];   // 下位スロットほど突然変異σ大
  for (let i = 0; i < 5; i++) {
    const a = elites[Math.floor(rnd() * 3)], b = elites[Math.floor(rnd() * 3)];
    const al = 0.3 + rnd() * 0.4;
    const w = a.learned.map((x, j) => al * x + (1 - al) * b.learned[j] + gauss() * sig[i]);
    pop.push({ id: `g${g + 1}-x${i}`, w });
  }
  pop.push({ id: `g${g + 1}-imm`, w: Array.from({ length: NF }, () => gauss() * 0.5) });   // 移民
  for (const p of pop) { p.life = []; p.lifeDone = 0; p.learned = null; p.lw = 0; p.lc = 0; p.leagueDone = 0; }
  st.gen = g + 1;
  st.phase = 'life';
  st.pop = pop;
}

(async () => {
  const cmd = process.argv[2] || 'auto';
  const st = load();
  if (cmd === 'status') {
    console.log(`gen=${st.gen} phase=${st.phase} champ=${st.champId}`);
    console.log(st.log.slice(-20).join('\n'));
    return;
  }
  const limitMs = (parseInt(process.argv[3] || '440', 10)) * 1000;
  const t0 = Date.now();
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///home/user/duema/index.html');
  await page.evaluate(([depth, budget, samples]) => {
    TEST_AUTO = true; CPU_DELAY = 0; profile = null;
    midDepth = depth; MID2_BUDGET = budget; MID2_SAMPLES = samples;
    /* 1局実行: sides=['mid','weak'等], W=[side0重み,side1重み], collect=特徴収集するか */
    window.__game = async (seed, sides, W, collect) => {
      trainSides = sides;
      trainW = W;
      trainCollect = collect ? [] : null;
      mode = 'cpu'; myIdx = 0; ruleMode = 'original'; aliceVariant = false; deckLists = null;
      SCREENS.forEach(sid => document.getElementById(sid).classList.remove('show'));
      if (transport) { try { transport.stop(); } catch (e) {} }
      transport = new LocalTransport();
      transport.start(onActionArrived);
      runGame(seed);
      const s0 = Date.now();
      while (winner === null && Date.now() - s0 < 240000 && turnNo < 80) await new Promise(r => setTimeout(r, 25));
      const w = winner;
      const data = trainCollect ? trainCollect.filter(x => x.turn >= 2).map(x => ({ f: x.f })) : null;
      trainCollect = null; trainW = null;
      gameToken++;
      return { w, data };
    };
  }, [DEPTH, BUDGET, SAMPLES]);
  const game = (seed, sides, W, collect) =>
    page.evaluate(async a => window.__game(...a), [seed, sides, W, collect]);
  const timeUp = () => Date.now() - t0 > limitMs;

  let worked = true;
  while (worked && !timeUp() && !errors.length) {
    worked = false;
    if (st.phase === 'life') {
      for (const p of st.pop) {
        if (p.lifeDone >= LIFE_GAMES) continue;
        const g = p.lifeDone;
        const seed = 300000 + st.gen * 4001 + g * 7919;
        const meFirst = g % 2 === 0;   // 席を交互に
        const W = meFirst ? [p.w, st.champ] : [st.champ, p.w];
        const r = await game(seed, ['mid', 'mid'], W, true);
        if (r.w === 0 || r.w === 1) {
          // 特徴量は常に席0視点で記録される → ラベルも「席0が勝ったか」(対称化が視点を吸収する)
          for (const pos of r.data) p.life.push({ f: pos.f, y: r.w === 0 ? 1 : 0 });
        }
        p.lifeDone++;
        worked = true;
        if (timeUp()) break;
      }
      if (st.pop.every(p => p.lifeDone >= LIFE_GAMES)) {
        for (const p of st.pop) { p.learned = texelNudge(p.w, p.life); p.life = []; }
        st.phase = 'league';
        st.log.push(`gen${st.gen}: lifetime learning done`);
        worked = true;
      }
    } else if (st.phase === 'league') {
      for (const p of st.pop) {
        while (p.leagueDone < LEAGUE_W + LEAGUE_C && !timeUp()) {
          const g = p.leagueDone;
          const vsChamp = g >= LEAGUE_W;
          const k = vsChamp ? g - LEAGUE_W : g;
          const seed = 600000 + st.gen * 4001 + g * 7919;   // 全個体で共通シード(ペア化)
          const meFirst = k % 2 === 0;
          let r, meWon;
          if (vsChamp) {
            const W = meFirst ? [p.learned, st.champ] : [st.champ, p.learned];
            r = await game(seed, ['mid', 'mid'], W, false);
            meWon = (r.w === 0) === meFirst;
            if (r.w === 0 || r.w === 1) { if (meWon) p.lc++; }
          } else {
            const sides = meFirst ? ['mid', 'weak'] : ['weak', 'mid'];
            const W = meFirst ? [p.learned, null] : [null, p.learned];
            r = await game(seed, sides, [W[0] || p.learned, W[1] || p.learned], false);
            meWon = (r.w === 0) === meFirst;
            if (r.w === 0 || r.w === 1) { if (meWon) p.lw++; }
          }
          p.leagueDone++;
          worked = true;
        }
        if (timeUp()) break;
      }
      if (st.pop.every(p => p.leagueDone >= LEAGUE_W + LEAGUE_C)) {
        nextGeneration(st);
        worked = true;
      }
    }
    save(st);
  }
  save(st);
  console.log(`checkpoint: gen=${st.gen} phase=${st.phase} champ=${st.champId} elapsed=${((Date.now() - t0) / 1000) | 0}s`);
  const prog = st.phase === 'life'
    ? `life ${st.pop.reduce((s, p) => s + p.lifeDone, 0)}/${POP * LIFE_GAMES}`
    : `league ${st.pop.reduce((s, p) => s + p.leagueDone, 0)}/${POP * (LEAGUE_W + LEAGUE_C)}`;
  console.log(`progress: ${prog}`);
  if (st.log.length) console.log(st.log.slice(-3).join('\n'));
  console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
  await b.close();
})();
