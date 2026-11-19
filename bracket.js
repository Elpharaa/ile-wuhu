// =====================================================================
//  Arbres de tournoi : élimination directe et double élimination
//  - generateBracket(ids, format) crée la structure (une seule fois)
//  - resolveBracket(bracket) calcule qui joue où à partir des résultats
//  Les résultats sont stockés dans bracket.results = { idMatch: { w, s:[a,b] } }
// =====================================================================

function nextPow2(n) { let p = 2; while (p < n) p *= 2; return p; }

// Ordre de placement classique : 1 contre 8, 4 contre 5, etc.
function seedOrder(size) {
  let s = [1, 2];
  while (s.length < size) {
    const n = s.length * 2;
    s = s.flatMap(x => [x, n + 1 - x]);
  }
  return s;
}

export function generateBracket(playerIds, format = 'single') {
  return bracketFromPlacement(placementFor(playerIds), format);
}

// Place les joueurs (dans l'ordre des têtes de série) sur les cases du 1er tour : 1 contre 8, 4 contre 5…
export function placementFor(playerIds, format) {
  if (format === 'ffa4') return ffaPlacement(playerIds);
  const size = nextPow2(Math.max(2, playerIds.length));
  return seedOrder(size).map(seed => playerIds[seed - 1] ?? null);
}

// Garde le placement enregistré (modifié par un admin) en l'adaptant aux inscrits :
// un joueur parti libère sa case, un nouveau prend une case libre. Si la taille de l'arbre change, on le refait.
export function syncPlacement(saved, playerIds, format) {
  if (format === 'ffa4') return ffaSync(saved, playerIds);
  const set = new Set(playerIds);
  const size = nextPow2(Math.max(2, playerIds.length));
  if (!Array.isArray(saved) || saved.length !== size) {
    const keep = Array.isArray(saved) && saved.length ? seedOrder(saved.length).map(sd => saved[sd - 1]).filter(id => id && set.has(id)) : [];
    return placementFor([...keep, ...playerIds.filter(id => !keep.includes(id))]);
  }
  const out = saved.map(id => (id && set.has(id) ? id : null));
  for (const id of playerIds) {
    if (out.includes(id)) continue;
    let i = out.findIndex((x, j) => x === null && out[j ^ 1] !== null);
    if (i < 0) i = out.indexOf(null);
    out[i] = id;
  }
  // évite qu'un joueur soit seul alors qu'un autre match a deux cases vides
  return out;
}

export function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function bracketFromPlacement(placed, format = 'single') {
  if (format === 'ffa4') return ffaBracket(placed);
  const size = placed.length;
  const k = Math.log2(size);
  const matches = [];
  const add = m => { matches.push(m); return m.id; };

  // ---- Tableau principal (gagnants) ----
  for (let r = 1; r <= k; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      const slots = r === 1
        ? [{ p: placed[2 * i] }, { p: placed[2 * i + 1] }]
        : [{ src: { m: `W${r - 1}-${2 * i}`, t: 'W' } }, { src: { m: `W${r - 1}-${2 * i + 1}`, t: 'W' } }];
      add({ id: `W${r}-${i}`, b: 'W', r, i, slots });
    }
  }

  if (format !== 'double') {
    return { format: 'single', size, rounds: { W: k }, matches, results: {} };
  }

  // ---- Tableau des perdants ----
  let lbRound = 0;
  let prev = []; // ids des matchs du tour précédent des perdants
  if (k >= 2) {
    lbRound = 1;
    const count = size / 4;
    for (let i = 0; i < count; i++) {
      prev.push(add({
        id: `L1-${i}`, b: 'L', r: 1, i,
        slots: [{ src: { m: `W1-${2 * i}`, t: 'L' } }, { src: { m: `W1-${2 * i + 1}`, t: 'L' } }],
      }));
    }
    for (let j = 2; j <= k; j++) {
      // Tour où arrivent les perdants du tour j du tableau principal
      lbRound++;
      const count2 = size / 2 ** j;
      const cur = [];
      for (let i = 0; i < count2; i++) {
        const wi = j % 2 === 0 ? count2 - 1 - i : i; // on croise pour éviter les revanches immédiates
        cur.push(add({
          id: `L${lbRound}-${i}`, b: 'L', r: lbRound, i,
          slots: [{ src: { m: prev[i], t: 'W' } }, { src: { m: `W${j}-${wi}`, t: 'L' } }],
        }));
      }
      prev = cur;
      if (j < k) {
        // Tour de consolidation entre survivants du tableau des perdants
        lbRound++;
        const count3 = prev.length / 2;
        const cur2 = [];
        for (let i = 0; i < count3; i++) {
          cur2.push(add({
            id: `L${lbRound}-${i}`, b: 'L', r: lbRound, i,
            slots: [{ src: { m: prev[2 * i], t: 'W' } }, { src: { m: prev[2 * i + 1], t: 'W' } }],
          }));
        }
        prev = cur2;
      }
    }
  }
  const lbChampion = k >= 2 ? { m: prev[0], t: 'W' } : { m: `W${k}-0`, t: 'L' };

  // ---- Grande finale (+ revanche si le joueur venu des perdants gagne) ----
  add({ id: 'GF1', b: 'GF', r: 1, i: 0, slots: [{ src: { m: `W${k}-0`, t: 'W' } }, { src: lbChampion }] });
  add({ id: 'GF2', b: 'GF', r: 2, i: 0, reset: true, slots: [{ src: { m: 'GF1', t: 'W' } }, { src: { m: 'GF1', t: 'L' } }] });

  return { format: 'double', size, rounds: { W: k, L: lbRound, GF: 2 }, matches, results: {} };
}

