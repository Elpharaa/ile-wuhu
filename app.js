// =====================================================================
//  Site de l'île Wuhu — interface
// =====================================================================
import { api, DEMO } from './api.js';
import { CONFIG } from './config.js';
import { generateBracket, resolveBracket, roundTitle } from './bracket.js';

const app = document.getElementById('app');
const state = { me: null, roles: new Map() };
let unsubscribe = null;

// ---------- Petits outils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const avatar = (p, cls = 'av') => `<img class="${cls}" src="${esc(p?.avatar_url || DEFAULT_AVATAR)}" alt="" loading="lazy">`;
const rolePill = r => `<span class="role" style="--rc:${esc(r.color || '#99aab5')}"><i></i>${esc(r.name)}</span>`;
// Rôles du membre (identifiants Discord → noms définis par les admins)
const rolesOf = p => (p?.roles || []).map(id => state.roles.get(id)).filter(r => r && !r.hidden)
  .sort((a, b) => a.position - b.position);
const topRole = p => rolesOf(p)[0];
async function loadRoles() {
  const list = await safe(() => api.listRoles()) || [];
  state.roles = new Map(list.map(r => [r.id, r]));
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

// =====================================================================
//  Barre du haut
// =====================================================================
function renderNav() {
  const me = state.me;
  const hash = location.hash || '#/';
  const link = (h, label) => `<a href="${h}" class="${hash === h || (h !== '#/' && hash.startsWith(h.replace(/s$/, ''))) ? 'active' : ''}">${label}</a>`;
  $('#nav').innerHTML = me?.in_guild
    ? link('#/', 'Accueil') + link('#/tournois', 'Tournois') + link('#/membres', 'Membres') + (me.is_admin ? link('#/roles', 'Rôles') : '')
    : '';
  $('#user').innerHTML = me
    ? `<a class="me" href="#/profil/${esc(me.id)}">${avatar(me, 'av sm')}<span>${esc(me.username)}</span></a>
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
    case 'membres': return pageMembers();
    case 'profil': return pageProfile(parts[1] || state.me.id);
    case 'roles': return state.me.is_admin ? pageRoles() : pageHome();
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
      ${ISLAND_SVG}
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
      ${ISLAND_SVG}
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
    <a class="card tcard status-${t.status}" href="#/tournoi/${esc(t.id)}">
      <div class="tcard-top"><span class="badge ${t.status}">${STATUS[t.status]}</span><span class="fmt">${FORMAT[t.format]}</span></div>
      <h3>${esc(t.name)}</h3>
      ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
      <p class="meta">${n} participant${n > 1 ? 's' : ''}${t.max_players ? ' / ' + t.max_players : ''}${t.starts_at ? ' · ' + esc(fmtDate(t.starts_at)) : ''}</p>
    </a>`;
}

async function pageHome() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const list = await safe(() => api.listTournaments()) || [];
  const me = state.me;
  const open = list.filter(t => t.status === 'open');
  const running = list.filter(t => t.status === 'running');
  app.innerHTML = `
    <section class="hero small-hero">
      ${ISLAND_SVG}
      <h1>Salut ${esc(me.username)} !</h1>
      <div class="roles center">${rolesOf(me).map(rolePill).join('')}</div>
    </section>
    <section>
      <h2>En cours</h2>
      <div class="grid">${running.map(tournamentCard).join('') || '<p class="empty">Aucun tournoi en cours.</p>'}</div>
    </section>
    <section>
      <h2>Inscriptions ouvertes</h2>
      <div class="grid">${open.map(tournamentCard).join('') || '<p class="empty">Aucun tournoi ouvert pour le moment.</p>'}</div>
    </section>`;
}

async function pageTournaments() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const list = await safe(() => api.listTournaments()) || [];
  app.innerHTML = `
    <div class="page-head">
      <h1>Tournois</h1>
      ${state.me.is_admin ? '<button class="btn primary" id="new-t">+ Créer un tournoi</button>' : ''}
    </div>
    ${['running', 'open', 'done'].map(s => {
      const items = list.filter(t => t.status === s);
      return items.length ? `<section><h2>${STATUS[s]}</h2><div class="grid">${items.map(tournamentCard).join('')}</div></section>` : '';
    }).join('') || '<p class="empty">Aucun tournoi pour l\'instant.</p>'}`;
  $('#new-t')?.addEventListener('click', () => tournamentForm());
}

