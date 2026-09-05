# 強CPUのMLP学習: 自己対戦サンプル(g=62次元生特徴, y=席0勝敗)からロジスティックMLPを学習
# usage: python3 train_strong.py <out_w.json> <sp1.json> [sp2.json ...]
import json, sys
import numpy as np

rng = np.random.default_rng(7)

MID2W = np.array(json.load(open("mid2_w.json")))
CAP = 1.0   # NN補正の振幅上限(ロジット)

def load(paths):
    G, LIN, Y = [], [], []
    for p in paths:
        d = json.load(open(p))
        for s in d["samples"]:
            if "g" not in s or s["g"] is None or "f" not in s: continue
            f = np.array(s["f"], dtype=np.float64)
            if len(f) != len(MID2W): continue
            G.append(s["g"]); LIN.append(float(MID2W @ f)); Y.append(s["y"])
    return np.array(G, dtype=np.float64), np.array(LIN, dtype=np.float64), np.array(Y, dtype=np.float64)

def mirror(G, LIN, Y):
    # 視点対称化: 側ブロック(29次元×2)を入れ替え、手番・デッキ差・線形評価を反転、勝敗を反転
    M = G.copy()
    M[:, 0:29], M[:, 29:58] = G[:, 29:58], G[:, 0:29].copy()
    M[:, 58] = 1 - G[:, 58]
    M[:, 61] = -G[:, 61]
    return np.concatenate([G, M]), np.concatenate([LIN, -LIN]), np.concatenate([Y, 1 - Y])

def main():
    out_path, paths = sys.argv[1], sys.argv[2:]
    G, LIN, Y = load(paths)
    n = G.shape[1]
    assert n == 62, f"expected 62 features, got {n}"
    # ゲーム相関を考慮した分割: 40サンプル程度のブロック単位でホールドアウト
    nblk = len(G) // 40 + 1
    blk = (np.arange(len(G)) // 40)
    val_blk = set(rng.choice(nblk, max(1, nblk // 10), replace=False).tolist())
    vm = np.array([b in val_blk for b in blk])
    Gtr, Ltr, Ytr = mirror(G[~vm], LIN[~vm], Y[~vm])
    Gva, Lva, Yva = G[vm], LIN[vm], Y[vm]
    print(f"train {len(Gtr)} (mirrored) / val {len(Gva)} / feats {n}")

    h1, h2 = 48, 24
    W1 = rng.normal(0, np.sqrt(2 / n), (h1, n)); b1 = np.zeros(h1)
    W2 = rng.normal(0, np.sqrt(2 / h1), (h2, h1)); b2 = np.zeros(h2)
    W3 = rng.normal(0, np.sqrt(2 / h2), h2); b3 = 0.0
    params = [W1, b1, W2, b2, W3, np.array([b3])]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    lr, beta1, beta2, eps, l2 = 1e-3, 0.9, 0.999, 1e-8, 1e-5

    def forward(X):
        Z1 = X @ W1.T + b1; A1 = np.maximum(Z1, 0)
        Z2 = A1 @ W2.T + b2; A2 = np.maximum(Z2, 0)
        Z3 = A2 @ W3 + params[5][0]
        return Z1, A1, Z2, A2, Z3

    def val_loss():
        _, _, _, _, z = forward(Gva)
        p = 1 / (1 + np.exp(-(Lva + np.tanh(z) * CAP)))
        p = np.clip(p, 1e-9, 1 - 1e-9)
        return -np.mean(Yva * np.log(p) + (1 - Yva) * np.log(1 - p)), np.mean((p > .5) == Yva)

    best, best_params, patience, t = 1e9, None, 0, 0
    idx = np.arange(len(Gtr))
    for ep in range(300):
        rng.shuffle(idx)
        for s in range(0, len(idx), 256):
            bi = idx[s:s + 256]
            X, y, lin = Gtr[bi], Ytr[bi], Ltr[bi]
            Z1, A1, Z2, A2, Z3 = forward(X)
            th = np.tanh(Z3)
            p = 1 / (1 + np.exp(-(lin + th * CAP)))
            dz3 = (p - y) * CAP * (1 - th * th) / len(bi)
            gW3 = dz3 @ A2 + l2 * W3; gb3 = dz3.sum()
            dA2 = np.outer(dz3, W3); dZ2 = dA2 * (Z2 > 0)
            gW2 = dZ2.T @ A1 + l2 * W2; gb2 = dZ2.sum(0)
            dA1 = dZ2 @ W2; dZ1 = dA1 * (Z1 > 0)
            gW1 = dZ1.T @ X + l2 * W1; gb1 = dZ1.sum(0)
            grads = [gW1, gb1, gW2, gb2, gW3, np.array([gb3])]
            t += 1
            for i, (pr, g) in enumerate(zip(params, grads)):
                m[i] = beta1 * m[i] + (1 - beta1) * g
                v[i] = beta2 * v[i] + (1 - beta2) * g * g
                mh = m[i] / (1 - beta1 ** t); vh = v[i] / (1 - beta2 ** t)
                pr -= lr * mh / (np.sqrt(vh) + eps)
        vl, va = val_loss()
        if vl < best - 1e-5:
            best, patience = vl, 0
            best_params = [p.copy() for p in params]
        else:
            patience += 1
        if ep % 10 == 0 or patience == 0:
            print(f"ep{ep} val_loss={vl:.4f} val_acc={va:.3f} (best {best:.4f})")
        if patience >= 15:
            print(f"early stop at ep{ep}")
            break
    W1, b1, W2, b2, W3, b3a = best_params
    out = {
        "n": [n, h1, h2],
        "w1": np.round(W1.reshape(-1), 5).tolist(), "b1": np.round(b1, 5).tolist(),
        "w2": np.round(W2.reshape(-1), 5).tolist(), "b2": np.round(b2, 5).tolist(),
        "w3": np.round(W3, 5).tolist(), "b3": round(float(b3a[0]), 5),
        "cap": CAP,
    }
    json.dump(out, open(out_path, "w"))
    vl, va = val_loss()
    print(f"saved {out_path} (params={len(out['w1'])+len(out['w2'])+len(out['w3'])+h1+h2+1})")

if __name__ == "__main__":
    main()