// Calcule l'état de chaque match.
// Pour chaque match : players [a,b], dead (match inexistant), bye (exempté),
// winner/loser, done, playable (les 2 joueurs sont connus).
export function resolveBracket(bracket) {
  if (bracket.format === 'ffa4') return ffaResolve(bracket);
  const st = {};
  const results = bracket.results || {};
  for (const m of bracket.matches) {
    const players = [null, null];
    const deadSlot = [false, false];
    m.slots.forEach((s, idx) => {
      if (s.src) {
        const o = st[s.src.m];
        players[idx] = s.src.t === 'W' ? o.winner : o.loser;
        deadSlot[idx] = s.src.t === 'W' ? o.deadWinner : o.deadLoser;
      } else {
        players[idx] = s.p ?? null;
        deadSlot[idx] = !s.p;
      }
    });

    const S = { id: m.id, players, deadSlot, winner: null, loser: null, done: false,
      dead: false, bye: false, deadWinner: false, deadLoser: false, playable: false, result: null };

    // La revanche de grande finale n'existe que si le joueur venu des perdants a gagné la GF1
    if (m.reset) {
      const g = st.GF1;
      if (g.dead || (g.done && g.winner === g.players[0])) {
        S.dead = true; S.deadWinner = S.deadLoser = true; st[m.id] = S; continue;
      }
      if (!g.done) { st[m.id] = S; continue; }
    }

    if (deadSlot[0] && deadSlot[1]) {
      S.dead = true; S.deadWinner = S.deadLoser = true;
    } else if (deadSlot[0] || deadSlot[1]) {
      S.bye = true; S.deadLoser = true;
      S.winner = deadSlot[0] ? players[1] : players[0];
      S.done = S.winner != null;
    } else if (players[0] && players[1]) {
      S.playable = true;
      const r = results[m.id];
      if (r && players.includes(r.w)) {
        S.result = r;
        S.winner = r.w;
        S.loser = players[0] === r.w ? players[1] : players[0];
        S.done = true;
      }
    }
    st[m.id] = S;
  }

  let champion = null;
  if (bracket.format === 'double') {
    const g1 = st.GF1, g2 = st.GF2;
    if (g1?.done && g1.winner === g1.players[0]) champion = g1.winner;
    else if (g2?.done) champion = g2.winner;
  } else {
    const last = bracket.matches[bracket.matches.length - 1];
    champion = st[last.id]?.winner ?? null;
  }
  return { state: st, champion };
}

export function roundTitle(bracket, b, r) {
  if (bracket.format === 'ffa4') {
    const left = bracket.rounds.W - r;
    return left === 0 ? 'Finale' : left === 1 ? 'Demi-finales' : left === 2 ? 'Quarts de finale' : `Tour ${r}`;
  }
  const R = bracket.rounds;
  if (b === 'GF') return r === 1 ? 'Grande finale' : 'Grande finale – revanche';
  if (b === 'L') return r === R.L ? 'Finale des perdants' : `Perdants – tour ${r}`;
  const left = R.W - r;
  const isDouble = bracket.format === 'double';
  if (left === 0) return isDouble ? 'Finale des gagnants' : 'Finale';
  if (left === 1) return 'Demi-finales';
  if (left === 2) return 'Quarts de finale';
  if (left === 3) return 'Huitièmes de finale';
  return `Tour ${r}`;
}

