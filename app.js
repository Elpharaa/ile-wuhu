// =====================================================================
//  Site de l'île Wuhu — interface
// =====================================================================
import { api, DEMO } from './api.js';
import { CONFIG } from './config.js';
import { resolveBracket, roundTitle, bracketFromPlacement, placementFor, syncPlacement, shuffled } from './bracket.js';

const app = document.getElementById('app');
const state = { me: null, roles: new Map(), colors: new Map(), balances: new Map(), theme: {}, icons: {} };
let unsubscribe = null;

// ---------- Petits outils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const defAvatar = () => state.icons.avatar || DEFAULT_AVATAR;
const avatar = (p, cls = 'av') => `<img class="${cls}" src="${esc(p?.avatar_url || defAvatar())}" alt="" loading="lazy">`;
const rolePill = r => `<span class="role" style="--rc:${esc(r.color || '#99aab5')}" title="${esc(r.name)}"><i></i><span class="rn">${esc(r.name)}</span></span>`;
// Rôles du membre (identifiants Discord → noms définis par les admins)
const rolesOf = p => (p?.roles || []).map(id => state.roles.get(id)).filter(r => r && !r.hidden)
  .sort((a, b) => a.position - b.position);
const topRole = p => rolesOf(p)[0];
async function loadRoles() {
  const list = await safe(() => api.listRoles()) || [];
  state.roles = new Map(list.map(r => [r.id, r]));
}
// ---------- Rubis, points, couleurs de pseudo ----------
const RUBY_SVG = '<svg class="ruby" viewBox="0 0 24 24" aria-label="rubis"><path d="M6.5 3h11L22 9 12 21 2 9z" fill="#e0245e"/><path d="M2 9h20M6.5 3 9 9l3 12 3-12 2.5-6M9 9l3-6 3 6" fill="none" stroke="#ffb3c6" stroke-width="1.1" stroke-linejoin="round"/></svg>';
const rubis = n => `<span class="money">${I.rubis}<b>${Number(n || 0).toLocaleString('fr-FR')}</b></span>`;
const pts = n => `<span class="money pts">${I.points}<b>${Number(n || 0).toLocaleString('fr-FR')}</b></span>`;
// ---------- Icônes personnalisables (Paramètres → Icônes) ----------
const ICON_SLOTS = [
  ['logo', 'Logo du site', '🏝️'],
  ['ile', 'Illustration de l\'accueil', null],
  ['rubis', 'Rubis', null],
  ['points', 'Points', '⭐'],
  ['trophee', 'Trophée / vainqueur', '🏆'],
  ['medal1', 'Médaille d\'or (1er)', '🥇'],
  ['medal2', 'Médaille d\'argent (2e)', '🥈'],
  ['medal3', 'Médaille de bronze (3e)', '🥉'],
  ['participation', 'Participation', '🎟️'],
  ['match', 'Match / en cours', '⚔️'],
  ['inscription', 'Inscriptions ouvertes', '📝'],
  ['date', 'Date', '📅'],
  ['avatar', 'Avatar par défaut', null],
];
const iconDefault = k => k === 'rubis' ? RUBY_SVG : k === 'ile' ? ISLAND_SVG
  : k === 'avatar' ? `<img class="ic" src="${DEFAULT_AVATAR}" alt="">` : (ICON_SLOTS.find(x => x[0] === k)?.[2] ?? '');
function icon(k) {
  const url = state.icons?.[k];
  if (!url) return iconDefault(k);
  if (k === 'ile') return `<img class="island island-img" src="${esc(url)}" alt="">`;
  return `<img class="ic ic-${k} ${k === 'rubis' ? 'ruby' : ''}" src="${esc(url)}" alt="">`;
}
// I.trophee, I.rubis… renvoient l'image perso si elle existe, sinon l'emoji
const I = new Proxy({}, { get: (_, k) => icon(k) });

// ---------- Pseudos (couleur du rôle, ou effet acheté en boutique) ----------
const PER_LETTER = new Set(['led', 'vague']);
function fxName(name, effect) {
  const inner = PER_LETTER.has(effect)
    ? [...String(name ?? '')].map((c, i) => `<span class="ch" style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('')
    : esc(name);
  return `<span class="uname fx fx-${esc(effect)}" data-t="${esc(name)}">${inner}</span>`;
}
function uname(p) {
  const fx = p?.name_color && state.colors.get(p.name_color);
  if (fx?.effect) return fxName(p.username, fx.effect);
  const c = topRole(p)?.color;
  return `<span class="uname" style="${c ? `color:${esc(c)}` : ''}">${esc(p?.username)}</span>`;
}
const bal = uid => state.balances.get(uid) || { rubis: 0, points: 0 };
async function loadColors() {
  const list = await safe(() => api.listColors()) || [];
  state.colors = new Map(list.map(c => [c.id, c]));
}
async function loadBalances() {
  const list = await safe(() => api.balances()) || [];
  state.balances = new Map(list.map(b => [b.user_id, b]));
}

// ---------- Récompenses de tournoi ----------
const DEFAULT_REWARDS = {
  participation: { points: 10, rubis: 5 },
  win: { points: 5, rubis: 0 },
  first: { points: 50, rubis: 30 },
  second: { points: 25, rubis: 15 },
  third: { points: 10, rubis: 5 },
};
const rewardsOf = t => {
  const r = structuredClone(DEFAULT_REWARDS);
  for (const k of Object.keys(r)) Object.assign(r[k], t?.rewards?.[k] || {});
  return r;
};
// Calcule les gains de chacun à la fin d'un tournoi
function computeRewards(t, bracket) {
  const R = rewardsOf(t);
  const res = resolveBracket(bracket);
  if (!res.champion) return [];
  const st = res.state;
  const players = new Set();
  bracket.matches.forEach(m => m.slots.forEach(x => x.p && players.add(x.p)));
  const rows = [];
  const add = (uid, g, reason) => {
    if (uid && (g.points || g.rubis)) rows.push({ user_id: uid, points: g.points || 0, rubis: g.rubis || 0, reason: `${reason} – ${t.name}`, tournament_id: t.id });
  };
  players.forEach(u => add(u, R.participation, 'Participation'));
  const wins = new Map();
  Object.values(st).forEach(x => { if (x.playable && x.done) wins.set(x.winner, (wins.get(x.winner) || 0) + 1); });
  wins.forEach((n, u) => add(u, { points: R.win.points * n, rubis: R.win.rubis * n }, `${n} match${n > 1 ? 's' : ''} gagné${n > 1 ? 's' : ''}`));
  let second = null, thirds = [];
  if (bracket.format === 'double') {
    second = st.GF2 && !st.GF2.dead && st.GF2.done ? st.GF2.loser : st.GF1.loser;
    const lastL = bracket.matches.filter(m => m.b === 'L').pop();
    if (lastL && st[lastL.id].playable) thirds = [st[lastL.id].loser];
    else if (!lastL && st.GF1) thirds = [];
  } else {
    const k = bracket.rounds.W;
    second = st[`W${k}-0`].loser;
    if (k >= 2) thirds = bracket.matches.filter(m => m.b === 'W' && m.r === k - 1).map(m => st[m.id].playable ? st[m.id].loser : null);
  }
  add(res.champion, R.first, '🏆 Champion');
  add(second, R.second, '🥈 2e place');
  thirds.filter(Boolean).forEach(u => add(u, R.third, '🥉 3e place'));
  return rows;
}
// Remet à jour les gains d'un tournoi (efface les anciens, ajoute les nouveaux s'il est fini)
async function syncRewards(t, bracket) {
  await api.clearTournamentRewards(t.id);
  const rows = bracket ? computeRewards(t, bracket) : [];
  if (rows.length) await api.addLedger(rows);
  await loadBalances();
}

// Un tournoi terminé par un joueur (score déclaré) : un admin distribue les gains à son prochain passage
async function settlePending() {
  const list = await safe(() => api.listTournaments()) || [];
  const done = list.filter(t => t.status === 'done' && t.bracket);
  if (!done.length) return;
  const paid = new Set((await safe(() => api.ledgerForTournaments(done.map(t => t.id))) || []).map(l => l.tournament_id));
  for (const t of done) {
    if (!paid.has(t.id) && computeRewards(t, t.bracket).length) await safe(() => syncRewards(t, t.bracket));
  }
  renderNav();
}

const FORMAT = { single: 'Élimination directe', double: 'Double élimination' };
const STATUS = { open: 'Inscriptions ouvertes', running: 'En cours', done: 'Terminé' };
const fmtDate = d => d ? new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';

function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + type;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ''), 3200);
}
async function safe(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast(e.message || 'Oups, une erreur est survenue', 'err'); }
}

// ---------- Fenêtre modale ----------
const modal = document.getElementById('modal');
function openModal(html) {
  modal.querySelector('.modal-box').innerHTML = html;
  modal.classList.remove('hidden');
  return modal.querySelector('.modal-box');
}
function closeModal() { modal.classList.add('hidden'); }
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });

// ---------- Thème : fond d'écran et logo ----------
async function loadTheme() {
  const t = await safe(() => api.getTheme()) || {};
  state.theme = t.theme || {};
  state.icons = t.icons || {};
  applyTheme();
}
function applyTheme() {
  const t = state.theme, b = document.body;
  b.classList.toggle('has-bg', !!t.background_url);
  b.classList.toggle('bg-tile', t.fit === 'tile');
  b.style.setProperty('--bg-img', t.background_url ? `url("${t.background_url.replace(/"/g, '%22')}")` : 'none');
  b.style.setProperty('--bg-veil', String((t.veil ?? 30) / 100));
  const logo = $('.brand .logo'); if (logo) logo.innerHTML = I.logo;
  const fav = document.querySelector('link[rel=icon]');
  if (fav) {
    fav.dataset.def ||= fav.href;
    fav.href = state.icons.logo || fav.dataset.def;
  }
}