// ---------- Formulaire de création / modification ----------
function tournamentForm(t = null) {
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
    await safe(async () => {
      if (t) { await api.updateTournament(t.id, data); toast('Tournoi modifié'); route(); }
      else { const x = await api.createTournament(data); toast('Tournoi créé !'); location.hash = '#/tournoi/' + x.id; }
    });
  });
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

  app.innerHTML = `
    <a href="#/tournois" class="back">← Tous les tournois</a>
    <div class="card thead">
      <div class="tcard-top"><span class="badge ${t.status}">${STATUS[t.status]}</span><span class="fmt">${FORMAT[t.format]}</span></div>
      <h1>${esc(t.name)}</h1>
      ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
      ${t.starts_at ? `<p class="meta">📅 ${esc(fmtDate(t.starts_at))}</p>` : ''}
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
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

    ${champ ? `<div class="card champion">🏆 <div>${avatar(champ, 'av lg')}</div><div><small>Vainqueur</small><strong>${esc(champ.username)}</strong></div></div>` : ''}

    ${t.bracket ? `
      <section>
        <h2>Arbre du tournoi</h2>
        ${me.is_admin && t.status !== 'done' ? '<p class="hint">Clique sur un match pour entrer le score.</p>' : ''}
        ${renderBracket(t.bracket, res, people)}
      </section>` : ''}

    <section>
      <h2>Participants (${people.size}${t.max_players ? ' / ' + t.max_players : ''})</h2>
      <div class="players">
        ${[...people.entries()].map(([uid, p]) => `
          <div class="player">
            <a href="#/profil/${esc(uid)}">${avatar(p)}<span>${esc(p?.username)}</span></a>
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
    await api.deleteTournament(id); toast('Tournoi supprimé'); location.hash = '#/tournois';
  }));
  $('#reopen')?.addEventListener('click', () => safe(async () => {
    if (!confirm('L\'arbre et tous les scores seront effacés. Continuer ?')) return;
    await api.updateTournament(id, { status: 'open', bracket: null, winner_id: null }); reload();
  }));
  $('#launch')?.addEventListener('click', () => launchDialog(t, [...people.keys()], reload));

  // Les admins peuvent entrer (ou corriger, même après la fin) un score
  if (me.is_admin && t.bracket) {
    app.querySelectorAll('.match.playable').forEach(el => {
      el.classList.add('editable');
      el.addEventListener('click', () => scoreDialog(t, res.state[el.dataset.mid], people, reload));
    });
  }

  // Mise à jour en direct quand un admin entre un score
  let timer;
  unsubscribe = api.subscribe(id, () => { clearTimeout(timer); timer = setTimeout(() => { if (modal.classList.contains('hidden')) reload(); }, 400); });
}

function launchDialog(t, ids, reload) {
  if (ids.length < 2) return toast('Il faut au moins 2 participants', 'err');
  const box = openModal(`
    <h2>Lancer « ${esc(t.name)} »</h2>
    <p>${ids.length} participants · ${FORMAT[t.format]}. Les inscriptions seront fermées.</p>
    <label class="radio"><input type="radio" name="order" value="random" checked> Placement aléatoire</label>
    <label class="radio"><input type="radio" name="order" value="join"> Ordre d'inscription (le 1er inscrit = tête de série n°1)</label>
    <div class="actions"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="go">C'est parti !</button></div>`);
  $('#go', box).addEventListener('click', () => safe(async () => {
    const order = $('input[name=order]:checked', box).value;
    const list = [...ids];
    if (order === 'random') for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const bracket = generateBracket(list, t.format);
    await api.updateTournament(t.id, { status: 'running', bracket, winner_id: null });
    closeModal(); toast('Le tournoi commence !'); reload();
  }));
}

function scoreDialog(t, s, people, reload) {
  const [a, b] = s.players.map(id => people.get(id) || { username: '?' });
  const cur = s.result;
  const box = openModal(`
    <h2>Résultat du match</h2>
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
    ${cur ? '<div class="actions center"><button class="btn danger sm" id="clear">Effacer le résultat</button></div>' : ''}`);

  const save = async w => {
    const bracket = structuredClone(t.bracket);
    bracket.results = bracket.results || {};
    if (w == null) delete bracket.results[s.id];
    else {
      const s0 = $('#s0', box).value, s1 = $('#s1', box).value;
      bracket.results[s.id] = { w: s.players[w], s: s0 !== '' || s1 !== '' ? [Number(s0) || 0, Number(s1) || 0] : null };
    }
    const r = resolveBracket(bracket);
    await api.updateTournament(t.id, { bracket, status: r.champion ? 'done' : 'running', winner_id: r.champion ?? null });
    closeModal();
    if (r.champion) toast('🏆 Nous avons un champion !'); else toast('Score enregistré');
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
    if (p) label = `${avatar(p, 'av xs')}<span class="name">${esc(p.username)}</span>`;
    else if (s.deadSlot[idx]) label = `<span class="name muted">Exempt</span>`;
    else label = `<span class="name muted">En attente…</span>`;
    return `<div class="mslot ${isW ? 'win' : ''} ${isL ? 'lose' : ''}">${label}<span class="score">${isW && sc === '' ? '✓' : esc(sc)}</span></div>`;
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
      .map(p => `<a class="card member" href="#/profil/${esc(p.id)}">${avatar(p, 'av lg')}<strong>${esc(p.username)}</strong>${topRole(p) ? rolePill(topRole(p)) : ''}</a>`)
      .join('') || '<p class="empty">Aucun membre trouvé.</p>';
  };
  draw('');
  $('#q').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
}