// =====================================================================
//  Chacun pour soi à 4 (1 contre 1 contre 1 contre 1)
//  Matchs de 4 joueurs, les 2 premiers passent au tour suivant, finale à 4.
//  Résultat d'un match : results[id] = { rank: [1er, 2e, 3e, 4e], by }
// =====================================================================
function ffaHeats(n) { let h = 1; while (h * 4 < n) h *= 2; return h; }
// Répartit les joueurs dans les matchs du 1er tour, le plus équitablement possible
export function ffaPlacement(ids) {
  const h = ffaHeats(Math.max(3, ids.length));
  const out = Array(h * 4).fill(null);
  ids.forEach((id, j) => { out[(j % h) * 4 + Math.floor(j / h)] = id; });
  return out;
}
function ffaSync(saved, ids) {
  const set = new Set(ids);
  const h = ffaHeats(Math.max(3, ids.length));
  if (!Array.isArray(saved) || saved.length !== h * 4) return ffaPlacement(ids);
  const out = saved.map(id => (id && set.has(id) ? id : null));
  for (const id of ids) {
    if (out.includes(id)) continue;
    // va dans le match qui a le moins de joueurs
    let best = -1, bestN = 9;
    for (let k = 0; k < h; k++) {
      const n = out.slice(k * 4, k * 4 + 4).filter(Boolean).length;
      if (n < bestN && n < 4) { best = k; bestN = n; }
    }
    out[best * 4 + out.slice(best * 4, best * 4 + 4).indexOf(null)] = id;
  }
  return out;
}
function ffaBracket(placed) {
  const heats = placed.length / 4;
  const matches = [];
  let r = 1, count = heats;
  for (let i = 0; i < count; i++) matches.push({ id: `W1-${i}`, b: 'W', r: 1, i, slots: placed.slice(i * 4, i * 4 + 4).map(p => ({ p })) });
  while (count > 1) {
    r++; count /= 2;
    for (let i = 0; i < count; i++) {
      const A = `W${r - 1}-${2 * i}`, B = `W${r - 1}-${2 * i + 1}`;
      matches.push({ id: `W${r}-${i}`, b: 'W', r, i, slots: [{ src: { m: A, t: 1 } }, { src: { m: B, t: 1 } }, { src: { m: A, t: 2 } }, { src: { m: B, t: 2 } }] });
    }
  }
  return { format: 'ffa4', size: placed.length, rounds: { W: r }, matches, results: {} };
}
function ffaResolve(bracket) {
  const st = {}, results = bracket.results || {};
  for (const m of bracket.matches) {
    const players = [], deadSlot = [];
    let waiting = false;
    m.slots.forEach(sl => {
      if (sl.src) {
        const o = st[sl.src.m];
        if (!o.done && !o.dead) { waiting = true; players.push(null); deadSlot.push(false); return; }
        const p = o.qual?.[sl.src.t - 1] ?? null;
        players.push(p); deadSlot.push(!p);
      } else { players.push(sl.p ?? null); deadSlot.push(!sl.p); }
    });
    const real = players.filter(Boolean);
    const S = { id: m.id, players, deadSlot, winner: null, loser: null, done: false, dead: false, bye: false, playable: false, result: null, ranking: null, qual: null };
    if (!waiting) {
      if (!real.length) S.dead = true;
      else if (real.length <= 2) { S.bye = true; S.done = true; S.qual = real; S.ranking = real; S.winner = real[0]; }
      else {
        S.playable = true;
        const r = results[m.id];
        if (r?.rank && r.rank.length === real.length && real.every(p => r.rank.includes(p))) {
          S.result = r; S.ranking = r.rank; S.qual = r.rank.slice(0, 2); S.winner = r.rank[0]; S.done = true;
        }
      }
    }
    st[m.id] = S;
  }
  const last = st[bracket.matches[bracket.matches.length - 1].id];
  return { state: st, champion: last?.done ? last.ranking[0] : null };
}