// =====================================================================
//  Barre du haut
// =====================================================================
function renderNav() {
  const me = state.me;
  const hash = location.hash || '#/';
  const link = (h, label) => `<a href="${h}" class="${hash === h || (h !== '#/' && hash.startsWith(h.replace(/s$/, ''))) ? 'active' : ''}">${label}</a>`;
  $('#nav').innerHTML = me?.in_guild
    ? link('#/', 'Accueil') + link('#/tournois', 'Tournois') + link('#/classement', 'Classement') + link('#/membres', 'Membres') + link('#/boutique', 'Boutique') + (me.is_admin ? link('#/roles', 'Rôles') + link('#/parametres', 'Paramètres') : '')
    : '';
  $('#user').innerHTML = me
    ? `${me.in_guild ? `<a href="#/boutique" class="wallet">${rubis(bal(me.id).rubis)}</a>` : ''}
       <a class="me" href="#/profil/${esc(me.id)}">${avatar(me, 'av sm')}${uname(me)}</a>
       <button class="btn ghost sm" id="logout">Déconnexion</button>`
    : `<button class="btn discord sm" id="login">Connexion</button>`;
  $('#logout')?.addEventListener('click', () => api.signOut().then(() => { state.me = null; location.hash = '#/'; renderNav(); route(); }));
  $('#login')?.addEventListener('click', () => api.signIn());
}

// =====================================================================
//  Routeur
// =====================================================================
async function route() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  closeModal();
  renderNav();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  if (!state.me) return pageLanding();
  if (!state.me.in_guild) return pageNotMember();
  window.scrollTo(0, 0);
  switch (parts[0]) {
    case 'tournois': return pageTournaments();
    case 'tournoi': return pageTournament(parts[1]);
    case 'competition': return pageCompetition(parts[1], parts[2]);
    case 'membres': return pageMembers();
    case 'profil': return pageProfile(parts[1] || state.me.id);
    case 'roles': return state.me.is_admin ? pageRoles() : pageHome();
    case 'classement': return pageLeaderboard();
    case 'boutique': return pageShop();
    case 'parametres': return state.me.is_admin ? pageSettings() : pageHome();
    default: return pageHome();
  }
}

// ---------- Décor : île tropicale ----------
const ISLAND_SVG = `
<svg class="island" viewBox="0 0 600 220" aria-hidden="true">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3cc3f0"/><stop offset="1" stop-color="#1689c9"/></linearGradient>
    <linearGradient id="hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd36b"/><stop offset="1" stop-color="#3fa34d"/></linearGradient>
    <linearGradient id="mount" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98a5e"/><stop offset="1" stop-color="#7d5a3c"/></linearGradient>
  </defs>
  <circle cx="500" cy="55" r="32" fill="#ffe36e"/><circle cx="500" cy="55" r="44" fill="#ffe36e" opacity=".25"/>
  <g fill="#fff" opacity=".95"><ellipse cx="110" cy="45" rx="42" ry="14"/><ellipse cx="140" cy="36" rx="28" ry="14"/><ellipse cx="380" cy="30" rx="34" ry="11"/></g>
  <path d="M230 150 L300 52 L322 60 L338 52 L410 150 Z" fill="url(#mount)"/>
  <path d="M300 52 L322 60 L338 52 L330 75 L312 72 Z" fill="#e9e1d6"/>
  <path d="M120 165 C170 120 230 110 300 120 C380 108 450 125 500 165 Z" fill="url(#hill)"/>
  <path d="M100 168 C200 150 400 150 520 168 L520 176 L100 176 Z" fill="#f6e3b4"/>
  <g transform="translate(180 128)">
    <path d="M0 40 C4 20 6 8 12 -4" stroke="#8a5a32" stroke-width="5" fill="none" stroke-linecap="round"/>
    <g fill="#36a852"><path d="M12 -4 C-6 -14 -22 -6 -28 6 C-14 -4 0 -6 12 -4Z"/><path d="M12 -4 C28 -18 46 -10 50 2 C36 -8 24 -8 12 -4Z"/><path d="M12 -4 C8 -24 22 -34 34 -32 C22 -24 16 -14 12 -4Z"/></g>
  </g>
  <rect x="0" y="172" width="600" height="48" fill="url(#sea)"/>
  <path class="wave" d="M0 180 q15 -6 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/>
</svg>`;

// =====================================================================
//  Pages
// =====================================================================
function pageLanding() {
  app.innerHTML = `
    <section class="hero">
      ${I.ile}
      <h1>Bienvenue sur l'île Wuhu</h1>
      <p>Le site du serveur : tes rôles, ton profil et tous les tournois de l'île.</p>
      <button class="btn discord big" id="login2">Se connecter avec Discord</button>
      ${DEMO ? '<p class="small">Mode démo : config.js n\'est pas encore rempli.</p>' : ''}
    </section>`;
  $('#login2').addEventListener('click', () => api.signIn());
}

function pageNotMember() {
  const err = state.me.syncError;
  app.innerHTML = `
    <section class="hero">
      ${I.ile}
      <h1>${err ? 'Connexion à Discord impossible' : 'Tu n\'es pas encore sur l\'île !'}</h1>
      <p>${err
        ? 'Le site n\'a pas réussi à récupérer tes rôles. Réessaie dans un instant.'
        : 'Ce site est réservé aux membres du serveur Discord de l\'île Wuhu.'}</p>
      ${!err && CONFIG.DISCORD_INVITE ? `<a class="btn discord big" href="${esc(CONFIG.DISCORD_INVITE)}" target="_blank" rel="noopener">Rejoindre le serveur</a>` : ''}
      <button class="btn ghost" onclick="location.reload()">Réessayer</button>
    </section>`;
}

function tournamentCard(t) {
  const n = t.participants?.[0]?.count ?? 0;
  return `
    <a class="card tcard status-${t.status} ${t.image_url ? 'has-img' : ''}" href="#/tournoi/${esc(t.id)}">
      ${t.image_url ? `<div class="tcard-img" style="background-image:url('${esc(t.image_url)}')"></div>` : ''}
      <div class="tcard-top"><span class="badge ${t.status}">${STATUS[t.status]}</span><span class="fmt">${FORMAT[t.format]}</span></div>
      <h3>${esc(t.name)}</h3>
      ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
      <p class="meta">${n} participant${n > 1 ? 's' : ''}${t.max_players ? ' / ' + t.max_players : ''}${t.starts_at ? ' · ' + esc(fmtDate(t.starts_at)) : ''}</p>
    </a>`;
}

async function pageHome() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [list0, comps0] = await Promise.all([safe(() => api.listTournaments()), safe(() => api.listCompetitions())]);
  const list = list0 || [];
  const liveComps = (comps0 || []).filter(c => compStatus(c) !== 'done');
  const me = state.me;
  const open = list.filter(t => t.status === 'open');
  const running = list.filter(t => t.status === 'running');
  app.innerHTML = `
    <section class="hero small-hero">
      ${I.ile}
      <h1>Salut ${uname(me)} !</h1>
      <div class="hero-money">${rubis(bal(me.id).rubis)} ${pts(bal(me.id).points)}</div>
      <div class="roles center">${rolesOf(me).map(rolePill).join('')}</div>
    </section>
    ${liveComps.length ? `<section><h2>Compétitions</h2><div class="grid comps">${liveComps.map(competitionCard).join('')}</div></section>` : ''}
    <section>
      <h2>En cours</h2>
      <div class="grid">${running.map(tournamentCard).join('') || '<p class="empty">Aucun tournoi en cours.</p>'}</div>
    </section>
    <section>
      <h2>Inscriptions ouvertes</h2>
      <div class="grid">${open.map(tournamentCard).join('') || '<p class="empty">Aucun tournoi ouvert pour le moment.</p>'}</div>
    </section>`;
}

function compStatus(c) {
  const ts = c.tournaments || [];
  if (!ts.length) return 'open';
  if (ts.every(t => t.status === 'done')) return 'done';
  if (ts.some(t => t.status !== 'open')) return 'running';
  return 'open';
}
function competitionCard(c) {
  const ts = c.tournaments || [];
  const st = compStatus(c);
  return `
    <a class="card ccard status-${st}" href="#/competition/${esc(c.id)}">
      ${c.image_url ? `<div class="tcard-img" style="background-image:url('${esc(c.image_url)}')"></div>` : `<div class="ccard-banner">${I.logo}${I.trophee}</div>`}
      <div class="tcard-top"><span class="badge ${st}">${STATUS[st]}</span><span class="fmt">Compétition</span></div>
      <h3>${esc(c.name)}</h3>
      ${c.starts_at ? `<p class="game">${I.date} ${esc(fmtDate(c.starts_at))}</p>` : ''}
      <div class="ccard-list">${ts.map(t => `<span class="chip">${t.status === 'done' ? I.trophee : t.status === 'running' ? I.match : I.inscription} ${esc(t.name)}</span>`).join('') || '<span class="muted">Aucun tournoi pour l\'instant</span>'}</div>
    </a>`;
}

async function pageTournaments() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [list, comps] = await Promise.all([safe(() => api.listTournaments()), safe(() => api.listCompetitions())]);
  const solo = (list || []).filter(t => !t.competition_id);
  app.innerHTML = `
    <div class="page-head">
      <h1>Tournois</h1>
      ${state.me.is_admin ? `<div class="head-actions">
        <button class="btn ghost" id="new-c">+ Compétition</button>
        <button class="btn primary" id="new-t">+ Tournoi</button></div>` : ''}
    </div>
    ${(comps || []).length ? `<section><h2>Compétitions</h2><div class="grid comps">${comps.map(competitionCard).join('')}</div></section>` : ''}
    ${['running', 'open', 'done'].map(s => {
      const items = solo.filter(t => t.status === s);
      return items.length ? `<section><h2>${(comps || []).length ? 'Tournois seuls · ' : ''}${STATUS[s]}</h2><div class="grid">${items.map(tournamentCard).join('')}</div></section>` : '';
    }).join('')}
    ${!(list || []).length && !(comps || []).length ? '<p class="empty">Aucun tournoi pour l\'instant.</p>' : ''}`;
  $('#new-t')?.addEventListener('click', () => tournamentForm());
  $('#new-c')?.addEventListener('click', () => competitionForm());
}

// ---------- Compétitions ----------
function competitionForm(c = null) {
  const toLocal = d => d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const box = openModal(`
    <h2>${c ? 'Modifier la compétition' : 'Nouvelle compétition'}</h2>
    <p class="small">Une compétition regroupe plusieurs tournois, par exemple tous ceux d'une même journée.</p>
    <form id="cform" class="form">
      <label>Nom<input name="name" required maxlength="80" value="${esc(c?.name)}" placeholder="Wuhu Contest 3"></label>
      <label>Description<textarea name="description" rows="3" maxlength="800">${esc(c?.description)}</textarea></label>
      <label>Date et heure (optionnel)<input name="starts_at" type="datetime-local" value="${toLocal(c?.starts_at)}"></label>
      ${imageFieldHtml('Image de la compétition', c?.image_url)}
      <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary">${c ? 'Enregistrer' : 'Créer'}</button></div>
    </form>`);
  const img = wireImageField(box);
  $('#cform', box).addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = {
      name: f.get('name').trim(),
      description: f.get('description').trim() || null,
      starts_at: f.get('starts_at') ? new Date(f.get('starts_at')).toISOString() : null,
    };
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true;
    await safe(async () => {
      await img.apply(data, btn);
      if (c) { await api.updateCompetition(c.id, data); toast('Compétition modifiée'); route(); }
      else { const x = await api.createCompetition(data); toast('Compétition créée ! Ajoute-lui des tournois.'); location.hash = '#/competition/' + x.id; }
    });
    btn.disabled = false;
  });
}

