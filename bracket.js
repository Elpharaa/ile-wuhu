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
  const size = nextPow2(Math.max(2, playerIds.length));
  const k = Math.log2(size);
  const placed = seedOrder(size).map(seed => playerIds[seed - 1] ?? null);
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