// ---------- Profil ----------
async function pageProfile(id) {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [p, ts] = await Promise.all([safe(() => api.getProfile(id)), safe(() => api.userStats(id))]);
  if (!p) { app.innerHTML = '<p class="empty">Profil introuvable.</p>'; return; }
  const tours = ts || [];
  const wins = tours.filter(t => t.winner_id === id);
  const color = topRole(p)?.color || '#2fa4e7';
  app.innerHTML = `
    <div class="card profile" style="--pc:${esc(color)}">
      <div class="profile-banner"></div>
      <div class="profile-body">
        ${avatar(p, 'av xl')}
        <h1>${esc(p.username)}</h1>
        ${p.is_admin ? '<span class="pill-info">Organisateur de tournois</span>' : ''}
        <h3>Rôles sur le serveur</h3>
        <div class="roles">${rolesOf(p).map(rolePill).join('') || '<span class="muted">Aucun rôle</span>'}</div>
        ${p.id === state.me.id ? '<button class="btn ghost sm refresh" id="refresh-roles">↻ Actualiser mes rôles</button>' : ''}
        <div class="stats">
          <div><strong>${tours.length}</strong><span>tournoi${tours.length > 1 ? 's' : ''} joué${tours.length > 1 ? 's' : ''}</span></div>
          <div><strong>${wins.length}</strong><span>victoire${wins.length > 1 ? 's' : ''} 🏆</span></div>
        </div>
      </div>
    </div>
    <section>
      <h2>Tournois</h2>
      <div class="tlist">
        ${tours.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(t => `
          <a href="#/tournoi/${esc(t.id)}" class="tline">
            <span>${t.winner_id === id ? '🏆 ' : ''}${esc(t.name)}</span>
            <span class="badge ${t.status}">${STATUS[t.status]}</span>
          </a>`).join('') || '<p class="empty">Pas encore de tournoi.</p>'}
      </div>
    </section>`;
  $('#refresh-roles')?.addEventListener('click', () => api.signIn());
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
    <p class="small">Sans bot, Discord donne seulement les numéros des rôles. Donne un nom et une couleur à chacun :
      ils s'afficheront sur les profils. Coche « Masquer » pour les rôles à ne pas montrer.
      Les rôles apparaissent ici dès qu'un membre qui les a s'est connecté au site.</p>
    ${unnamed ? `<p class="pill-info">${unnamed} rôle${unnamed > 1 ? 's' : ''} à nommer</p>` : ''}
    <div class="roles-table">
      ${ids.map((id, i) => {
        const r = known.get(id) || {};
        const who = holders.get(id) || [];
        return `
        <div class="card role-row ${known.has(id) ? '' : 'unnamed'}" data-id="${esc(id)}">
          <div class="rr-main">
            <input type="color" class="rr-color" value="${esc(r.color || '#99aab5')}">
            <input class="rr-name" placeholder="Nom du rôle" value="${esc(r.name)}" maxlength="60">
            <input class="rr-pos" type="number" value="${r.position ?? i}" title="Ordre d'affichage (le plus petit en premier)">
            <label class="rr-hide"><input type="checkbox" class="rr-hidden" ${r.hidden ? 'checked' : ''}> Masquer</label>
            ${known.has(id) ? `<button class="x" data-del="${esc(id)}" title="Oublier ce rôle">✕</button>` : ''}
          </div>
          <div class="rr-info small">N° ${esc(id)} · ${who.length} membre${who.length > 1 ? 's' : ''}${who.length ? ' : ' + esc(who.slice(0, 6).join(', ')) + (who.length > 6 ? '…' : '') : ''}</div>
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

// =====================================================================
//  Démarrage
// =====================================================================
(async () => {
  if (DEMO) document.body.classList.add('demo');
  state.me = await safe(() => api.init());
  if (state.me?.in_guild) await loadRoles();
  window.addEventListener('hashchange', route);
  route();
})();