async function pageCompetition(id, tab = 'apercu') {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [c, ts, members, regs] = await Promise.all([safe(() => api.getCompetition(id)), safe(() => api.tournamentsOf(id)), safe(() => api.listMembers()), safe(() => api.compMembers(id))]);
  if (!c) { app.innerHTML = '<p class="empty">Cette compétition n\'existe pas (ou plus).</p>'; return; }
  const tours = ts || [];
  const people = new Map((members || []).map(m => [m.id, m]));
  const me = state.me;
  const st = compStatus({ tournaments: tours });

  // Classement général : points gagnés dans les tournois de la compétition
  const ledger = await safe(() => api.ledgerForTournaments(tours.map(t => t.id))) || [];
  const totals = new Map();
  ledger.forEach(l => {
    const x = totals.get(l.user_id) || { points: 0, rubis: 0 };
    x.points += l.points; x.rubis += l.rubis; totals.set(l.user_id, x);
  });
  const ranking = [...totals.entries()].filter(([u]) => people.has(u)).sort((a, b) => b[1].points - a[1].points);

  const tabs = [['apercu', 'Vue d\'ensemble'], ...tours.map(t => [t.id, t.name])];
  const regIds = (regs || []).map(r => r.user_id);
  const registered = regIds.includes(me.id);
  const openTours = tours.filter(t => t.status === 'open');
  app.innerHTML = `
    <a href="#/tournois" class="back">← Tous les tournois</a>
    <div class="card thead ${c.image_url ? 'with-img' : ''}">
      ${c.image_url ? `<div class="thead-img" style="background-image:url('${esc(c.image_url)}')"></div>` : ''}
      <div class="tcard-top"><span class="badge ${st}">${STATUS[st]}</span><span class="fmt">Compétition · ${tours.length} tournoi${tours.length > 1 ? 's' : ''}</span></div>
      <h1>${esc(c.name)}</h1>
      ${c.starts_at ? `<p class="meta">${I.date} ${esc(fmtDate(c.starts_at))}</p>` : ''}
      ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
      <div class="actions left comp-join">
        ${registered
          ? `<span class="pill-info">${I.inscription} Tu es inscrit à la compétition</span><button class="btn ghost sm" id="leave-c">Me désinscrire</button>`
          : openTours.length ? `<button class="btn primary" id="join-c">S'inscrire à la compétition</button>` : ''}
        <span class="small">${regIds.length} inscrit${regIds.length > 1 ? 's' : ''}${openTours.length ? ` · l'inscription vaut pour ${openTours.length > 1 ? `les ${openTours.length} tournois` : 'le tournoi'} encore ouvert${openTours.length > 1 ? 's' : ''}` : ''}</span>
      </div>
      ${regIds.length ? `<div class="comp-regs">${regIds.slice(0, 40).map(u => people.get(u)).filter(Boolean).map(p => `<a href="#/profil/${esc(p.id)}" title="${esc(p.username)}">${avatar(p, 'av sm')}</a>`).join('')}${regIds.length > 40 ? `<span class="small">+${regIds.length - 40}</span>` : ''}</div>` : ''}
      ${me.is_admin ? `
      <div class="admin-bar">
        <span class="admin-label">Admin</span>
        <button class="btn primary sm" id="add-t">+ Ajouter un tournoi</button>
        <button class="btn ghost sm" id="edit-c">Modifier</button>
        <button class="btn danger sm" id="del-c">Supprimer</button>
      </div>` : ''}
    </div>

    <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${esc(k)}">${esc(l)}</button>`).join('')}</div>
    <div id="tab-body"></div>`;

  const body = $('#tab-body');
  const showOverview = () => {
    body.innerHTML = `
      <section>
        <h2>Les tournois</h2>
        <div class="grid">${tours.map(t => {
          const champ = t.winner_id ? people.get(t.winner_id) : null;
          return tournamentCard(t).replace('</a>', champ ? `<p class="meta">${I.trophee} ${uname(champ)}</p></a>` : '</a>');
        }).join('') || '<p class="empty">Aucun tournoi pour l\'instant.</p>'}</div>
      </section>
      <section>
        <h2>Classement général</h2>
        <p class="small">Les points gagnés dans tous les tournois de la compétition.</p>
        <div class="lb-table">
          ${ranking.map(([u, x], i) => `
            <a href="#/profil/${esc(u)}" class="lb-row ${u === me.id ? 'me-row' : ''}">
              <span class="lb-rank">${[I.medal1, I.medal2, I.medal3][i] || i + 1}</span>
              ${avatar(people.get(u), 'av sm')}
              <span class="lb-name">${uname(people.get(u))}</span>
              ${pts(x.points)} ${rubis(x.rubis)}
            </a>`).join('') || '<p class="empty">Le classement apparaîtra quand les premiers tournois seront terminés.</p>'}
        </div>
      </section>`;
  };
  const showTournament = async tid => {
    const t = tours.find(x => x.id === tid);
    body.innerHTML = '<div class="loading">Chargement…</div>';
    const parts = await safe(() => api.listParticipants(tid)) || [];
    const ppl = new Map(parts.map(p => [p.user_id, p.profile]));
    const res = t.bracket ? resolveBracket(t.bracket) : null;
    body.innerHTML = `
      <section>
        <div class="page-head"><h2>${esc(t.name)}</h2><a class="btn ghost sm" href="#/tournoi/${esc(t.id)}">Ouvrir le tournoi →</a></div>
        ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
        ${res?.champion ? `<div class="card champion small-champ">${I.trophee} ${avatar(ppl.get(res.champion), 'av')} <strong>${uname(ppl.get(res.champion))}</strong></div>` : ''}
        ${t.bracket ? renderBracket(t.bracket, res, ppl)
          : `<p class="empty">${ppl.size} inscrit${ppl.size > 1 ? 's' : ''}. L'arbre apparaîtra quand le tournoi sera lancé.</p>`}
      </section>`;
  };
  const show = k => {
    app.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    if (k === 'apercu') showOverview(); else showTournament(k);
  };
  show(tours.some(t => t.id === tab) ? tab : 'apercu');
  app.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

  $('#add-t')?.addEventListener('click', () => tournamentForm(null, id));
  $('#join-c')?.addEventListener('click', () => safe(async () => {
    const r = await api.joinCompetition(id);
    const full = r?.full || [];
    toast(full.length ? `Inscrit ! Complet, pas d'inscription pour : ${full.join(', ')}` : 'Inscription validée pour toute la compétition !');
    pageCompetition(id, tab);
  }));
  $('#leave-c')?.addEventListener('click', () => safe(async () => {
    if (!confirm('Te désinscrire de la compétition ? Tu seras retiré de ses tournois qui n\'ont pas encore commencé.')) return;
    await api.leaveCompetition(id); toast('Tu es désinscrit de la compétition'); pageCompetition(id, tab);
  }));
  $('#edit-c')?.addEventListener('click', () => competitionForm(c));
  $('#del-c')?.addEventListener('click', () => safe(async () => {
    if (!confirm(`Supprimer la compétition « ${c.name} » ? Ses tournois seront gardés, mais ne seront plus regroupés.`)) return;
    await api.deleteCompetition(id); toast('Compétition supprimée'); location.hash = '#/tournois';
  }));
}

