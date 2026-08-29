/* Texel流学習: 対局を回して(局面特徴量, 最終勝敗)を収集し、ロジスティック回帰で重みをフィット
   usage: node duema_train.js collect <games> <out.json> [lv0] [lv1] [depth] [budget] [samples]
          node duema_train.js fit <out.json...>
   collect の第10引数に重みJSONファイルを渡すと、その重みで mid が打つ  */
const { chromium } = require('playwright');
const fs = require('fs');

async function collect(games, outPath, lv0, lv1, depth, budget, samples, wfile) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file:///home/user/duema/index.html');
  const W = wfile ? JSON.parse(fs.readFileSync(wfile)) : null;
  await page.evaluate(([depth, budget, samples, W]) => {
    TEST_AUTO = true; CPU_DELAY = 0;
    profile = null;
    if (W) MID2_W = W;
    midDepth = depth; MID2_BUDGET = budget; MID2_SAMPLES = samples;
    window.__game = async (seed, lv0, lv1) => {
      trainSides = [lv0, lv1];
      trainCollect = [];
      mode = 'cpu'; myIdx = 0; ruleMode = 'original'; aliceVariant = false; deckLists = null;
      SCREENS.forEach(sid => document.getElementById(sid).classList.remove('show'));
      if (transport) { try { transport.stop(); } catch (e) {} }
      transport = new LocalTransport();
      transport.start(onActionArrived);
      runGame(seed);
      const t0 = Date.now();
      while (winner === null && Date.now() - t0 < 240000 && turnNo < 80) {
        await new Promise(r => setTimeout(r, 25));
      }
      const w = winner;
      const data = trainCollect.map(x => ({ t: x.turn, f: x.f }));
      trainCollect = null;
      gameToken++;
      return { w, data, tn: turnNo };
    };
  }, [depth, budget, samples, W]);

  const samplesOut = [];
  let w0 = 0, w1 = 0, dr = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const r = await page.evaluate(async ([seed, lv0, lv1]) => window.__game(seed, lv0, lv1),
      [20000 + g * 104729, lv0, lv1]);
    if (r.w === 0) w0++; else if (r.w === 1) w1++; else dr++;
    if (r.w === 0 || r.w === 1) {
      for (const pos of r.data) {
        if (pos.t < 2) continue;   // 初手周辺は情報が薄い
        samplesOut.push({ f: pos.f, y: r.w === 0 ? 1 : 0 });
      }
    }
    if ((g + 1) % 20 === 0) {
      console.log(`${g + 1}/${games} games (${lv0} ${w0} - ${w1} ${lv1}, draw ${dr}) samples=${samplesOut.length} ${(Date.now() - t0) / 1000 | 0}s`);
      if (errors.length) { console.log('ERRORS', errors.slice(0, 3)); break; }
    }
  }
  fs.writeFileSync(outPath, JSON.stringify({ lv0, lv1, samples: samplesOut }));
  console.log(`done: ${samplesOut.length} samples -> ${outPath} (${lv0} ${w0} - ${w1} ${lv1}, draw ${dr})`);
  console.log('pageerrors:', errors.length ? errors.slice(0, 3) : 'none');
  await b.close();
}

function fit(paths) {
  let prior = null, lambda = 0, freeze = 0;
  if (paths[0] === '--prior') {   // fit --prior <w.json> <lambda> files...
    prior = JSON.parse(fs.readFileSync(paths[1]));
    lambda = parseFloat(paths[2]);
    paths = paths.slice(3);
  }
  if (paths[0] === '--freeze') {   // fit [--prior ...] --freeze <k> files... : 先頭k個の重みをprior値で凍結
    freeze = parseInt(paths[1], 10);
    paths = paths.slice(2);
  }
  const X = [], Y = [];
  for (const path of paths) {
    const d = JSON.parse(fs.readFileSync(path));
    for (const s of d.samples) {
      X.push(s.f); Y.push(s.y);
      X.push(s.f.map(v => -v)); Y.push(1 - s.y);   // 対称化(視点反転)
    }
  }
  const nf = X[0].length;
  let w = prior ? prior.slice() : new Array(nf).fill(0);
  const lr0 = 0.5, l2 = 1e-4, epochs = 400;
  const n = X.length;
  for (let ep = 0; ep < epochs; ep++) {
    const grad = new Array(nf).fill(0);
    let loss = 0;
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < nf; j++) z += w[j] * X[i][j];
      const pr = 1 / (1 + Math.exp(-z));
      const err = pr - Y[i];
      loss += Y[i] ? -Math.log(Math.max(pr, 1e-12)) : -Math.log(Math.max(1 - pr, 1e-12));
      for (let j = 0; j < nf; j++) grad[j] += err * X[i][j];
    }
    const lr = lr0 / (1 + ep / 100);
    for (let j = 0; j < nf; j++) {
      if (j < freeze) { w[j] = prior[j]; continue; }
      const reg = prior ? lambda * (w[j] - prior[j]) : l2 * w[j];
      w[j] -= lr * (grad[j] / n + reg);
    }
    if (ep % 100 === 0 || ep === epochs - 1) {
      let acc = 0;
      for (let i = 0; i < n; i++) {
        let z = 0;
        for (let j = 0; j < nf; j++) z += w[j] * X[i][j];
        if ((z > 0) === (Y[i] === 1)) acc++;
      }
      console.log(`epoch ${ep}: loss=${(loss / n).toFixed(4)} acc=${(acc / n * 100).toFixed(1)}% n=${n}`);
    }
  }
  console.log('weights:', JSON.stringify(w.map(v => +v.toFixed(4))));
  return w;
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'collect') {
    await collect(parseInt(process.argv[3], 10), process.argv[4],
      process.argv[5] || 'weak', process.argv[6] || 'weak',
      parseInt(process.argv[7] || '2', 10), parseInt(process.argv[8] || '15000', 10), parseInt(process.argv[9] || '2', 10),
      process.argv[10] || null);
  } else if (cmd === 'fit') {
    fit(process.argv.slice(3));
  } else if (cmd === 'convert') {
    // 棋譜(gameRecord形式)→ fit用サンプルへ変換
    // usage: convert <records.json> <out.json>   records.json = localStorage "duema-records" の配列
    //        (またはFirebase /records のエクスポート = {key: rec, ...})
    const raw = JSON.parse(fs.readFileSync(process.argv[3]));
    const recs = Array.isArray(raw) ? raw : Object.values(raw);
    const samples = [];
    let used = 0;
    for (const r of recs) {
      if (!r || !Array.isArray(r.pos) || (r.winner !== 0 && r.winner !== 1)) continue;
      if (r.alice) continue;                       // アリス混成対局は特徴量の意味が別物なので除外
      used++;
      for (const p of r.pos) {
        if (p.t < 2) continue;
        samples.push({ f: p.f, y: r.winner === 0 ? 1 : 0 });   // fは席0視点・yは席0勝敗(fit側の対称化が視点を吸収)
      }
    }
    fs.writeFileSync(process.argv[4], JSON.stringify({ lv0: 'human', lv1: 'cpu', samples }));
    console.log(`converted: ${used}/${recs.length} games -> ${samples.length} samples -> ${process.argv[4]}`);
  }
})();