// ---------- Formulaire de création / modification ----------
async function tournamentForm(t = null, presetComp = null) {
  const comps = await safe(() => api.listCompetitions()) || [];
  const toLocal = d => d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const box = openModal(`
    <h2>${t ? 'Modifier le tournoi' : 'Nouveau tournoi'}</h2>
    <form id="tform" class="form">
      <label>Nom<input name="name" required maxlength="80" value="${esc(t?.name)}" placeholder="Coupe de tennis de Wuhu"></label>
      <label>Jeu<input name="game" maxlength="80" value="${esc(t?.game)}" placeholder="Wii Sports Resort – Tennis"></label>
      <label>Description<textarea name="description" rows="3" maxlength="600">${esc(t?.description)}</textarea></label>
      <div class="row">
        <label>Format
          <select name="format" ${t?.status === 'running' || t?.status === 'done' ? 'disabled' : ''}>
            <option value="single" ${t?.format !== 'double' ? 'selected' : ''}>Élimination directe</option>
            <option value="double" ${t?.format === 'double' ? 'selected' : ''}>Double élimination</option>
          </select>
        </label>
        <label>Places max<input name="max_players" type="number" min="2" max="128" value="${esc(t?.max_players)}" placeholder="Illimité"></label>
      </div>
      <label>Date et heure (optionnel)<input name="starts_at" type="datetime-local" value="${toLocal(t?.starts_at)}"></label>
      <label>Compétition
        <select name="competition_id">
          <option value="">— Aucune (tournoi seul) —</option>
          ${comps.map(c => `<option value="${esc(c.id)}" ${(t?.competition_id ?? presetComp) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      ${imageFieldHtml('Image du tournoi', t?.image_url)}
      <details class="rewards">
        <summary>Récompenses (${I.rubis} rubis et ${I.points} points)</summary>
        <table>
          <tr><th></th><th>${I.points} Points</th><th>${I.rubis} Rubis</th></tr>
          ${[['participation', 'Participation'], ['win', 'Par match gagné'], ['first', `${I.trophee} Champion`], ['second', `${I.medal2} 2e`], ['third', `${I.medal3} 3e`]].map(([k, l]) => `
          <tr><td>${l}</td>
            <td><input type="number" min="0" max="10000" name="rw_${k}_points" value="${rewardsOf(t)[k].points}"></td>
            <td><input type="number" min="0" max="10000" name="rw_${k}_rubis" value="${rewardsOf(t)[k].rubis}"></td></tr>`).join('')}
        </table>
        <small class="muted">Gagnés automatiquement quand le tournoi se termine.</small>
      </details>
      <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary">${t ? 'Enregistrer' : 'Créer'}</button></div>
    </form>`);
  $('#tform', box).addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = {
      name: f.get('name').trim(),
      game: f.get('game').trim() || null,
      description: f.get('description').trim() || null,
      max_players: f.get('max_players') ? Number(f.get('max_players')) : null,
      starts_at: f.get('starts_at') ? new Date(f.get('starts_at')).toISOString() : null,
    };
    if (f.get('format')) data.format = f.get('format');
    data.competition_id = f.get('competition_id') || null;
    data.rewards = {};
    for (const k of Object.keys(DEFAULT_REWARDS)) {
      data.rewards[k] = { points: Number(f.get(`rw_${k}_points`)) || 0, rubis: Number(f.get(`rw_${k}_rubis`)) || 0 };
    }
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true;
    await safe(async () => {
      await img.apply(data, btn);
      if (t) { await api.updateTournament(t.id, data); toast('Tournoi modifié'); route(); }
      else { const x = await api.createTournament(data); toast('Tournoi créé !'); location.hash = '#/tournoi/' + x.id; }
      if (t?.status === 'done') { await syncRewards({ ...t, ...data }, t.bracket); }
    });
    btn.disabled = false;
  });
  const img = wireImageField(box);
}

// ---------- Champ image avec recadrage (réutilisable) ----------
function imageFieldHtml(label, url) {
  return `
      <div class="img-field">
        <span>${label}</span>
        <div class="img-preview" id="img-prev" style="${url ? `background-image:url('${esc(url)}')` : ''}">${url ? '' : 'Aucune image'}</div>
        <div class="cropper hidden" id="cropper"><div class="crop-bg"></div><img alt="" draggable="false"><div class="crop-hint">Glisse pour déplacer</div></div>
        <div class="crop-tools hidden" id="zoom-row">
          <button type="button" class="btn ghost sm" id="z-out" title="Rétrécir">−</button>
          <input type="range" id="zoom" min="0.2" max="4" step="0.01" value="1" aria-label="Taille de l'image">
          <button type="button" class="btn ghost sm" id="z-in" title="Agrandir">+</button>
          <button type="button" class="btn ghost sm" id="z-fit">Image entière</button>
          <button type="button" class="btn ghost sm" id="z-fill">Remplir</button>
        </div>
        <div class="row">
          <label class="btn ghost sm file-btn">Choisir une image<input type="file" id="img-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
          ${url ? '<button type="button" class="btn ghost sm" id="img-recrop">Recadrer l\'image actuelle</button>' : ''}
          <button type="button" class="btn ghost sm" id="img-clear">Retirer</button>
        </div>
        <small class="muted">Le cadre montre exactement la bannière affichée sur le site. Déplace l'image, et utilise − / + (ou la molette, ou deux doigts) pour la rétrécir ou l'agrandir. « Image entière » la fait tenir en entier, les bords sont alors remplis par un fond flouté.</small>
      </div>`;
}
function wireImageField(box) {
  let crop = null, cleared = false;
  const prev = $('#img-prev', box);
  const start = async f => {
    cleared = false;
    prev.classList.add('hidden');
    crop = await makeCropper($('#cropper', box), $('#zoom', box), f, box);
    $('#zoom-row', box).classList.remove('hidden');
  };
  $('#img-file', box).addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast('Image trop lourde (20 Mo maximum)', 'err'); return; }
    await start(f);
  });
  $('#img-recrop', box)?.addEventListener('click', () => safe(async () => {
    const url = (prev.style.backgroundImage.match(/url\("?(.*?)"?\)/) || [])[1];
    if (!url) return;
    const blob = await (await fetch(url)).blob();
    await start(new File([blob], 'image', { type: blob.type || 'image/jpeg' }));
  }));
  $('#img-clear', box).addEventListener('click', () => {
    crop = null; cleared = true;
    $('#cropper', box).classList.add('hidden'); $('#zoom-row', box).classList.add('hidden');
    $('#img-recrop', box)?.remove();
    prev.classList.remove('hidden'); prev.style.backgroundImage = ''; prev.textContent = 'Aucune image';
  });
  return {
    async apply(data, btn) {
      if (crop) { if (btn) btn.textContent = 'Envoi de l\'image…'; data.image_url = await api.uploadImage(await crop.toFile()); }
      else if (cleared) data.image_url = null;
    },
  };
}

// ---------- Recadrage d'image (format 2:1, exactement comme les bannières) ----------
const CROP_W = 1200, CROP_H = 600;
function makeCropper(box, zoomInput, file, root = document) {
  return new Promise((resolve, reject) => {
    const img = box.querySelector('img');
    const bg = box.querySelector('.crop-bg');
    const url = URL.createObjectURL(file);
    img.onload = () => {
      box.classList.remove('hidden');
      if (bg) bg.style.backgroundImage = `url("${url}")`;
      const nw = img.naturalWidth, nh = img.naturalHeight;
      // zoom = 1 : l'image remplit tout le cadre ; minZoom : l'image tient en entier
      let W, H, base, minZoom, zoom = 1, x = 0, y = 0;
      const measure = () => {
        W = box.clientWidth; H = box.clientHeight;
        base = Math.max(W / nw, H / nh);
        minZoom = Math.min(1, Math.min(W / nw, H / nh) / base);
        zoomInput.min = String(Math.max(0.05, minZoom * 0.5));
      };
      const clampAxis = (v, size, frame) => size >= frame ? Math.min(0, Math.max(frame - size, v)) : Math.max(0, Math.min(frame - size, v));
      const draw = () => {
        const s = base * zoom;
        x = clampAxis(x, nw * s, W); y = clampAxis(y, nh * s, H);
        img.style.width = nw * s + 'px'; img.style.height = nh * s + 'px';
        img.style.transform = `translate(${x}px, ${y}px)`;
        box.classList.toggle('show-bg', nw * s < W - 1 || nh * s < H - 1);
      };
      const setZoom = z => {
        const old = base * zoom;
        zoom = Math.min(4, Math.max(Number(zoomInput.min), z));
        const s = base * zoom;
        x = W / 2 - (W / 2 - x) * s / old; y = H / 2 - (H / 2 - y) * s / old;
        zoomInput.value = zoom; draw();
      };
      const center = () => { const s = base * zoom; x = (W - nw * s) / 2; y = (H - nh * s) / 2; draw(); };
      measure();
      zoom = 1; zoomInput.value = 1; center();
      zoomInput.oninput = () => setZoom(Number(zoomInput.value));
      const btn = id => root.querySelector ? root.querySelector(id) : null;
      if (btn('#z-in')) btn('#z-in').onclick = () => setZoom(zoom * 1.15);
      if (btn('#z-out')) btn('#z-out').onclick = () => setZoom(zoom / 1.15);
      if (btn('#z-fit')) btn('#z-fit').onclick = () => { zoom = minZoom; zoomInput.value = zoom; center(); };
      if (btn('#z-fill')) btn('#z-fill').onclick = () => { zoom = 1; zoomInput.value = zoom; center(); };
      box.onwheel = e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
      // Glisser (souris et doigt), et pincer pour zoomer sur téléphone
      const pts = new Map();
      let last = null, pinch = null;
      box.onpointerdown = e => { box.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; box.classList.add('dragging'); };
      box.onpointermove = e => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (pinch) setZoom(zoom * d / pinch);
          pinch = d; return;
        }
        x += e.clientX - last[0]; y += e.clientY - last[1]; last = [e.clientX, e.clientY]; draw();
      };
      box.onpointerup = box.onpointercancel = e => {
        pts.delete(e.pointerId); pinch = null; box.classList.remove('dragging');
        const rest = [...pts.values()][0]; if (rest) last = rest;
      };
      const onResize = () => {
        if (!box.isConnected) return window.removeEventListener('resize', onResize);
        const fx = x / W, fy = y / H; measure(); x = fx * W; y = fy * H; draw();
      };
      window.addEventListener('resize', onResize);
      resolve({
        toFile: () => new Promise(res => {
          const k = CROP_W / W, s = base * zoom;
          const c = document.createElement('canvas'); c.width = CROP_W; c.height = CROP_H;
          const ctx = c.getContext('2d');
          if (nw * s < W - 1 || nh * s < H - 1) {
            // Bords vides : fond flouté fait avec la même image
            ctx.fillStyle = '#1b2b38'; ctx.fillRect(0, 0, CROP_W, CROP_H);
            const cs = Math.max(CROP_W / nw, CROP_H / nh) * 1.1;
            ctx.filter = 'blur(28px) brightness(.8)';
            ctx.drawImage(img, (CROP_W - nw * cs) / 2, (CROP_H - nh * cs) / 2, nw * cs, nh * cs);
            ctx.filter = 'none';
          }
          ctx.drawImage(img, x * k, y * k, nw * s * k, nh * s * k);
          c.toBlob(b => res(new File([b], 'banniere.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.88);
        }),
      });
    };
    img.onerror = () => { toast('Impossible de lire cette image', 'err'); reject(new Error('image')); };
    img.src = url;
  });
}

// ---------- Encadré des récompenses ----------
function rewardsBox(t) {
  const R = rewardsOf(t);
  const gain = g => `<span class="rw-gain">${g.points ? `<b class="rw-pts">+${g.points} pts</b>` : ''}${g.rubis ? `<b class="rw-rb">${I.rubis} +${g.rubis}</b>` : ''}${!g.points && !g.rubis ? '<span class="muted">—</span>' : ''}</span>`;
  const items = [
    [I.trophee, 'Vainqueur', R.first], [I.medal2, '2e place', R.second], [I.medal3, '3e place', R.third],
    [I.participation, 'Participation', R.participation], [I.match, 'Par match gagné', R.win],
  ].filter(([, , g]) => g.points || g.rubis);
  if (!items.length) return '';
  return `<div class="rewards-box">
    <div class="rw-title">Récompenses</div>
    <div class="rw-grid">${items.map(([ic, label, g]) => `
      <div class="rw-item"><span class="rw-icon">${ic}</span><span class="rw-label">${label}</span>${gain(g)}</div>`).join('')}
    </div>
  </div>`;
}

// ---------- Page d'un tournoi ----------
async function pageTournament(id) {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [t, parts] = await Promise.all([safe(() => api.getTournament(id)), safe(() => api.listParticipants(id))]);
  if (!t) { app.innerHTML = '<p class="empty">Ce tournoi n\'existe pas (ou plus).</p>'; return; }
  const me = state.me;
  const people = new Map((parts || []).map(p => [p.user_id, p.profile]));
  const joined = people.has(me.id);
  const full = t.max_players && people.size >= t.max_players;
  const res = t.bracket ? resolveBracket(t.bracket) : null;
  const champ = res?.champion ? people.get(res.champion) : null;
  const comp = t.competition_id ? await safe(() => api.getCompetition(t.competition_id)) : null;
  // Matchs que je peux renseigner : tous pour un admin, seulement le mien (pas encore joué) pour un joueur
  const ids = [...people.keys()];
  const placement = t.status === 'open' && ids.length >= 2 ? syncPlacement(t.seeding, ids) : null;
  const preview = placement ? bracketFromPlacement(placement, t.format) : null;
  const canReport = s => s.playable && (me.is_admin || (t.status === 'running' && !s.done && s.players.includes(me.id)));
  const myMatch = res ? Object.values(res.state).find(s => !me.is_admin && canReport(s)) : null;

  app.innerHTML = `
    ${comp ? `<a href="#/competition/${esc(comp.id)}" class="back">← ${esc(comp.name)}</a>` : '<a href="#/tournois" class="back">← Tous les tournois</a>'}
    <div class="card thead ${t.image_url ? 'with-img' : ''}">
      ${t.image_url ? `<div class="thead-img" style="background-image:url('${esc(t.image_url)}')"></div>` : ''}
      <div class="tcard-top"><span class="badge ${t.status}">${STATUS[t.status]}</span><span class="fmt">${FORMAT[t.format]}</span></div>
      <h1>${esc(t.name)}</h1>
      ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
      ${t.starts_at ? `<p class="meta">${I.date} ${esc(fmtDate(t.starts_at))}</p>` : ''}
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
      ${rewardsBox(t)}
      <div class="actions left">
        ${t.status === 'open' && !joined && !full ? '<button class="btn primary" id="join">Participer</button>' : ''}
        ${t.status === 'open' && joined ? '<button class="btn ghost" id="leave">Me désinscrire</button>' : ''}
        ${t.status === 'open' && !joined && full ? '<span class="pill-info">Complet</span>' : ''}
      </div>
      ${me.is_admin ? `
      <div class="admin-bar">
        <span class="admin-label">Admin</span>
        ${t.status === 'open' ? '<button class="btn primary sm" id="launch">Lancer le tournoi</button>' : ''}
        ${t.status !== 'open' ? '<button class="btn ghost sm" id="reopen">Remettre en inscriptions</button>' : ''}
        <button class="btn ghost sm" id="edit">Modifier</button>
        <button class="btn danger sm" id="del">Supprimer</button>
      </div>` : ''}
    </div>

    ${champ ? `<div class="card champion">${I.trophee} <div>${avatar(champ, 'av lg')}</div><div><small>Vainqueur</small><strong>${uname(champ)}</strong></div></div>` : ''}

    ${t.bracket ? `
      <section>
        <h2>Arbre du tournoi</h2>
        ${me.is_admin && t.status !== 'done' ? '<p class="hint">Clique sur un match pour entrer le score. Les joueurs peuvent aussi déclarer le score de leur propre match.</p>' : ''}
        ${myMatch ? '<p class="hint mine-hint">C\'est ton tour ! Clique sur ton match (celui qui clignote) pour déclarer le score une fois joué.</p>' : ''}
        ${me.is_admin && t.status === 'running' ? `<div class="edit-bar"><button class="btn ghost sm" id="edit-tree">✏️ Modifier l'arbre</button></div>` : ''}
        <div id="real-bracket">${renderBracket(t.bracket, res, people)}</div>
      </section>` : ''}

    ${preview ? `
      <section>
        <h2>Aperçu de l'arbre</h2>
        <p class="hint">${me.is_admin
          ? 'Voici l\'arbre tel qu\'il sera lancé. Clique sur un joueur puis sur un autre (ou sur une case « Exempt ») pour les échanger.'
          : 'Voici l\'arbre provisoire : il peut encore changer jusqu\'au lancement.'}</p>
        ${me.is_admin ? `<div class="edit-bar">
          <button class="btn ghost sm" id="shuffle">🔀 Mélanger au hasard</button>
          <button class="btn ghost sm" id="reset-order">Ordre d'inscription</button>
        </div>` : ''}
        <div id="preview-bracket" class="${me.is_admin ? 'swappable' : ''}">${renderBracket(preview, resolveBracket(preview), people)}</div>
      </section>` : ''}

    <section>
      <h2>Participants (${people.size}${t.max_players ? ' / ' + t.max_players : ''})</h2>
      <div class="players">
        ${[...people.entries()].map(([uid, p]) => `
          <div class="player">
            <a href="#/profil/${esc(uid)}">${avatar(p)}${uname(p)}</a>
            ${topRole(p) ? rolePill(topRole(p)) : ''}
            ${me.is_admin && t.status === 'open' ? `<button class="x" data-kick="${esc(uid)}" title="Retirer">✕</button>` : ''}
          </div>`).join('') || '<p class="empty">Personne pour l\'instant. Sois le premier !</p>'}
      </div>
    </section>`;

  const reload = () => pageTournament(id);
  $('#join')?.addEventListener('click', () => safe(async () => { await api.join(id, me.id); toast('Inscription validée !'); reload(); }));
  $('#leave')?.addEventListener('click', () => safe(async () => { await api.leave(id, me.id); toast('Tu es désinscrit'); reload(); }));
  app.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => safe(async () => {
    if (!confirm('Retirer ce participant ?')) return;
    await api.leave(id, b.dataset.kick); reload();
  })));
  $('#edit')?.addEventListener('click', () => tournamentForm(t));
  $('#del')?.addEventListener('click', () => safe(async () => {
    if (!confirm(`Supprimer définitivement « ${t.name} » ?`)) return;
    await api.clearTournamentRewards(id); await loadBalances();
    await api.deleteTournament(id); toast('Tournoi supprimé'); location.hash = '#/tournois';
  }));
  $('#reopen')?.addEventListener('click', () => safe(async () => {
    if (!confirm('L\'arbre et tous les scores seront effacés. Continuer ?')) return;
    await api.updateTournament(id, { status: 'open', bracket: null, winner_id: null });
    await syncRewards(t, null); renderNav(); reload();
  }));
  $('#launch')?.addEventListener('click', () => launchDialog(t, placement, reload));

  // ----- Aperçu (avant lancement) : échanger, mélanger -----
  const savePlacement = pl => safe(async () => { await api.updateTournament(t.id, { seeding: pl }); reload(); });
  $('#shuffle')?.addEventListener('click', () => savePlacement(placementFor(shuffled(ids))));
  $('#reset-order')?.addEventListener('click', () => savePlacement(placementFor(ids)));
  if (me.is_admin && preview) wireSwap($('#preview-bracket'), (a, b) => {
    const pl = [...placement]; [pl[a], pl[b]] = [pl[b], pl[a]]; savePlacement(pl);
  });

  // ----- Arbre lancé : un admin peut échanger les joueurs du 1er tour -----
  $('#edit-tree')?.addEventListener('click', () => {
    const box = $('#real-bracket');
    const on = box.classList.toggle('swappable');
    $('#edit-tree').textContent = on ? '✔ Terminer la modification' : '✏️ Modifier l\'arbre';
    if (on) {
      toast('Clique sur deux joueurs du 1er tour pour les échanger');
      wireSwap(box, (a, b) => safe(async () => {
        const bracket = structuredClone(t.bracket);
        const W1 = bracket.matches.filter(m => m.b === 'W' && m.r === 1);
        const slotOf = n => W1[Math.floor(n / 2)].slots[n % 2];
        const touched = new Set([W1[Math.floor(a / 2)].id, W1[Math.floor(b / 2)].id]);
        if ([...touched].some(mid => bracket.results?.[mid]) &&
            !confirm('Ces matchs ont déjà un résultat : il sera effacé. Continuer ?')) return;
        const pa = slotOf(a).p ?? null, pb = slotOf(b).p ?? null;
        slotOf(a).p = pb; slotOf(b).p = pa;
        touched.forEach(mid => delete bracket.results?.[mid]);
        const r = resolveBracket(bracket);
        await api.updateTournament(t.id, { bracket, status: r.champion ? 'done' : 'running', winner_id: r.champion ?? null });
        toast('Arbre modifié'); reload();
      }));
    } else reload();
  });

  // Les admins peuvent entrer (ou corriger, même après la fin) un score ;
  // les deux joueurs d'un match peuvent déclarer leur résultat (une seule fois)
  if (t.bracket) {
    app.querySelectorAll('#real-bracket .match.playable').forEach(el => {
      const s = res.state[el.dataset.mid];
      if (!canReport(s)) return;
      el.classList.add('editable');
      if (!me.is_admin) el.classList.add('mine');
      el.addEventListener('click', () => scoreDialog(t, s, people, reload, !me.is_admin));
    });
  }
  // Tournoi terminé par un joueur : l'admin qui passe distribue les gains
  if (me.is_admin && t.status === 'done' && t.bracket) {
    safe(async () => {
      const paid = await api.ledgerForTournaments([t.id]);
      if (!paid.length && computeRewards(t, t.bracket).length) { await syncRewards(t, t.bracket); renderNav(); }
    });
  }

  // Mise à jour en direct quand un admin entre un score
  let timer;
  unsubscribe = api.subscribe(id, () => { clearTimeout(timer); timer = setTimeout(() => { if (modal.classList.contains('hidden')) reload(); }, 400); });
}

function launchDialog(t, placement, reload) {
  const n = (placement || []).filter(Boolean).length;
  if (n < 2) return toast('Il faut au moins 2 participants', 'err');
  const box = openModal(`
    <h2>Lancer « ${esc(t.name)} »</h2>
    <p>${n} participants · ${FORMAT[t.format]}. Les inscriptions seront fermées.</p>
    <p class="small">L'arbre lancé sera celui de l'aperçu (tu peux encore le modifier après le lancement).</p>
    <label class="radio"><input type="checkbox" id="mix"> Mélanger au hasard juste avant de lancer</label>
    <div class="actions"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="go">C'est parti !</button></div>`);
  $('#go', box).addEventListener('click', () => safe(async () => {
    const pl = $('#mix', box).checked ? placementFor(shuffled(placement.filter(Boolean))) : placement;
    const bracket = bracketFromPlacement(pl, t.format);
    await api.updateTournament(t.id, { status: 'running', bracket, seeding: pl, winner_id: null });
    closeModal(); toast('Le tournoi commence !'); reload();
  }));
}

// Échange de deux cases du 1er tour : clic sur une case, puis sur une autre
function wireSwap(root, onSwap) {
  let first = null;
  root.querySelectorAll('.match[data-mid^="W1-"] .mslot').forEach(el => {
    el.classList.add('pickable');
    el.addEventListener('click', e => {
      if (!root.classList.contains('swappable')) return;
      e.stopPropagation();
      const n = Number(el.closest('.match').dataset.mid.split('-')[1]) * 2 + Number(el.dataset.si);
      if (first === null) { first = n; el.classList.add('picked'); return; }
      root.querySelectorAll('.picked').forEach(x => x.classList.remove('picked'));
      const a = first; first = null;
      if (a !== n) onSwap(a, n);
    });
  });
}

function scoreDialog(t, s, people, reload, asPlayer = false) {
  const [a, b] = s.players.map(id => people.get(id) || { username: '?' });
  const cur = s.result;
  const by = cur?.by ? people.get(cur.by) : null;
  const box = openModal(`
    <h2>${asPlayer ? 'Déclarer le résultat' : 'Résultat du match'}</h2>
    ${asPlayer ? '<p class="small center">Tout le monde verra ce résultat. En cas d\'erreur, seul un admin pourra le corriger.</p>' : ''}
    ${!asPlayer && by ? `<p class="small center">Déclaré par ${uname(by)}</p>` : ''}
    <div class="score-form">
      <div class="sf-player">${avatar(a, 'av lg')}<strong>${esc(a.username)}</strong><input type="number" min="0" id="s0" value="${cur?.s?.[0] ?? ''}" placeholder="Score"></div>
      <span class="vs">VS</span>
      <div class="sf-player">${avatar(b, 'av lg')}<strong>${esc(b.username)}</strong><input type="number" min="0" id="s1" value="${cur?.s?.[1] ?? ''}" placeholder="Score"></div>
    </div>
    <p class="small center">Le score est facultatif : choisis simplement le vainqueur.</p>
    <div class="actions center">
      <button class="btn primary" data-w="0">${esc(a.username)} gagne</button>
      <button class="btn primary" data-w="1">${esc(b.username)} gagne</button>
    </div>
    ${cur && !asPlayer ? '<div class="actions center"><button class="btn danger sm" id="clear">Effacer le résultat</button></div>' : ''}`);

  const save = async w => {
    if (asPlayer) {
      const s0 = $('#s0', box).value, s1 = $('#s1', box).value;
      const name = (w === 0 ? a : b).username;
      if (!confirm(`Confirmer : ${name} gagne ce match ?`)) return;
      const r = await api.reportScore(t.id, s.id, s.players[w], s0 === '' ? null : Number(s0), s1 === '' ? null : Number(s1));
      closeModal();
      toast(r?.champion ? '🏆 Tournoi terminé ! Les récompenses arrivent au prochain passage d\'un admin.' : 'Résultat enregistré, merci !');
      reload();
      return;
    }
    const bracket = structuredClone(t.bracket);
    bracket.results = bracket.results || {};
    if (w == null) delete bracket.results[s.id];
    else {
      const s0 = $('#s0', box).value, s1 = $('#s1', box).value;
      bracket.results[s.id] = { w: s.players[w], s: s0 !== '' || s1 !== '' ? [Number(s0) || 0, Number(s1) || 0] : null };
    }
    const r = resolveBracket(bracket);
    await api.updateTournament(t.id, { bracket, status: r.champion ? 'done' : 'running', winner_id: r.champion ?? null });
    if (r.champion || t.status === 'done') { await syncRewards(t, bracket); renderNav(); }
    closeModal();
    if (r.champion) toast('🏆 Nous avons un champion ! Les récompenses sont distribuées.'); else toast('Score enregistré');
    reload();
  };
  // Choisit automatiquement le vainqueur si les scores sont différents
  const auto = () => {
    const v0 = $('#s0', box).value, v1 = $('#s1', box).value;
    box.querySelectorAll('[data-w]').forEach(btn => btn.classList.toggle('suggest',
      v0 !== '' && v1 !== '' && Number(v0) !== Number(v1) && (Number(v0) > Number(v1) ? '0' : '1') === btn.dataset.w));
  };
  box.querySelectorAll('input').forEach(i => i.addEventListener('input', auto)); auto();
  box.querySelectorAll('[data-w]').forEach(btn => btn.addEventListener('click', () => safe(() => save(Number(btn.dataset.w)))));
  $('#clear', box)?.addEventListener('click', () => safe(() => save(null)));
}

// ---------- Dessin de l'arbre ----------
function renderBracket(bracket, res, people) {
  const sections = bracket.format === 'double'
    ? [['W', 'Tableau des gagnants'], ['L', 'Tableau des perdants'], ['GF', 'Grande finale']]
    : [['W', null]];
  return sections.map(([b, title]) => {
    const rounds = {};
    bracket.matches.filter(m => m.b === b).forEach(m => (rounds[m.r] ||= []).push(m));
    const cols = Object.keys(rounds).map(Number).sort((x, y) => x - y)
      .filter(r => !(b === 'GF' && r === 2 && res.state.GF2.dead))
      .filter(r => rounds[r].some(m => !res.state[m.id].dead));
    if (!cols.length) return '';
    return `
      ${title ? `<h3 class="bracket-title">${title}</h3>` : ''}
      <div class="bracket-scroll"><div class="bracket ${b === 'W' ? 'tree' : ''}">
        ${cols.map(r => `
          <div class="round">
            <h4>${roundTitle(bracket, b, r)}</h4>
            <div class="round-matches">${rounds[r].map(m => matchCard(res.state[m.id], people, b === 'W')).join('')}</div>
          </div>`).join('')}
      </div></div>`;
  }).join('');
}

function matchCard(s, people, keepGhost) {
  if (s.dead) return keepGhost ? '<div class="match ghost"></div>' : '';
  const slot = idx => {
    const id = s.players[idx];
    const p = id ? people.get(id) : null;
    const isW = s.done && s.winner && s.winner === id;
    const isL = s.done && !s.bye && s.loser === id;
    const sc = s.result?.s ? s.result.s[idx] : '';
    let label;
    if (p) label = `${avatar(p, 'av xs')}<span class="name">${uname(p)}</span>`;
    else if (s.deadSlot[idx]) label = `<span class="name muted">Exempt</span>`;
    else label = `<span class="name muted">En attente…</span>`;
    return `<div class="mslot ${isW ? 'win' : ''} ${isL ? 'lose' : ''}" data-si="${idx}">${label}<span class="score">${isW && sc === '' ? '✓' : esc(sc)}</span></div>`;
  };
  return `<div class="match ${s.playable ? 'playable' : ''} ${s.done ? 'done' : ''} ${s.bye ? 'bye' : ''}" data-mid="${esc(s.id)}">${slot(0)}${slot(1)}</div>`;
}

// ---------- Membres ----------
async function pageMembers() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const list = await safe(() => api.listMembers()) || [];
  app.innerHTML = `
    <div class="page-head"><h1>Membres de l'île</h1><input class="search" id="q" placeholder="Rechercher…"></div>
    <p class="small">Seuls les membres qui se sont déjà connectés au site apparaissent ici.</p>
    <div class="grid members" id="mlist"></div>`;
  const draw = q => {
    $('#mlist').innerHTML = list.filter(p => !q || p.username?.toLowerCase().includes(q) || rolesOf(p).some(r => r.name.toLowerCase().includes(q)))
      .map(p => `<a class="card member" href="#/profil/${esc(p.id)}">${avatar(p, 'av lg')}<strong>${uname(p)}</strong>${topRole(p) ? rolePill(topRole(p)) : ''}<span class="member-money">${pts(bal(p.id).points)} ${rubis(bal(p.id).rubis)}</span></a>`)
      .join('') || '<p class="empty">Aucun membre trouvé.</p>';
  };
  draw('');
  $('#q').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
}

// ---------- Profil ----------
async function pageProfile(id) {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  await loadBalances();
  const [p, ts, hist] = await Promise.all([safe(() => api.getProfile(id)), safe(() => api.userStats(id)), safe(() => api.ledger(id))]);
  if (!p) { app.innerHTML = '<p class="empty">Profil introuvable.</p>'; return; }
  const tours = ts || [];
  const wins = tours.filter(t => t.winner_id === id);
  const color = topRole(p)?.color || '#2fa4e7';
  app.innerHTML = `
    <div class="card profile" style="--pc:${esc(color)}">
      <div class="profile-banner"></div>
      <div class="profile-body">
        ${avatar(p, 'av xl')}
        <h1>${uname(p)}</h1>
        ${p.is_admin ? '<span class="pill-info">Organisateur de tournois</span>' : ''}
        <h3>Rôles sur le serveur</h3>
        <div class="roles">${rolesOf(p).map(rolePill).join('') || '<span class="muted">Aucun rôle</span>'}</div>
        ${p.id === state.me.id ? '<button class="btn ghost sm refresh" id="refresh-roles">↻ Actualiser mes rôles</button>' : ''}
        <div class="stats">
          <div><strong>${tours.length}</strong><span>tournoi${tours.length > 1 ? 's' : ''} joué${tours.length > 1 ? 's' : ''}</span></div>
          <div><strong>${wins.length}</strong><span>victoire${wins.length > 1 ? 's' : ''} ${I.trophee}</span></div>
          <div><strong>${pts(bal(id).points)}</strong><span>points · ${rankOf(id)}</span></div>
          <div><strong>${rubis(bal(id).rubis)}</strong><span>rubis</span></div>
        </div>
        ${state.me.is_admin ? `<button class="btn ghost sm" id="give">${I.rubis} Donner / retirer des rubis ou points</button>` : ''}
      </div>
    </div>
    <section>
      <h2>Tournois</h2>
      <div class="tlist">
        ${tours.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(t => `
          <a href="#/tournoi/${esc(t.id)}" class="tline">
            <span>${t.winner_id === id ? I.trophee + ' ' : ''}${esc(t.name)}</span>
            <span class="badge ${t.status}">${STATUS[t.status]}</span>
          </a>`).join('') || '<p class="empty">Pas encore de tournoi.</p>'}
      </div>
    </section>
    <section>
      <h2>Historique des gains</h2>
      <div class="tlist">
        ${(hist || []).map(l => `
          <div class="tline">
            <span>${esc(l.reason)}<small class="muted"> · ${new Date(l.created_at).toLocaleDateString('fr-FR')}</small></span>
            <span class="gain">${l.points ? `<span class="${l.points < 0 ? 'neg' : ''}">${l.points > 0 ? '+' : ''}${pts(l.points)}</span>` : ''}
              ${l.rubis ? `<span class="${l.rubis < 0 ? 'neg' : ''}">${l.rubis > 0 ? '+' : ''}${rubis(l.rubis)}</span>` : ''}</span>
          </div>`).join('') || '<p class="empty">Rien pour l\'instant.</p>'}
      </div>
    </section>`;
  $('#give')?.addEventListener('click', () => giveDialog(p));
  $('#refresh-roles')?.addEventListener('click', () => api.signIn());
}


function rankOf(id) {
  const sorted = [...state.balances.values()].sort((a, b) => b.points - a.points);
  const i = sorted.findIndex(b => b.user_id === id);
  return i < 0 ? 'non classé' : `${i + 1}${i === 0 ? 'er' : 'e'} au classement`;
}

function giveDialog(p) {
  const box = openModal(`
    <h2>${I.rubis} Récompenser ${uname(p)}</h2>
    <form class="form" id="gform">
      <div class="row">
        <label>${I.points} Points<input type="number" name="points" value="0" step="1"></label>
        <label>Rubis<input type="number" name="rubis" value="0" step="1"></label>
      </div>
      <small class="muted">Mets un nombre négatif pour retirer.</small>
      <label>Raison<input name="reason" required maxlength="120" placeholder="Gagnant de l'event du samedi"></label>
      <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><button class="btn primary">Valider</button></div>
    </form>`);
  $('#gform', box).addEventListener('submit', e => safe(async () => {
    e.preventDefault();
    const f = new FormData(e.target);
    const row = { user_id: p.id, points: Number(f.get('points')) || 0, rubis: Number(f.get('rubis')) || 0, reason: f.get('reason').trim() };
    if (!row.points && !row.rubis) return toast('Indique des points ou des rubis', 'err');
    await api.addLedger([row]);
    await loadBalances(); closeModal(); toast('C\'est enregistré !'); renderNav(); pageProfile(p.id);
  }));
}

// ---------- Classement ----------
async function pageLeaderboard() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [members] = await Promise.all([safe(() => api.listMembers()), loadBalances()]);
  const list = (members || []).map(m => ({ ...m, ...bal(m.id) }));
  const by = { points: 'points', rubis: 'rubis' };
  const draw = key => {
    const sorted = [...list].sort((a, b) => b[key] - a[key] || a.username.localeCompare(b.username));
    const podium = sorted.slice(0, 3);
    $('#lb').className = 'by-' + key;
    $('#lb').innerHTML = `
      <div class="podium">
        ${[1, 0, 2].map(i => podium[i] ? `
          <a href="#/profil/${esc(podium[i].id)}" class="podium-step p${i + 1}">
            ${avatar(podium[i], 'av lg')}
            <strong>${uname(podium[i])}</strong>
            ${key === 'points' ? pts(podium[i].points) : rubis(podium[i].rubis)}
            <div class="step">${[I.medal1, I.medal2, I.medal3][i]}</div>
          </a>` : '<div></div>').join('')}
      </div>
      <div class="lb-table">
        ${sorted.map((m, i) => `
          <a href="#/profil/${esc(m.id)}" class="lb-row ${m.id === state.me.id ? 'me-row' : ''}">
            <span class="lb-rank">${i + 1}</span>
            ${avatar(m, 'av sm')}
            <span class="lb-name">${uname(m)}</span>
            ${pts(m.points)} ${rubis(m.rubis)}
          </a>`).join('') || '<p class="empty">Personne pour l\'instant.</p>'}
      </div>`;
  };
  app.innerHTML = `
    <div class="page-head"><h1>Classement</h1>
      <div class="seg"><button class="on" data-k="points">${I.points} Points</button><button data-k="rubis">${I.rubis} Rubis</button></div>
    </div>
    <p class="small">On gagne des points et des rubis en participant aux tournois, en gagnant des matchs et grâce aux events des admins.</p>
    <div id="lb"></div>`;
  draw('points');
  app.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    app.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    draw(by[b.dataset.k]);
  }));
}

// ---------- Boutique ----------
async function pageShop() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const me = state.me;
  const [owned] = await Promise.all([safe(() => api.listOwned(me.id)), loadColors(), loadBalances()]);
  const have = new Set(owned || []);
  const money = bal(me.id).rubis;
  app.innerHTML = `
    <div class="page-head"><h1>Boutique</h1><div class="big-money">${rubis(money)}</div></div>
    <p class="small">Des pseudos animés à acheter avec tes rubis. L'effet s'affiche partout sur le site : profil, arbres, classement…</p>
    <div class="grid shop">
      <div class="card color-card ${!me.name_color ? 'equipped' : ''}">
        <div class="color-preview">${uname({ ...me, name_color: null })}</div>
        <strong>Sans effet (couleur du rôle)</strong>
        <span class="muted">Gratuit</span>
        ${!me.name_color ? '<span class="pill-info">Équipé</span>' : '<button class="btn ghost sm" data-equip="">Équiper</button>'}
      </div>
      ${[...state.colors.values()].filter(c => c.effect).map(c => `
      <div class="card color-card ${me.name_color === c.id ? 'equipped' : ''}">
        <div class="color-preview fx-stage">${uname({ ...me, name_color: c.id })}</div>
        <strong>${esc(c.name)}</strong>
        ${rubis(c.price)}
        <button class="btn ghost sm" data-preview="${esc(c.id)}">👀 Voir le rendu</button>
        ${me.name_color === c.id ? '<span class="pill-info">Équipé</span>'
          : have.has(c.id) ? `<button class="btn ghost sm" data-equip="${esc(c.id)}">Équiper</button>`
          : `<button class="btn primary sm" data-buy="${esc(c.id)}" ${money < c.price ? 'disabled' : ''}>Acheter</button>`}
      </div>`).join('')}
    </div>`;
  const buy = c => safe(async () => {
    if (!confirm(`Acheter « ${c.name} » pour ${c.price} rubis ?`)) return;
    await api.buyColor(c.id);
    state.me.name_color = c.id;
    closeModal(); toast('Nouvel effet équipé !'); await loadBalances(); renderNav(); pageShop();
  });
  app.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => buy(state.colors.get(b.dataset.buy))));
  app.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => {
    const c = state.colors.get(b.dataset.preview);
    const fake = { ...me, name_color: c.id };
    const box = openModal(`
      <h2>Aperçu : ${esc(c.name)}</h2>
      <p class="small">Voici ton pseudo avec cet effet, à différents endroits du site.</p>
      <div class="pv">
        <div class="pv-label">Profil</div>
        <div class="pv-profile">${avatar(me, 'av lg')}<div><div class="pv-big">${uname(fake)}</div><div class="roles">${rolesOf(me).slice(0, 2).map(rolePill).join('')}</div></div></div>
        <div class="pv-label">Classement</div>
        <div class="lb-row"><span class="lb-rank">1</span>${avatar(me, 'av sm')}<span class="lb-name">${uname(fake)}</span>${pts(bal(me.id).points)}</div>
        <div class="pv-label">Arbre de tournoi</div>
        <div class="match done pv-match">
          <div class="mslot win">${avatar(me, 'av xs')}<span class="name">${uname(fake)}</span><span class="score">3</span></div>
          <div class="mslot lose"><img class="av xs" src="${esc(defAvatar())}" alt=""><span class="name">Adversaire</span><span class="score">1</span></div>
        </div>
      </div>
      <div class="actions">
        <button class="btn ghost" data-close>Fermer</button>
        ${me.name_color === c.id ? '<span class="pill-info">Déjà équipé</span>'
          : have.has(c.id) ? '<button class="btn primary" id="pv-equip">Équiper</button>'
          : `<button class="btn primary" id="pv-buy" ${money < c.price ? 'disabled' : ''}>Acheter pour ${c.price} rubis</button>`}
      </div>
      ${!have.has(c.id) && money < c.price ? `<p class="small center">Il te manque ${c.price - money} rubis.</p>` : ''}`);
    $('#pv-buy', box)?.addEventListener('click', () => buy(c));
    $('#pv-equip', box)?.addEventListener('click', () => safe(async () => {
      await api.equipColor(c.id); state.me.name_color = c.id; closeModal(); toast('Effet changé'); renderNav(); pageShop();
    }));
  }));
  app.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', () => safe(async () => {
    const id = b.dataset.equip || null;
    await api.equipColor(id);
    state.me.name_color = id;
    toast('Effet changé'); renderNav(); pageShop();
  })));
}

// ---------- Rôles (admins) ----------
async function pageRoles() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [members, roles] = await Promise.all([safe(() => api.listMembers()), safe(() => api.listRoles())]);
  const known = new Map((roles || []).map(r => [r.id, r]));
  const holders = new Map();
  (members || []).forEach(m => (m.roles || []).forEach(id => {
    if (!holders.has(id)) holders.set(id, []);
    holders.get(id).push(m.username);
  }));
  const ids = [...new Set([...known.keys(), ...holders.keys()])].sort((a, b) => {
    const ra = known.get(a), rb = known.get(b);
    if (ra && rb) return ra.position - rb.position;
    if (ra || rb) return ra ? 1 : -1; // les rôles pas encore nommés en premier
    return (holders.get(b)?.length || 0) - (holders.get(a)?.length || 0);
  });
  const unnamed = ids.filter(id => !known.has(id)).length;

  app.innerHTML = `
    <div class="page-head"><h1>Rôles</h1><button class="btn primary" id="save-roles">Enregistrer</button></div>
    <p class="small">Les rôles de ton serveur Discord, dans le même ordre. Tu peux changer un nom ou une couleur,
      ou cocher « Masquer » pour qu'un rôle (par exemple celui d'un bot) n'apparaisse pas sur les profils.
      Si tu crées un nouveau rôle sur Discord, il apparaîtra ici dès qu'un membre qui l'a se connecte.</p>
    ${unnamed ? `<p class="pill-info">${unnamed} rôle${unnamed > 1 ? 's' : ''} à nommer</p>` : ''}
    <div class="roles-table">
      ${ids.map((id, i) => {
        const r = known.get(id) || {};
        const who = holders.get(id) || [];
        return `
        <div class="card role-row ${known.has(id) ? '' : 'unnamed'}" data-id="${esc(id)}">
          <div class="rr-head">${known.has(id) ? rolePill(r) : '<span class="pill-info">Nouveau rôle</span>'}
            <span class="small">${who.length} membre${who.length > 1 ? 's' : ''} connecté${who.length > 1 ? 's' : ''}</span></div>
          <div class="rr-main">
            <input type="color" class="rr-color" value="${esc(r.color || '#99aab5')}">
            <input class="rr-name" placeholder="Nom du rôle" value="${esc(r.name)}" maxlength="60">
            <input class="rr-pos" type="number" value="${r.position ?? i}" title="Ordre d'affichage (le plus petit en premier)">
            <label class="rr-hide"><input type="checkbox" class="rr-hidden" ${r.hidden ? 'checked' : ''}> Masquer</label>
            ${known.has(id) ? `<button class="x" data-del="${esc(id)}" title="Oublier ce rôle">✕</button>` : ''}
          </div>
          ${who.length ? `<div class="rr-info small">${esc(who.slice(0, 8).join(', ')) + (who.length > 8 ? '…' : '')}</div>` : ''}
        </div>`;
      }).join('') || '<p class="empty">Aucun rôle pour l\'instant : connecte-toi et invite les membres à se connecter.</p>'}
    </div>`;

  $('#save-roles').addEventListener('click', () => safe(async () => {
    const rows = [...app.querySelectorAll('.role-row')].map(el => ({
      id: el.dataset.id,
      name: $('.rr-name', el).value.trim(),
      color: $('.rr-color', el).value,
      position: Number($('.rr-pos', el).value) || 0,
      hidden: $('.rr-hidden', el).checked,
    })).filter(r => r.name);
    await api.saveRoles(rows);
    await loadRoles();
    toast('Rôles enregistrés');
    pageRoles();
  }));
  app.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => safe(async () => {
    await api.deleteRole(b.dataset.del); await loadRoles(); pageRoles();
  })));
}

// ---------- Paramètres (admins) : fond d'écran, icônes, galerie ----------
// Réduit une image avant l'envoi (garde la transparence des PNG ; les GIF animés sont envoyés tels quels)
async function shrinkImage(file, max, type = 'image/png') {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && file.type === type) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, type, 0.86));
  return new File([blob], type === 'image/png' ? 'image.png' : 'image.jpg', { type });
}
const ICON_MAX = { ile: 1400, logo: 512, avatar: 256 };

async function pageSettings(tab = 'fond') {
  app.innerHTML = `
    <div class="page-head"><h1>Paramètres</h1></div>
    <p class="small">Personnalise l'apparence du site. Les changements sont visibles par tout le monde.</p>
    <div class="tabs">
      <button data-tab="fond">Fond d'écran</button>
      <button data-tab="icones">Icônes</button>
      <button data-tab="galerie">Mes images</button>
    </div>
    <div id="set-body"></div>`;
  const body = $('#set-body');
  const pick = (accept = 'image/*', multiple = false) => new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => res([...inp.files]); inp.click();
  });
  const tooBig = f => { if (f.size > 20 * 1024 * 1024) { toast(`${f.name} est trop lourde (20 Mo maximum)`, 'err'); return true; } return false; };
  const saveTheme = async patch => { state.theme = { ...state.theme, ...patch }; applyTheme(); await api.saveSetting('theme', state.theme); };
  const saveIcon = async (k, url) => {
    const icons = { ...state.icons }; if (url) icons[k] = url; else delete icons[k];
    state.icons = icons; await api.saveSetting('icons', icons); applyTheme(); renderNav();
  };

  const showBg = () => {
    const t = state.theme;
    body.innerHTML = `
      <section class="card set-card">
        <h2>Fond d'écran du site</h2>
        <div class="bg-preview ${t.fit === 'tile' ? 'tile' : ''}" style="--pv:${t.background_url ? `url('${esc(t.background_url)}')` : 'none'};--veil:${(t.veil ?? 30) / 100}">
          ${t.background_url ? '<div class="bg-mini card">Aperçu d\'une carte</div>' : '<span>Aucun fond : le ciel par défaut est utilisé</span>'}
        </div>
        <div class="row wrap">
          <button class="btn primary sm" id="bg-pick">${t.background_url ? 'Changer l\'image' : 'Choisir une image'}</button>
          ${t.background_url ? '<button class="btn ghost sm" id="bg-del">Retirer le fond</button>' : ''}
        </div>
        ${t.background_url ? `
        <label class="set-line">Voile blanc (lisibilité) <b id="veil-v">${t.veil ?? 30}%</b>
          <input type="range" id="veil" min="0" max="85" step="5" value="${t.veil ?? 30}"></label>
        <div class="set-line">Affichage
          <label class="radio"><input type="radio" name="fit" value="cover" ${t.fit !== 'tile' ? 'checked' : ''}> Remplir l'écran</label>
          <label class="radio"><input type="radio" name="fit" value="tile" ${t.fit === 'tile' ? 'checked' : ''}> Répéter en mosaïque (motifs)</label>
        </div>` : ''}
        <small class="muted">Conseil : une image d'au moins 1920 × 1080. Elle reste fixe pendant qu'on fait défiler la page.</small>
      </section>`;
    $('#bg-pick').onclick = async () => {
      const [f] = await pick('image/png,image/jpeg,image/webp,image/gif'); if (!f || tooBig(f)) return;
      await safe(async () => {
        toast('Envoi du fond d\'écran…');
        const url = await api.uploadImage(await shrinkImage(f, 2560, 'image/jpeg'), 'fonds');
        await saveTheme({ background_url: url }); toast('Fond d\'écran enregistré !'); showBg();
      });
    };
    $('#bg-del')?.addEventListener('click', () => safe(async () => { await saveTheme({ background_url: null }); showBg(); }));
    const veil = $('#veil');
    if (veil) {
      veil.oninput = () => { $('#veil-v').textContent = veil.value + '%'; document.body.style.setProperty('--bg-veil', String(veil.value / 100)); $('.bg-preview').style.setProperty('--veil', veil.value / 100); };
      veil.onchange = () => safe(() => saveTheme({ veil: Number(veil.value) }));
    }
    body.querySelectorAll('input[name=fit]').forEach(r => r.onchange = () => safe(async () => { await saveTheme({ fit: r.value }); showBg(); }));
  };

  const showIcons = () => {
    body.innerHTML = `
      <p class="small">Remplace chaque icône du site par ta propre image (PNG avec fond transparent conseillé). « Par défaut » remet l'icône d'origine.</p>
      <div class="grid icon-grid">
        ${ICON_SLOTS.map(([k, label]) => `
          <div class="card icon-card ${state.icons[k] ? 'custom' : ''}">
            <div class="icon-show ${k === 'ile' ? 'wide' : ''}">${k === 'avatar' ? `<img class="av lg" src="${esc(defAvatar())}" alt="">` : icon(k)}</div>
            <strong>${esc(label)}</strong>
            <div class="row">
              <button class="btn ghost sm" data-set="${k}">Changer</button>
              ${state.icons[k] ? `<button class="btn ghost sm" data-reset="${k}">Par défaut</button>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
    body.querySelectorAll('[data-set]').forEach(b => b.onclick = async () => {
      const k = b.dataset.set;
      const [f] = await pick('image/png,image/jpeg,image/webp,image/gif,image/svg+xml'); if (!f || tooBig(f)) return;
      await safe(async () => {
        const url = await api.uploadImage(await shrinkImage(f, ICON_MAX[k] || 160), 'icones');
        await saveIcon(k, url); toast('Icône changée'); showIcons();
      });
    });
    body.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => safe(async () => { await saveIcon(b.dataset.reset, null); showIcons(); }));
  };

  const showGallery = async () => {
    body.innerHTML = '<div class="loading">Chargement…</div>';
    const list = await safe(() => api.listGallery()) || [];
    const targets = `<option value="">Utiliser pour…</option><option value="__bg">Fond d'écran</option>${ICON_SLOTS.map(([k, l]) => `<option value="${k}">Icône : ${esc(l)}</option>`).join('')}`;
    body.innerHTML = `
      <div class="page-head"><p class="small">Range ici toutes tes images personnalisées, puis utilise-les comme fond ou comme icône.</p>
        <button class="btn primary sm" id="g-add">+ Ajouter des images</button></div>
      <div class="grid gallery">
        ${list.map(g => `
          <div class="card g-item">
            <div class="g-img" style="background-image:url('${esc(g.url)}')"></div>
            <select data-use="${esc(g.url)}">${targets}</select>
            <div class="row">
              <button class="btn ghost sm" data-copy="${esc(g.url)}">Copier le lien</button>
              <button class="x" data-del="${esc(g.path)}" title="Supprimer">✕</button>
            </div>
          </div>`).join('') || '<p class="empty">Aucune image pour l\'instant.</p>'}
      </div>`;
    $('#g-add').onclick = async () => {
      const files = (await pick('image/png,image/jpeg,image/webp,image/gif,image/svg+xml', true)).filter(f => !tooBig(f));
      if (!files.length) return;
      await safe(async () => {
        toast(`Envoi de ${files.length} image${files.length > 1 ? 's' : ''}…`);
        for (const f of files) await api.uploadImage(await shrinkImage(f, 2560, f.type === 'image/png' ? 'image/png' : 'image/jpeg'), 'galerie');
        toast('Images ajoutées'); showGallery();
      });
    };
    body.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Lien copié')));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => safe(async () => {
      if (!confirm('Supprimer cette image ? Si elle est utilisée comme fond ou icône, elle disparaîtra du site.')) return;
      await api.deleteImage(b.dataset.del); showGallery();
    }));
    body.querySelectorAll('[data-use]').forEach(sel => sel.onchange = () => safe(async () => {
      const v = sel.value; if (!v) return;
      if (v === '__bg') { await saveTheme({ background_url: sel.dataset.use }); toast('Fond d\'écran changé'); }
      else { await saveIcon(v, sel.dataset.use); toast('Icône changée'); }
      sel.value = '';
    }));
  };

  const show = k => {
    app.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    ({ fond: showBg, icones: showIcons, galerie: showGallery })[k]();
  };
  app.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  show(tab);
}

// =====================================================================
//  Démarrage
// =====================================================================
(async () => {
  if (DEMO) document.body.classList.add('demo');
  const [me] = await Promise.all([safe(() => api.init()), loadTheme()]);
  state.me = me;
  if (state.me?.in_guild) await Promise.all([loadRoles(), loadColors(), loadBalances()]);
  if (state.me?.is_admin) settlePending();
  window.addEventListener('hashchange', route);
  route();
})();
