// =====================================================================
//  Site de l'île Wuhu — interface
// =====================================================================
import { api, DEMO } from './api.js?v=20261120h';
import { CONFIG } from './config.js';
import { resolveBracket, roundTitle, bracketFromPlacement, placementFor, syncPlacement, shuffled } from './bracket.js?v=20261120h';

const app = document.getElementById('app');
const state = { me: null, roles: new Map(), colors: new Map(), items: new Map(), balances: new Map(), theme: {}, icons: {} };
let unsubscribe = null;

// ---------- Petits outils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const defAvatar = () => state.icons.avatar || DEFAULT_AVATAR;
const avatarImg = (p, cls = 'av') => p?.is_team
  ? `<span class="duo ${esc(cls.replace(/\bav\b/, ''))}">${p.members.map(m => `<img class="${cls}" src="${esc(m?.avatar_url || defAvatar())}" alt="" loading="lazy">`).join('')}</span>`
  : `<img class="${cls}" src="${esc(p?.avatar_url || defAvatar())}" alt="" loading="lazy">`;
// Avatar, avec le cadre acheté en boutique s'il y en a un
const avatar = (p, cls = 'av') => {
  if (p?.is_team) return avatarImg(p, cls);
  const fr = p?.item_frame && state.items.get(p.item_frame);
  return fr ? frameWrap(fr.effect, cls, avatarImg(p, cls)) : avatarImg(p, cls);
};
const frameWrap = (effect, cls, inner) => {
  const size = (String(cls).match(/\b(xs|sm|md|lg|xl)\b/) || [, 'n'])[1];
  return `<span class="afr afr-${esc(effect)} s-${size}">${inner}</span>`;
};
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
  ['nav_accueil', 'Menu : Accueil', '🏠'],
  ['nav_tournois', 'Menu : Tournois', '🏆'],
  ['nav_classement', 'Menu : Classement', '📊'],
  ['nav_membres', 'Menu : Membres', '👥'],
  ['nav_boutique', 'Menu : Boutique', '🛍️'],
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
  if (p?.is_team) return `<span class="uname team-name">${esc(p.username)}</span>`;
  const fx = p?.name_color && state.colors.get(p.name_color);
  if (fx?.effect) return fxName(p.username, fx.effect);
  const c = topRole(p)?.color;
  return `<span class="uname" style="${c ? `color:${esc(c)}` : ''}">${esc(p?.username)}</span>`;
}
const bal = uid => state.balances.get(uid) || { rubis: 0, points: 0 };
async function loadColors() {
  const [list, items] = await Promise.all([safe(() => api.listColors()), safe(() => api.listItems?.())]);
  state.colors = new Map((list || []).map(c => [c.id, c]));
  state.items = new Map((items || []).map(c => [c.id, c]));
}
// Titre équipé (petit texte animé sous le pseudo)
function wtitle(p, effectOverride) {
  const it = p?.item_title && state.items.get(p.item_title);
  return it ? `<span class="wtitle">${fxName(it.name, it.effect)}</span>` : '';
}
// Animation de victoire : des particules qui tombent / montent
const VIC = { confettis: '', coeurs: '💖', feu: '', eclair: '⚡', galaxie: '⭐', or: '🪙' };
function victoryFx(effect, n = 22) {
  if (!effect) return '';
  const ch = VIC[effect] ?? '';
  return `<div class="vic vic-${esc(effect)}" aria-hidden="true">${Array.from({ length: n }, (_, i) => {
    const x = (i * 37 + 11) % 100, d = ((i * 53) % 100) / 40, dur = 1.8 + ((i * 29) % 10) / 6, h = (i * 47) % 360, sz = .8 + ((i * 17) % 7) / 10;
    return `<i style="--x:${x}%;--d:${d.toFixed(2)}s;--t:${dur.toFixed(2)}s;--h:${h};--s:${sz.toFixed(2)}">${ch}</i>`;
  }).join('')}</div>`;
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
    const who = bracket.teams?.[uid]?.members || [uid];
    who.forEach(u => { if (u && (g.points || g.rubis)) rows.push({ user_id: u, points: g.points || 0, rubis: g.rubis || 0, reason: `${reason} – ${t.name}`, tournament_id: t.id }); });
  };
  players.forEach(u => add(u, R.participation, 'Participation'));
  const wins = new Map();
  Object.values(st).forEach(x => { if (x.playable && x.done) wins.set(x.winner, (wins.get(x.winner) || 0) + 1); });
  if (bracket.format === 'ffa4') {
    wins.forEach((n, u) => add(u, { points: R.win.points * n, rubis: R.win.rubis * n }, `${n} match${n > 1 ? 's' : ''} gagné${n > 1 ? 's' : ''}`));
    const fin = st[bracket.matches[bracket.matches.length - 1].id].ranking || [];
    add(fin[0], R.first, '🏆 Champion'); add(fin[1], R.second, '🥈 2e place'); add(fin[2], R.third, '🥉 3e place');
    return rows;
  }
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

const FORMAT = { single: 'Élimination directe', double: 'Double élimination', ffa4: 'Chacun pour soi à 4' };
const PLACE = ['1er', '2e', '3e', '4e'];
const STATUS = { open: 'Inscriptions ouvertes', running: 'En cours', done: 'Terminé' };
// Un tournoi rangé dans une compétition ne prend pas d'inscriptions lui-même : on s'inscrit via la compétition
const tStatus = t => t.competition_id && t.status === 'open' ? 'wait' : t.status;
const tBadge = t => { const st = tStatus(t); return `<span class="badge ${st}">${st === 'wait' ? 'Bientôt' : STATUS[st]}</span>`; };
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
function openModal(html, cls = '') {
  const mb = modal.querySelector('.modal-box');
  mb.className = 'modal-box' + (cls ? ' ' + cls : '');
  modal._onClose?.(); modal._onClose = null;
  mb.innerHTML = html;
  modal.classList.remove('hidden');
  return modal.querySelector('.modal-box');
}
function closeModal() { modal.classList.add('hidden'); const f = modal._onClose; modal._onClose = null; f?.(); }
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });

// Petite onde au clic sur les boutons
document.addEventListener('pointerdown', e => {
  const b = e.target.closest?.('.btn'); if (!b || b.disabled) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height);
  const w = document.createElement('span'); w.className = 'ripple';
  w.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(w); setTimeout(() => w.remove(), 600);
});

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
  tintFromBackground(t.background_url);
  const fav = document.querySelector('link[rel=icon]');
  if (fav) {
    fav.dataset.def ||= fav.href;
    fav.href = state.icons.logo || fav.dataset.def;
  }
}

// =====================================================================
//  Barre du haut
// =====================================================================
// Couleur de la barre : tirée du fond d'écran (teinte dominante), sinon bleu Wuhu
let tintFor = null;
function setTint(h, sat) {
  const b = document.body.style;
  b.setProperty('--tint-h', String(Math.round(h)));
  b.setProperty('--tint-s', Math.round(sat) + '%');
}
function tintFromBackground(url) {
  if (url === tintFor) return;
  tintFor = url;
  if (!url) return setTint(199, 80);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 48;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 48, 48);
      const d = x.getImageData(0, 0, 48, 48).data;
      let sx = 0, sy = 0, sw = 0, ss = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255;
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), l = (mx + mn) / 2, ch = mx - mn;
        if (ch < .08 || l < .12 || l > .92) continue;
        const sat = ch / (1 - Math.abs(2 * l - 1));
        let h = mx === r ? ((g - bl) / ch) % 6 : mx === g ? (bl - r) / ch + 2 : (r - g) / ch + 4;
        h *= 60; const w = sat * sat;
        sx += Math.cos(h * Math.PI / 180) * w; sy += Math.sin(h * Math.PI / 180) * w; sw += w; ss += sat;
      }
      if (!sw) return setTint(210, 25);
      const hue = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
      setTint(hue, Math.min(85, Math.max(35, ss / (d.length / 4) * 260)));
    } catch { setTint(199, 80); }
  };
  img.onerror = () => setTint(199, 80);
  img.src = url;
}

// =====================================================================
//  Barre du haut (compte) + barre d'onglets en bas
// =====================================================================
const TABS = [['#/', 'Accueil', 'nav_accueil'], ['#/tournois', 'Tournois', 'nav_tournois', ['#/tournoi', '#/competition']],
  ['#/classement', 'Classement', 'nav_classement', ['#/pantheon']], ['#/membres', 'Membres', 'nav_membres', ['#/profil']], ['#/boutique', 'Boutique', 'nav_boutique']];
let lastTab = null;
const closeMeMenu = () => { $('#me-menu')?.setAttribute('hidden', ''); $('#me-btn')?.setAttribute('aria-expanded', 'false'); };
document.addEventListener('click', e => { if (!e.target.closest('.me-wrap')) closeMeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMeMenu(); });
function renderNav() {
  const me = state.me;
  const hash = location.hash || '#/';
  const isOn = ([h, , , also = []]) => h === '#/' ? hash === '#/' || hash === '#' : [h, ...also].some(x => hash.startsWith(x));
  const cur = TABS.find(isOn)?.[0] ?? null;
  const dock = $('#dock');
  dock.innerHTML = me?.in_guild ? TABS.map(t => `
    <a href="${t[0]}" class="${t[0] === cur ? 'active' + (cur !== lastTab ? ' pop' : '') : ''}">
      <span class="dk-ic">${I[t[2]]}</span><span class="dk-lb">${t[1]}</span></a>`).join('') : '';
  dock.hidden = !me?.in_guild;
  document.body.classList.toggle('with-dock', !!me?.in_guild);
  lastTab = cur;
  const sub = h => hash.startsWith(h) ? 'active' : '';
  $('#user').innerHTML = me
    ? `${me.in_guild ? `<a href="#/boutique" class="wallet">${rubis(bal(me.id).rubis)}</a>` : ''}
       <div class="me-wrap">
         <button class="me" id="me-btn" aria-haspopup="true" aria-expanded="false">${(state.achCount || 0) + (state.duelCount || 0) ? `<span class="notif">${(state.achCount || 0) + (state.duelCount || 0)}</span>` : ''}${avatar(me, 'av sm')}<span class="me-name">${uname(me)}</span><span class="caret">▾</span></button>
         <div class="me-menu" id="me-menu" hidden>
           <a href="#/profil/${esc(me.id)}" class="${sub('#/profil/' + me.id)}">${avatar(me, 'av xs')} Mon profil</a>
           <a href="#/pantheon" class="${sub('#/pantheon')}">🏛️ Panthéon</a>
           <a href="#/quiz" class="${sub('#/quiz')}">🧠 Quiz du jour</a>
           <a href="#/blindtest" class="${sub('#/blindtest')}">🎵 Blind test</a>
           <a href="#/defis" class="${sub('#/defis')}">⚔️ Mes défis${state.duelCount ? `<span class="notif in">${state.duelCount}</span>` : ''}</a>
           <a href="#/succes" class="${sub('#/succes')}">🏅 Mes succès${state.achCount ? `<span class="notif in">${state.achCount}</span>` : ''}</a>
           ${me.is_admin ? `<div class="mm-sep">Admin</div>
           <a href="#/roles" class="${sub('#/roles')}">🎖️ Rôles</a>
           <a href="#/parametres" class="${sub('#/parametres')}">⚙️ Paramètres</a>` : ''}
           <div class="mm-sep"></div>
           <button id="logout">⏻ Déconnexion</button>
         </div>
       </div>`
    : `<button class="btn discord sm" id="login">Connexion</button>`;
  const btn = $('#me-btn'), menu = $('#me-menu');
  if (btn) {
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
    menu.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  }
  $('#logout')?.addEventListener('click', () => api.signOut().then(() => { state.me = null; location.hash = '#/'; renderNav(); route(); }));
  $('#login')?.addEventListener('click', () => api.signIn());
}

// =====================================================================
//  Routeur
// =====================================================================
async function route() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  btCurrent?.destroy(); btCurrent = null;
  sceneStop?.(); sceneStop = null;
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
    case 'succes': return pageAchievements();
    case 'bienvenue': showWelcome(null); location.hash = '#/'; return;
    case 'defis': return pageDuels();
    case 'pantheon': return pagePantheon();
    case 'quiz': return pageQuiz();
    case 'blindtest': return parts[1] === 'salon' ? pageBtRoom(parts[2]) : pageBlindtest();
    case 'soiree': return pageParty(parts[1]);
    case 'ecran': return pageScene(parts[1]);
    case 'parametres': return state.me.is_admin ? pageSettings(parts[1] || 'fond') : pageHome();
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
    <a class="card tcard status-${tStatus(t)} ${t.image_url ? 'has-img' : ''}" href="#/tournoi/${esc(t.id)}">
      ${t.image_url ? `<div class="tcard-img" style="background-image:url('${esc(t.image_url)}')"></div>` : ''}
      <div class="tcard-top">${tBadge(t)}<span class="fmt">${FORMAT[t.format]}</span></div>
      <h3>${esc(t.name)}</h3>
      ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
      <p class="meta">${n} participant${n > 1 ? 's' : ''}${t.max_players ? ' / ' + t.max_players : ''}${t.starts_at ? ' · ' + esc(fmtDate(t.starts_at)) : ''}</p>
    </a>`;
}

// Playlist collaborative YouTube de l'île (lien partagé par Elphara)
const PLAYLIST_URL = 'https://youtube.com/playlist?list=PLddnIRf8YbNU';
async function pageHome() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [list0, comps0] = await Promise.all([safe(() => api.listTournaments()), safe(() => api.listCompetitions())]);
  const list = list0 || [];
  const liveComps = (comps0 || []).filter(c => compStatus(c) !== 'done');
  const me = state.me;
  // Les tournois d'une compétition s'affichent via la carte de la compétition (inscription unique)
  const open = list.filter(t => t.status === 'open' && !t.competition_id);
  const running = list.filter(t => t.status === 'running');
  const todo = matchesOf(list.filter(t => t.status === 'running'), me.id).filter(x => !x.done);
  const people = todo.length ? new Map(((await safe(() => api.listMembers())) || []).map(p => [p.id, p])) : new Map();
  app.innerHTML = `
    <section class="hero small-hero">
      <h1>Salut ${uname(me)} !</h1>
      <div class="hero-money">${rubis(bal(me.id).rubis)} ${pts(bal(me.id).points)}</div>
    </section>
    ${partyBanner(liveComps)}
    <div id="daily-slot"></div>
    <div id="quiz-slot"></div>
    <a class="card yt-card" href="${PLAYLIST_URL}" target="_blank" rel="noopener">
      <span class="yt-ic"><svg viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" rx="5" fill="#ff0033"/><path d="M11 5.5v9l8-4.5z" fill="#fff"/></svg></span>
      <span class="yt-txt"><b>🎵 La playlist de l'île</b><small>Notre playlist collaborative YouTube : écoute-la et ajoute tes sons préférés !</small></span>
      <span class="yt-go">Écouter →</span></a>
    <a class="card bt-home" href="#/blindtest"><span class="bt-home-ic">🎧</span><span><b>Blind test</b><small>La musique du jour et des parties en multijoueur avec tes amis !</small></span><span class="bt-home-go">Jouer →</span></a>
    ${todo.length ? `<section><h2>${todo.length > 1 ? 'Tes prochains matchs' : 'Ton prochain match'}</h2>
      <div class="grid">${todo.map(x => vsCard(x, me, oppOf(x, people))).join('')}</div></section>` : ''}
    ${liveComps.length ? `<section><h2>Compétitions</h2><div class="grid comps">${liveComps.map(competitionCard).join('')}</div></section>` : ''}
    <section>
      <h2>En cours</h2>
      <div class="grid">${running.map(tournamentCard).join('') || '<p class="empty">Aucun tournoi en cours.</p>'}</div>
    </section>
    ${open.length || !liveComps.length ? `<section>
      <h2>Inscriptions ouvertes</h2>
      <div class="grid">${open.map(tournamentCard).join('') || '<p class="empty">Aucun tournoi ouvert pour le moment.</p>'}</div>
    </section>` : ''}`;
  drawDaily();
  drawQuiz();
}


// =====================================================================
//  Historique des matchs, palmarès et face-à-face (calculés depuis les arbres)
// =====================================================================
function allMatches(tours) {
  const out = [];
  for (const t of tours || []) {
    if (!t?.bracket?.matches) continue;
    const res = resolveBracket(t.bracket);
    t.bracket.matches.forEach((m, order) => {
      const s = res.state[m.id];
      if (!s.playable || s.players.filter(Boolean).length < 2) return;
      out.push({ t, m, s, order, title: roundTitle(t.bracket, m.b, m.r) });
    });
  }
  // du plus récent au plus ancien
  return out.sort((a, b) => (b.t.created_at || '').localeCompare(a.t.created_at || '') || b.order - a.order);
}
// En 2 contre 2, les « joueurs » de l'arbre sont des équipes : bracket.teams[id] = { name, members }
const teamOf = (t, id) => t?.bracket?.teams?.[id] || null;
const sideOf = (t, s, uid) => s.players.findIndex(x => x && (x === uid || teamOf(t, x)?.members?.includes(uid)));
// Profil « équipe » pour l'affichage (nom + les 2 avatars)
function teamPerson(id, team, getP) {
  return { id, username: team.name, is_team: true, members: (team.members || []).map(m => getP(m) || { id: m, username: '?' }) };
}
function withTeams(bracket, people) {
  const all = new Map(people);
  Object.entries(bracket?.teams || {}).forEach(([id, tm]) => all.set(id, teamPerson(id, tm, m => people.get(m))));
  return all;
}
// Tous ceux qui ont gagné le tournoi (le champion, ou les 2 joueurs de l'équipe championne)
const winnerFields = (bracket, champ) => bracket?.teams ? { winner_id: null, winner_team: champ ?? null } : { winner_id: champ ?? null, winner_team: null };
const winnersOf = t => t.winner_id ? [t.winner_id] : t.winner_team ? (teamOf(t, t.winner_team)?.members || []) : [];
function matchesOf(tours, uid) {
  return allMatches(tours).filter(x => sideOf(x.t, x.s, uid) >= 0).map(x => {
    if (x.s.players.length === 4) {
      const k = x.s.ranking ? x.s.ranking.indexOf(uid) : -1;
      return { ...x, opp: null, ffa: true, team: true, place: k, done: x.s.done, won: x.s.done && k === 0, mine: null, theirs: null };
    }
    const i = sideOf(x.t, x.s, uid);
    const sc = x.s.result?.s;
    const opp = x.s.players[1 - i], oppTeam = teamOf(x.t, opp);
    return { ...x, opp, oppTeam: oppTeam ? { id: opp, ...oppTeam } : null, team: !!oppTeam,
      done: x.s.done, won: x.s.done && x.s.winner === x.s.players[i],
      mine: sc ? sc[i] : null, theirs: sc ? sc[1 - i] : null };
  });
}
// Défis amicaux (lancés depuis Discord avec /defi) : mêlés à l'historique comme des matchs
function duelMatches(duels, uid) {
  return (duels || []).filter(d => d.challenger === uid || d.opponent === uid).map(d => ({
    duel: true, t: { id: null, name: 'Défi amical', created_at: d.done_at }, title: d.game || 'Match amical', s: {}, order: 0,
    opp: d.challenger === uid ? d.opponent : d.challenger, team: false, done: true, won: d.winner === uid, mine: null, theirs: null,
  }));
}
const byDate = list => list.sort((a, b) => (b.t.created_at || '').localeCompare(a.t.created_at || ''));
const oppOf = (x, people) => x.ffa ? { username: `Match à ${x.s.players.filter(Boolean).length} · ${x.done ? PLACE[x.place] : 'à jouer'}` } : x.oppTeam ? teamPerson(x.oppTeam.id, x.oppTeam, m => people.get(m)) : people.get(x.opp) || { username: '?' };
function headToHead(list) {
  const map = new Map();
  for (const x of list) {
    if (!x.done || x.team) continue;
    const r = map.get(x.opp) || { w: 0, l: 0 };
    x.won ? r.w++ : r.l++;
    map.set(x.opp, r);
  }
  return map;
}
// Finale perdue : défaite au dernier match du tableau (finale / grande finale)
function isFinal(x) {
  if (x.duel) return false;
  const R = x.t.bracket.rounds || {};
  return x.t.bracket.format === 'double' ? x.m.b === 'GF' : x.m.b === 'W' && x.m.r === R.W;
}
function bestStreak(list) {
  let best = 0, cur = 0;
  for (const x of [...list].reverse()) { if (!x.done) continue; cur = x.won ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}
function vsCard(x, me, opp) {
  return `<a class="card next-match" href="#/tournoi/${esc(x.t.id)}">
    <div class="nm-head"><span class="nm-round">${esc(x.title)}</span><span class="nm-tour">${esc(x.t.name)}</span></div>
    <div class="nm-arena">
      <div class="nm-p">${avatar(me, 'av lg')}<b>${uname(me)}</b></div>
      <div class="nm-vs">VS</div>
      <div class="nm-p">${avatar(opp, 'av lg')}<b>${uname(opp)}</b></div>
    </div>
    <div class="nm-go">⚡ C'est à vous de jouer !</div>
  </a>`;
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

  const tabs = [['apercu', 'Vue d\'ensemble'], ['photos', '📸 Photos'], ...tours.map(t => [t.id, t.name])];
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
      ${st !== 'done' ? `<a href="#/soiree/${esc(c.id)}" class="party-btn">${st === 'running' ? '<span class="live-dot"></span> Suivre la soirée en direct' : '🎉 Mode soirée'} <span>→</span></a>` : ''}
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
        ${openTours.length ? '<button class="btn ghost sm" id="add-players">+ Inscrire des joueurs</button>' : ''}
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
          const champ = t.winner_id ? people.get(t.winner_id) : t.winner_team && teamOf(t, t.winner_team) ? teamPerson(t.winner_team, teamOf(t, t.winner_team), m => people.get(m)) : null;
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
    const ppl = withTeams(t.bracket, new Map(parts.map(p => [p.user_id, p.profile])));
    const res = t.bracket ? resolveBracket(t.bracket) : null;
    body.innerHTML = `
      <section>
        <div class="page-head"><h2>${esc(t.name)}</h2><a class="btn ghost sm" href="#/tournoi/${esc(t.id)}">Ouvrir le tournoi →</a></div>
        ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
        ${res?.champion ? `<div class="card champion small-champ">${I.trophee} ${avatar(ppl.get(res.champion), 'av')} <strong>${uname(ppl.get(res.champion))}</strong></div>` : ''}
        ${t.bracket ? `<div id="real-bracket">${renderBracket(t.bracket, res, ppl)}</div>`
          : `<p class="empty">${ppl.size} inscrit${ppl.size > 1 ? 's' : ''}. L'arbre apparaîtra quand le tournoi sera lancé.</p>`}
      </section>`;
    // Clic sur un match : sa fiche (score, joueurs, profils), comme sur la page du tournoi
    if (t.bracket) {
      const canReport = st => st.playable && (me.is_admin || (t.status === 'running' && !st.done && sideOf(t, st, me.id) >= 0));
      const reload = async () => {
        const nt = await safe(() => api.getTournament(tid)); if (nt) Object.assign(t, nt);
        showTournament(tid);
      };
      body.querySelectorAll('#real-bracket .match:not(.ghost)').forEach(el => {
        const st = res.state[el.dataset.mid];
        if (!st || !st.players.some(Boolean)) return;
        el.classList.add('clickable');
        if (canReport(st)) { el.classList.add('editable'); if (!me.is_admin) el.classList.add('mine'); }
        el.addEventListener('click', e => { e.preventDefault(); matchSheet(t, st, ppl, reload, canReport(st) ? (me.is_admin ? 'admin' : 'player') : null); });
      });
      markReactions(t.id);
    }
  };
  const show = k => {
    app.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    if (k === 'apercu') showOverview(); else if (k === 'photos') showPhotos(body, c, people); else showTournament(k);
  };
  show(tours.some(t => t.id === tab) || tab === 'photos' ? tab : 'apercu');
  app.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

  $('#add-t')?.addEventListener('click', () => tournamentForm(null, id));
  $('#add-players')?.addEventListener('click', () => addPlayersDialog({
    title: `Inscrire des joueurs à « ${c.name} »`,
    note: `Ils seront inscrits à ${openTours.length > 1 ? `tous les tournois encore ouverts (${openTours.length})` : 'son tournoi encore ouvert'}.`,
    already: new Set(regIds),
    room: null,
    addMember: uid => api.joinCompetition(id, uid),
    addGuest: name => api.addGuest(name, null, id),
    done: () => pageCompetition(id, tab),
  }));
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
${[['single|1','Élimination directe'],['double|1','Double élimination'],['single|2','👥 2 contre 2 – élimination directe'],['double|2','👥 2 contre 2 – double élimination'],['ffa4|1','Chacun pour soi à 4 (1 vs 1 vs 1 vs 1)']]
              .map(([v, l]) => `<option value="${v}" ${v === `${t?.format || 'single'}|${t?.team_size === 2 ? 2 : 1}` ? 'selected' : ''}>${l}</option>`).join('')}
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
    if (f.get('format')) { const [fm, ts] = f.get('format').split('|'); data.format = fm; data.team_size = Number(ts) || 1; }
    if (data.format === 'ffa4') data.team_size = 1;  // à 4, chacun joue pour soi
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
  // 2 contre 2 : les équipes formées par l'admin (avant lancement), puis celles figées dans l'arbre
  const duo = t.team_size === 2;
  const teams = duo ? ((await safe(() => api.listTeams(id))) || []).filter(x => x.members.every(m => people.has(m))) : [];
  const teamsObj = Object.fromEntries(teams.map(x => [x.id, { name: x.name, members: x.members }]));
  const ppl = withTeams(t.bracket || (duo ? { teams: teamsObj } : null), people);
  const inTeam = new Set(teams.flatMap(x => x.members));
  const champ = res?.champion ? ppl.get(res.champion) : null;
  const comp = t.competition_id ? await safe(() => api.getCompetition(t.competition_id)) : null;
  // Matchs que je peux renseigner : tous pour un admin, seulement le mien (pas encore joué) pour un joueur
  const ids = duo ? teams.map(x => x.id) : [...people.keys()];
  const placement = t.status === 'open' && ids.length >= 2 ? syncPlacement(t.seeding, ids, t.format) : null;
  const preview = placement ? bracketFromPlacement(placement, t.format) : null;
  const canReport = s => s.playable && (me.is_admin || (t.status === 'running' && !s.done && sideOf(t, s, me.id) >= 0));
  const myMatch = res ? Object.values(res.state).find(s => !me.is_admin && canReport(s)) : null;

  app.innerHTML = `
    ${comp ? `<a href="#/competition/${esc(comp.id)}" class="back">← ${esc(comp.name)}</a>` : '<a href="#/tournois" class="back">← Tous les tournois</a>'}
    <div class="card thead ${t.image_url ? 'with-img' : ''}">
      ${t.image_url ? `<div class="thead-img" style="background-image:url('${esc(t.image_url)}')"></div>` : ''}
      <div class="tcard-top">${tBadge(t)}<span class="fmt">${FORMAT[t.format]}${duo ? ' · 👥 2 contre 2' : ''}</span></div>
      <h1>${esc(t.name)}</h1>
      ${t.game ? `<p class="game">${esc(t.game)}</p>` : ''}
      ${t.starts_at ? `<p class="meta">${I.date} ${esc(fmtDate(t.starts_at))}</p>` : ''}
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
      ${rewardsBox(t)}
      <div class="actions left">
        ${comp && t.status === 'open' ? `<a class="btn ${joined ? 'ghost' : 'primary'}" href="#/competition/${esc(comp.id)}">${joined ? '✓ Inscrit via ' : 'S\'inscrire sur '}${esc(comp.name)}</a>` : ''}
        ${!comp && t.status === 'open' && !joined && !full ? '<button class="btn primary" id="join">Participer</button>' : ''}
        ${!comp && t.status === 'open' && joined ? '<button class="btn ghost" id="leave">Me désinscrire</button>' : ''}
        ${!comp && t.status === 'open' && !joined && full ? '<span class="pill-info">Complet</span>' : ''}
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
        <div id="real-bracket">${renderBracket(t.bracket, res, ppl)}</div>
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
        <div id="preview-bracket" class="${me.is_admin ? 'swappable' : ''}">${renderBracket(preview, resolveBracket(preview), ppl)}</div>
      </section>` : ''}

    ${duo ? `
      <section>
        <div class="page-head"><h2>👥 Équipes (${(t.bracket ? Object.keys(t.bracket.teams || {}) : teams).length})</h2>
          ${me.is_admin && t.status === 'open' && people.size - inTeam.size >= 2 ? '<button class="btn primary sm" id="add-team">+ Former une équipe</button>' : ''}</div>
        ${t.status === 'open' ? `<p class="hint">${me.is_admin ? 'Forme les équipes à partir des inscrits. Seules les équipes complètes entrent dans l\'arbre.' : 'Les équipes sont formées par les admins. Une fois dans une équipe, tu peux lui choisir un nom.'}</p>` : ''}
        <div class="teams">${Object.entries(t.bracket ? t.bracket.teams || {} : teamsObj).map(([tid, tm]) => {
          const mine = tm.members.includes(me.id);
          return `<div class="team-card ${mine ? 'mine' : ''}" data-team="${esc(tid)}" role="button" tabindex="0">
            <div class="tc-head">${avatar(ppl.get(tid), 'av md')}<strong>${esc(tm.name)}</strong>
              ${mine || me.is_admin ? `<button class="btn ghost sm" data-rename="${esc(tid)}" title="Renommer">✏️</button>` : ''}
              ${me.is_admin && t.status === 'open' ? `<button class="x" data-delteam="${esc(tid)}" title="Défaire l'équipe">✕</button>` : ''}</div>
            <div class="tc-members">${tm.members.map(m => `<a href="#/profil/${esc(m)}">${uname(people.get(m) || { username: '?' })}</a>`).join('<span>&</span>')}</div>
          </div>`;
        }).join('') || '<p class="empty">Aucune équipe pour l\'instant.</p>'}</div>
        ${t.status === 'open' && people.size > inTeam.size ? `<p class="small">Sans équipe : ${[...people.keys()].filter(u => !inTeam.has(u)).map(u => uname(people.get(u))).join(', ')}</p>` : ''}
      </section>` : ''}

    <section>
      <div class="page-head"><h2>Participants (${people.size}${t.max_players ? ' / ' + t.max_players : ''})</h2>
        ${me.is_admin && t.status === 'open' ? '<button class="btn primary sm" id="add-players">+ Ajouter des joueurs</button>' : ''}</div>
      <div class="players">
        ${[...people.entries()].map(([uid, p]) => `
          <div class="player">
            <a href="#/profil/${esc(uid)}">${avatar(p)}${uname(p)}</a>
            ${p.is_guest ? '<span class="guest-tag">Invité</span>' : topRole(p) ? rolePill(topRole(p)) : ''}
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
  $('#add-players')?.addEventListener('click', () => addPlayersDialog({
    title: `Ajouter des joueurs à « ${t.name} »`,
    already: new Set(people.keys()),
    room: t.max_players ? t.max_players - people.size : null,
    addMember: uid => api.join(id, uid),
    addGuest: name => api.addGuest(name, id, null),
    done: reload,
  }));
  $('#edit')?.addEventListener('click', () => tournamentForm(t));
  $('#del')?.addEventListener('click', () => safe(async () => {
    if (!confirm(`Supprimer définitivement « ${t.name} » ?`)) return;
    await api.clearTournamentRewards(id); await loadBalances();
    await api.deleteTournament(id); toast('Tournoi supprimé'); location.hash = '#/tournois';
  }));
  $('#reopen')?.addEventListener('click', () => safe(async () => {
    if (!confirm('L\'arbre et tous les scores seront effacés. Continuer ?')) return;
    await api.updateTournament(id, { status: 'open', bracket: null, winner_id: null, winner_team: null });
    await syncRewards(t, null); renderNav(); reload();
  }));
  $('#launch')?.addEventListener('click', () => launchDialog(t, placement, reload, duo ? teamsObj : null));
  // ----- Équipes (2 contre 2) -----
  $('#add-team')?.addEventListener('click', () => teamDialog(t, people, inTeam, teams.length, reload));
  app.querySelectorAll('[data-delteam]').forEach(b => b.addEventListener('click', () => safe(async () => {
    if (!confirm('Défaire cette équipe ? Les deux joueurs restent inscrits.')) return;
    await api.deleteTeam(b.dataset.delteam); reload();
  })));
  app.querySelectorAll('[data-team]').forEach(c => {
    const open = e => {
      if (e.target.closest('button, a')) return;
      const tid = c.dataset.team, tm = (t.bracket?.teams || teamsObj)[tid];
      if (tm) teamSheet(t, tid, tm, people, ppl);
    };
    c.addEventListener('click', open);
    c.addEventListener('keydown', e => { if (e.key === 'Enter') open(e); });
  });
  app.querySelectorAll('[data-rename]').forEach(b => b.addEventListener('click', () => safe(async () => {
    const cur = (t.bracket?.teams || teamsObj)[b.dataset.rename]?.name || '';
    const name = (prompt('Nom de l\'équipe (40 caractères max) :', cur) || '').trim();
    if (!name || name === cur) return;
    await api.renameTeam(b.dataset.rename, name.slice(0, 40)); toast('Équipe renommée'); reload();
  })));

  // ----- Aperçu (avant lancement) : échanger, mélanger -----
  const savePlacement = pl => safe(async () => { await api.updateTournament(t.id, { seeding: pl }); reload(); });
  $('#shuffle')?.addEventListener('click', () => savePlacement(placementFor(shuffled(ids), t.format)));
  $('#reset-order')?.addEventListener('click', () => savePlacement(placementFor(ids, t.format)));
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
        const per = W1[0].slots.length;
        const slotOf = n => W1[Math.floor(n / per)].slots[n % per];
        const touched = new Set([W1[Math.floor(a / per)].id, W1[Math.floor(b / per)].id]);
        if ([...touched].some(mid => bracket.results?.[mid]) &&
            !confirm('Ces matchs ont déjà un résultat : il sera effacé. Continuer ?')) return;
        const pa = slotOf(a).p ?? null, pb = slotOf(b).p ?? null;
        slotOf(a).p = pb; slotOf(b).p = pa;
        touched.forEach(mid => delete bracket.results?.[mid]);
        const r = resolveBracket(bracket);
        await api.updateTournament(t.id, { bracket, status: r.champion ? 'done' : 'running', ...winnerFields(bracket, r.champion) });
        toast('Arbre modifié'); reload();
      }));
    } else reload();
  });

  // Les admins peuvent entrer (ou corriger, même après la fin) un score ;
  // les deux joueurs d'un match peuvent déclarer leur résultat (une seule fois)
  // Clic sur n'importe quel match : fiche du match (score, adversaires) ;
  // depuis la fiche, ceux qui en ont le droit peuvent renseigner le score
  if (t.bracket) {
    app.querySelectorAll('#real-bracket .match:not(.ghost)').forEach(el => {
      const s = res.state[el.dataset.mid];
      if (!s || !s.players.some(Boolean)) return;
      el.classList.add('clickable');
      if (canReport(s)) { el.classList.add('editable'); if (!me.is_admin) el.classList.add('mine'); }
      el.addEventListener('click', () => matchSheet(t, s, ppl, reload, canReport(s) ? (me.is_admin ? 'admin' : 'player') : null));
    });
    markReactions(t.id);
  }
  // Tournoi terminé par un joueur : l'admin qui passe distribue les gains
  if (me.is_admin && t.status === 'done' && t.bracket) {
    safe(async () => {
      const paid = await api.ledgerForTournaments([t.id]);
      if (!paid.length && computeRewards(t, t.bracket).length) { await syncRewards(t, t.bracket); renderNav(); }
    });
  }

  if (t.bracket?.draw) maybePlayDraw(t, ppl);

  // Mise à jour en direct quand un admin entre un score
  let timer;
  unsubscribe = api.subscribe(id, () => { clearTimeout(timer); timer = setTimeout(() => { if (modal.classList.contains('hidden')) reload(); }, 400); });
}

function launchDialog(t, placement, reload, teams = null) {
  const n = (placement || []).filter(Boolean).length;
  if (n < 2) return toast(teams ? 'Il faut au moins 2 équipes complètes' : 'Il faut au moins 2 participants', 'err');
  const box = openModal(`
    <h2>Lancer « ${esc(t.name)} »</h2>
    <p>${n} ${teams ? 'équipes' : 'participants'} · ${FORMAT[t.format]}. Les inscriptions seront fermées.</p>
    <p class="small">L'arbre lancé sera celui de l'aperçu (tu peux encore le modifier après le lancement).</p>
    <label class="radio"><input type="checkbox" id="mix" checked> 🎰 Tirage au sort en direct (les places sont tirées au hasard sous les yeux de tous)</label>
    <div class="actions"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="go">C'est parti !</button></div>`);
  $('#go', box).addEventListener('click', () => safe(async () => {
    const live = $('#mix', box).checked;
    const pl = live ? placementFor(shuffled(placement.filter(Boolean)), t.format) : placement;
    const bracket = bracketFromPlacement(pl, t.format);
    if (live) bracket.draw = { at: Date.now() };
    if (teams) bracket.teams = teams;
    await api.updateTournament(t.id, { status: 'running', bracket, seeding: pl, winner_id: null, winner_team: null });
    closeModal(); toast('Le tournoi commence !'); reload();
  }));
}

// Former une équipe : choisir 2 inscrits sans équipe
// Fiche d'une équipe : ses 2 joueurs et son parcours dans le tournoi
function teamSheet(t, tid, tm, people, ppl) {
  const members = tm.members.map(m => people.get(m) || { id: m, username: '?' });
  const res = t.bracket ? resolveBracket(t.bracket) : null;
  const run = res ? t.bracket.matches.map(m => ({ m, s: res.state[m.id] }))
    .filter(x => x.s.playable && x.s.players.includes(tid)) : [];
  const champ = t.winner_team === tid;
  const line = ({ m, s }) => {
    const i = s.players.indexOf(tid), opp = ppl.get(s.players[1 - i]) || { username: '?' };
    const sc = s.result?.s;
    const st = s.done ? (s.winner === tid ? 'w' : 'l') : 'todo';
    return `<div class="tline mrow ${st}">
      <span class="mres">${s.done ? (s.winner === tid ? 'V' : 'D') : '⚔️'}</span>
      <span class="mopp">${avatar(opp, 'av sm')} <span>${uname(opp)}</span></span>
      <span class="mscore">${sc ? `${esc(sc[i])} – ${esc(sc[1 - i])}` : s.done ? '' : 'à jouer'}</span>
      <small class="muted mwhere">${esc(roundTitle(t.bracket, m.b, m.r))}</small>
    </div>`;
  };
  const W = run.filter(x => x.s.done && x.s.winner === tid).length, L = run.filter(x => x.s.done && x.s.winner !== tid).length;
  openModal(`
    <div class="team-sheet">
      <div class="ts-avs">${members.map(m => avatar(m, 'av xl')).join('')}</div>
      <h2>${champ ? '🏆 ' : ''}${esc(tm.name)}</h2>
      <p class="muted">${esc(t.name)}${run.length ? ` · ${W} victoire${W > 1 ? 's' : ''} – ${L} défaite${L > 1 ? 's' : ''}` : ''}</p>
      <div class="ts-members">${members.map(m => `
        <a href="#/profil/${esc(m.id)}" class="ts-m">${avatar(m, 'av md')}<span><b>${uname(m)}</b>${wtitle(m)}</span><span class="ts-go">Profil →</span></a>`).join('')}</div>
      ${run.length ? `<h3>Parcours</h3><div class="tlist mhist">${run.map(line).join('')}</div>`
        : `<p class="hint">${t.status === 'open' ? 'Le tournoi n\'est pas encore lancé.' : 'Pas encore de match joué.'}</p>`}
      <div class="actions center"><button type="button" class="btn ghost" data-close>Fermer</button></div>
    </div>`, 'team-modal');
  modal.querySelectorAll('.ts-m').forEach(a => a.addEventListener('click', closeModal));
}

function teamDialog(t, people, inTeam, count, reload) {
  const free = [...people.entries()].filter(([u]) => !inTeam.has(u));
  const box = openModal(`
    <h2>Former une équipe</h2>
    <p class="small">Choisis 2 joueurs. Ils pourront ensuite donner un nom à leur équipe.</p>
    <div class="team-pick">${free.map(([u, p]) => `<label class="tp"><input type="checkbox" value="${esc(u)}">${avatar(p, 'av sm')}${uname(p)}</label>`).join('')}</div>
    <div class="form"><label>Nom de l'équipe<input id="tm-name" maxlength="40" value="Équipe ${count + 1}"></label></div>
    <div class="actions"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="tm-ok" disabled>Créer l'équipe</button></div>`);
  const boxes = [...box.querySelectorAll('.tp input')];
  boxes.forEach(c => c.addEventListener('change', () => {
    const on = boxes.filter(x => x.checked);
    boxes.forEach(x => (x.disabled = !x.checked && on.length >= 2));
    $('#tm-ok', box).disabled = on.length !== 2;
  }));
  $('#tm-ok', box).addEventListener('click', () => safe(async () => {
    const members = boxes.filter(x => x.checked).map(x => x.value);
    await api.createTeam(t.id, ($('#tm-name', box).value.trim() || `Équipe ${count + 1}`).slice(0, 40), members);
    closeModal(); toast('Équipe créée !'); reload();
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
      const per = el.closest('.match').querySelectorAll('.mslot').length;
      const n = Number(el.closest('.match').dataset.mid.split('-')[1]) * per + Number(el.dataset.si);
      if (first === null) { first = n; el.classList.add('picked'); return; }
      root.querySelectorAll('.picked').forEach(x => x.classList.remove('picked'));
      const a = first; first = null;
      if (a !== n) onSwap(a, n);
    });
  });
}

// ---------- Fiche d'un match (style combat sous l'orage) ----------
const BOLTS = [
  'M30 0 L18 34 L30 34 L14 80',
  'M70 0 L82 30 L70 32 L88 76',
  'M50 0 L42 22 L56 26 L44 54 L58 60 L48 90',
];
function matchSheet(t, s, people, reload, canEdit) {
  if (s.players.length === 4) return matchSheet4(t, s, people, reload, canEdit);
  const m = (t.bracket.matches || []).find(x => x.id === s.id) || { b: 'W', r: 1 };
  const title = roundTitle(t.bracket, m.b, m.r);
  const who = i => s.players[i] ? people.get(s.players[i]) || { username: '?' } : null;
  const sc = s.result?.s;
  const by = s.result?.by ? people.get(s.result.by) : null;
  const fighter = i => {
    const p = who(i);
    const st = !s.done || s.bye ? '' : s.winner === s.players[i] ? 'win' : 'lose';
    return `<div class="ms-fighter ${st} side${i}">
      ${p?.is_team ? `<div class="ms-av ms-duo">${p.members.map(m => `<a href="#/profil/${esc(m.id)}">${avatar(m, 'av lg')}</a>`).join('')}</div>
             <div class="ms-name">${uname(p)}</div>
             <div class="ms-members">${p.members.map(m => `<a href="#/profil/${esc(m.id)}">${uname(m)}</a>`).join(' & ')}</div>`
        : p ? `<a href="#/profil/${esc(s.players[i])}" class="ms-av">${avatar(p, 'av xl')}</a>
             <div class="ms-name">${uname(p)}</div>${wtitle(p)}
             <div class="ms-roles">${rolesOf(p).slice(0, 2).map(rolePill).join('')}</div>`
          : `<div class="ms-av empty">?</div><div class="ms-name muted">${s.deadSlot?.[i] ? 'Exempt' : 'En attente…'}</div>`}
      ${st === 'win' ? `<div class="ms-crown">${I.trophee} Vainqueur</div>` : ''}
      ${st === 'win' && p?.item_victory && state.items.get(p.item_victory) ? victoryFx(state.items.get(p.item_victory).effect) : ''}
    </div>`;
  };
  const status = s.bye ? 'Qualifié d\'office' : s.done ? 'Match terminé' : s.playable ? 'Combat à venir' : 'En attente des adversaires';
  const bolts = (side) => `<svg class="ms-bolt ${side}" viewBox="0 0 100 90" aria-hidden="true">${BOLTS.map((d, k) =>
    `<path d="${d}" style="animation-delay:${(k * .7 + (side === 'r' ? .35 : 0)).toFixed(2)}s"/>`).join('')}</svg>`;
  const box = openModal(`
    <div class="ms-storm" aria-hidden="true"><i class="ms-flash"></i><i class="ms-rain"></i>${bolts('l')}${bolts('r')}</div>
    <button class="ms-close" data-close aria-label="Fermer">✕</button>
    <div class="ms-head"><span class="ms-round">${esc(title)}</span><span class="ms-tour">${esc(t.name)}</span></div>
    <div class="ms-arena">
      ${fighter(0)}
      <div class="ms-mid">
        ${sc ? `<div class="ms-score"><b class="${s.winner === s.players[0] ? 'hi' : ''}">${esc(sc[0])}</b><span>–</span><b class="${s.winner === s.players[1] ? 'hi' : ''}">${esc(sc[1])}</b></div>` : ''}
        <div class="ms-vs">VS</div>
      </div>
      ${fighter(1)}
    </div>
    <div class="ms-status ${s.done ? 'done' : s.playable ? 'live' : ''}">${status}</div>
    ${by ? `<p class="ms-by">Résultat déclaré par ${uname(by)}</p>` : ''}
    ${s.players[0] && s.players[1] && !t.bracket.teams ? '<div class="ms-h2h" id="ms-h2h"></div>' : ''}
    ${s.players[0] && s.players[1] ? '<div class="ms-react" id="ms-react"></div>' : ''}
    ${canEdit && s.playable ? `<div class="actions center"><button class="btn primary" id="ms-edit">${s.done ? '✏️ Corriger le score' : '⚡ Renseigner le score'}</button></div>` : ''}`, 'match-sheet');
  $('#ms-edit', box)?.addEventListener('click', () => scoreDialog(t, s, people, reload, canEdit === 'player'));
  if (s.players[0] && s.players[1]) drawReactions($('#ms-react', box), t, s.id, people);
  // Face-à-face entre les deux joueurs, tous tournois confondus
  if (s.players[0] && s.players[1] && !t.bracket.teams) Promise.all([safe(() => api.listTournaments()), safe(() => api.listDuels(s.players[0]))]).then(([all, duels]) => {
    const el = $('#ms-h2h', box); if (!el) return;
    const r = headToHead([...matchesOf(all || [], s.players[0]), ...duelMatches(duels, s.players[0])]).get(s.players[1]) || { w: 0, l: 0 };
    el.innerHTML = r.w + r.l ? `<small>Face-à-face</small><b><span class="${r.w >= r.l ? 'hi' : ''}">${r.w}</span> – <span class="${r.l >= r.w ? 'hi' : ''}">${r.l}</span></b><small>${r.w + r.l} match${r.w + r.l > 1 ? 's' : ''}</small>` : '<small>Premier affrontement entre eux !</small>';
  });
}

// Fiche d'un match à 4 joueurs : les 4 en lice, puis le classement une fois joué
function matchSheet4(t, s, people, reload, canEdit) {
  const m = t.bracket.matches.find(x => x.id === s.id) || { b: 'W', r: 1 };
  const final = m.r === t.bracket.rounds.W;
  const ids = s.ranking || s.players.filter(Boolean);
  const by = s.result?.by ? people.get(s.result.by) : null;
  const card = (id, k) => {
    const p = people.get(id) || { id, username: '?' };
    const q = s.ranking && !s.bye ? (k < 2 ? (final ? (k === 0 ? 'champ' : 'q') : 'q') : 'out') : '';
    return `<div class="f4 ${q}">
      ${s.ranking && !s.bye ? `<span class="f4-rank">${[I.medal1, I.medal2, I.medal3][k] || PLACE[k]}</span>` : ''}
      <a href="#/profil/${esc(id)}">${avatar(p, 'av lg')}</a>
      <div class="ms-name">${uname(p)}</div>
      ${s.ranking && !s.bye ? `<small>${final ? (k === 0 ? '🏆 Champion' : PLACE[k] + ' place') : k < 2 ? 'Qualifié' : 'Éliminé'}</small>` : ''}
      ${final && k === 0 && p.item_victory && state.items.get(p.item_victory) ? victoryFx(state.items.get(p.item_victory).effect) : ''}
    </div>`;
  };
  const waiting = s.players.filter(x => !x).length && !s.done && !s.playable;
  const status = s.bye ? 'Qualifiés d\'office' : s.done ? 'Match terminé' : s.playable ? 'Combat à venir' : 'En attente des joueurs';
  const box = openModal(`
    <div class="ms-storm" aria-hidden="true"><i class="ms-flash"></i><i class="ms-rain"></i></div>
    <button class="ms-close" data-close aria-label="Fermer">✕</button>
    <div class="ms-head"><span class="ms-round">${esc(roundTitle(t.bracket, m.b, m.r))}</span><span class="ms-tour">${esc(t.name)} · ${final ? 'le 1er gagne le tournoi' : 'les 2 premiers passent'}</span></div>
    <div class="f4-grid">${ids.map(card).join('')}${waiting ? `<div class="f4 wait"><div class="ms-av empty">?</div><div class="ms-name muted">En attente…</div></div>` : ''}</div>
    <div class="ms-status ${s.done ? 'done' : s.playable ? 'live' : ''}">${status}</div>
    ${by ? `<p class="ms-by">Résultat déclaré par ${uname(by)}</p>` : ''}
    ${s.playable ? '<div class="ms-react" id="ms-react"></div>' : ''}
    ${canEdit && s.playable ? `<div class="actions center"><button class="btn primary" id="ms-edit">${s.done ? '✏️ Corriger le classement' : '⚡ Renseigner le classement'}</button></div>` : ''}`, 'match-sheet m4-sheet');
  $('#ms-edit', box)?.addEventListener('click', () => rankDialog(t, s, people, reload, canEdit === 'player'));
  if (s.playable) drawReactions($('#ms-react', box), t, s.id, people);
}
// Classement d'un match à 4 : on touche les joueurs dans l'ordre d'arrivée
function rankDialog(t, s, people, reload, asPlayer) {
  const real = s.players.filter(Boolean);
  let order = [];
  const box = openModal(`
    <h2>Classement du match</h2>
    <p class="small center">Touche les joueurs dans l'ordre d'arrivée : d'abord le 1er, puis le 2e…</p>
    ${asPlayer ? '<p class="small center">Tout le monde verra ce résultat. En cas d\'erreur, seul un admin pourra le corriger.</p>' : ''}
    <div class="rank-pick" id="rk"></div>
    <div class="actions center"><button class="btn ghost" id="rk-reset">Recommencer</button><button class="btn primary" id="rk-ok" disabled>Valider</button></div>`);
  const draw = () => {
    $('#rk', box).innerHTML = real.map(id => {
      const k = order.indexOf(id), p = people.get(id) || { username: '?' };
      return `<button class="rkp ${k >= 0 ? 'on' : ''}" data-id="${esc(id)}">${k >= 0 ? `<b>${PLACE[k]}</b>` : '<b class="muted">?</b>'}${avatar(p, 'av sm')}<span>${uname(p)}</span></button>`;
    }).join('');
    box.querySelectorAll('.rkp').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.id;
      order = order.includes(id) ? order.filter(x => x !== id) : [...order, id];
      if (order.length === real.length - 1) order.push(real.find(x => !order.includes(x)));
      draw();
    }));
    $('#rk-ok', box).disabled = order.length !== real.length;
  };
  draw();
  $('#rk-reset', box).addEventListener('click', () => { order = []; draw(); });
  $('#rk-ok', box).addEventListener('click', () => safe(async () => {
    const r = await api.reportFfa(t.id, s.id, order);
    closeModal();
    if (r?.champion && !asPlayer) {
      const nt = await api.getTournament(t.id);
      await syncRewards(nt, nt.bracket); renderNav();
      toast('🏆 Nous avons un champion ! Les récompenses sont distribuées.');
    } else toast(r?.champion ? '🏆 Tournoi terminé ! Les récompenses arrivent au prochain passage d\'un admin.' : 'Classement enregistré, merci !');
    reload();
  }));
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
    await api.updateTournament(t.id, { bracket, status: r.champion ? 'done' : 'running', ...winnerFields(bracket, r.champion) });
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
  if (s.players.length === 4) {
    // match à 4 : classement affiché à droite, les 2 premiers (qualifiés) en vert
    const rk = id => s.ranking ? s.ranking.indexOf(id) : -1;
    const slot4 = idx => {
      const id = s.players[idx], p = id ? people.get(id) : null, k = rk(id);
      const label = p ? `${avatar(p, 'av xs')}<span class="name">${uname(p)}</span>`
        : `<span class="name muted">${s.deadSlot[idx] ? '—' : 'En attente…'}</span>`;
      return `<div class="mslot ${k >= 0 && k < 2 && !s.bye ? 'win' : ''} ${k >= 2 ? 'lose' : ''} ${!p && s.deadSlot[idx] ? 'empty4' : ''}" data-si="${idx}">${label}<span class="score">${k >= 0 && !s.bye ? PLACE[k] : ''}</span></div>`;
    };
    return `<div class="match m4 ${s.playable ? 'playable' : ''} ${s.done ? 'done' : ''} ${s.bye ? 'bye' : ''}" data-mid="${esc(s.id)}">${[0, 1, 2, 3].map(slot4).join('')}</div>`;
  }
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
      .map(p => `<a class="card member" href="#/profil/${esc(p.id)}">${avatar(p, 'av lg')}<strong>${uname(p)}</strong>${wtitle(p)}${p.is_guest ? '<span class="guest-tag">Invité · sans compte</span>' : topRole(p) ? rolePill(topRole(p)) : ''}<span class="member-money">${pts(bal(p.id).points)} ${rubis(bal(p.id).rubis)}</span>${p.is_guest && state.me.is_admin ? `<button class="x" data-delguest="${esc(p.id)}" title="Supprimer cet invité">✕</button>` : ''}</a>`)
      .join('') || '<p class="empty">Aucun membre trouvé.</p>';
  };
  draw('');
  $('#q').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
  $('#mlist').addEventListener('click', e => {
    const b = e.target.closest('[data-delguest]'); if (!b) return;
    e.preventDefault();
    safe(async () => {
      if (!confirm('Supprimer cet invité ? Il sera retiré de tous les tournois pas encore terminés et perdra ses points et rubis.')) return;
      await api.deleteGuest(b.dataset.delguest); toast('Invité supprimé'); pageMembers();
    });
  });
}

// ---------- Ajout manuel de joueurs (admins) : membres du site ou invités sans compte ----------
async function addPlayersDialog({ title, note, already, room, addMember, addGuest, done }) {
  const all = (await safe(() => api.listMembers()) || []).filter(m => !already.has(m.id));
  const box = openModal(`
    <h2>${esc(title)}</h2>
    ${note ? `<p class="small">${esc(note)}</p>` : ''}
    ${room !== null ? `<p class="small">Places restantes : <b id="room">${Math.max(0, room)}</b></p>` : ''}
    <h3>Membres du site</h3>
    <input class="search" id="ap-q" placeholder="Rechercher un membre…">
    <div class="ap-list" id="ap-list"></div>
    <div class="actions"><button class="btn primary" id="ap-add" disabled>Ajouter la sélection</button></div>
    <h3>Joueur sans compte</h3>
    <p class="small">Pour quelqu'un qui ne s'est jamais connecté au site : il apparaîtra avec la mention « Invité ».</p>
    <div class="row ap-guest"><input id="ap-name" maxlength="40" placeholder="Pseudo du joueur"><button class="btn ghost" id="ap-guest">Ajouter l'invité</button></div>
    <div class="actions"><button class="btn ghost" data-close>Fermer</button></div>`);
  const picked = new Set();
  const left = () => room === null ? Infinity : room - picked.size;
  const draw = q => {
    const list = all.filter(m => !q || m.username?.toLowerCase().includes(q));
    $('#ap-list', box).innerHTML = list.map(m => `
      <label class="ap-item ${picked.has(m.id) ? 'on' : ''}">
        <input type="checkbox" value="${esc(m.id)}" ${picked.has(m.id) ? 'checked' : ''}>
        ${avatar(m, 'av sm')}${uname(m)}${m.is_guest ? '<span class="guest-tag">Invité</span>' : ''}
      </label>`).join('') || `<p class="empty">${all.length ? 'Aucun membre trouvé.' : 'Tous les membres du site sont déjà inscrits.'}</p>`;
  };
  draw('');
  $('#ap-q', box).addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
  $('#ap-list', box).addEventListener('change', e => {
    const cb = e.target; if (cb.type !== 'checkbox') return;
    if (cb.checked && left() <= 0) { cb.checked = false; toast('Le tournoi est complet', 'err'); return; }
    cb.checked ? picked.add(cb.value) : picked.delete(cb.value);
    cb.closest('.ap-item').classList.toggle('on', cb.checked);
    $('#ap-add', box).disabled = !picked.size;
    $('#ap-add', box).textContent = picked.size ? `Ajouter la sélection (${picked.size})` : 'Ajouter la sélection';
    if ($('#room', box)) $('#room', box).textContent = Math.max(0, left());
  });
  $('#ap-add', box).addEventListener('click', () => safe(async () => {
    const ids = [...picked];
    for (const uid of ids) await addMember(uid);
    toast(`${ids.length} joueur${ids.length > 1 ? 's ajoutés' : ' ajouté'} !`);
    closeModal(); done();
  }));
  const addG = () => safe(async () => {
    const name = $('#ap-name', box).value.trim();
    if (!name) return toast('Écris le pseudo du joueur', 'err');
    if (left() <= 0) return toast('Le tournoi est complet', 'err');
    await addGuest(name);
    if (room !== null) room--;
    if ($('#room', box)) $('#room', box).textContent = Math.max(0, left());
    $('#ap-name', box).value = '';
    toast(`${name} a été ajouté`);
    done();
  });
  $('#ap-guest', box).addEventListener('click', addG);
  $('#ap-name', box).addEventListener('keydown', e => { if (e.key === 'Enter') addG(); });
}

// ---------- Profil ----------
async function pageProfile(id) {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  await loadBalances();
  const [p, ts, hist, members, duels] = await Promise.all([safe(() => api.getProfile(id)), safe(() => api.userStats(id)), safe(() => api.ledger(id)), safe(() => api.listMembers()), safe(() => api.listDuels(id))]);
  if (!p) { app.innerHTML = '<p class="empty">Profil introuvable.</p>'; return; }
  const tours = ts || [];
  const people = new Map((members || []).map(m => [m.id, m]));
  const who = uid => people.get(uid) || { id: uid, username: '?' };
  const mm = byDate([...matchesOf(tours, id), ...duelMatches(duels, id)]);
  const played = mm.filter(x => x.done);
  const W = played.filter(x => x.won).length, L = played.length - W;
  const finals = played.filter(x => !x.won && isFinal(x));
  const h2h = [...headToHead(mm)].sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l));
  const vsMe = id !== state.me.id ? headToHead(mm).get(state.me.id) : null;
  const wins = tours.filter(t => winnersOf(t).includes(id));
  const color = topRole(p)?.color || '#2fa4e7';
  Promise.all([safe(() => api.listAchievements()), safe(() => api.achievementsDone(id))]).then(([all, done]) => {
    const el = $('#prof-ach'); if (!el || !all) return;
    const got = new Set((done || []).map(x => x.achievement_id));
    el.innerHTML = `<h2>Succès <small class="muted">${got.size} / ${all.length}</small></h2>
      <div class="ach-badges">${all.map(a => `<span class="ach-badge ${got.has(a.id) ? 'on' : ''}" title="${esc(a.name)} : ${esc(a.description)}">${esc(a.icon)}</span>`).join('')}</div>
      ${id === state.me.id ? '<a href="#/succes" class="small">Voir mes succès →</a>' : ''}`;
  });
  app.innerHTML = `
    <div class="card profile" style="--pc:${esc(color)}">
      <div class="profile-banner"></div>
      <div class="profile-body">
        ${avatar(p, 'av xl')}
        <h1>${uname(p)}</h1>
        ${wtitle(p)}
        ${p.is_admin ? '<span class="pill-info">Organisateur de tournois</span>' : ''}
        <h3>Rôles sur le serveur</h3>
        <div class="roles">${rolesOf(p).map(rolePill).join('') || '<span class="muted">Aucun rôle</span>'}</div>
        ${p.id === state.me.id ? '<button class="btn ghost sm refresh" id="refresh-roles">↻ Actualiser mes rôles</button>' : ''}
        ${p.id !== state.me.id && p.in_guild && !p.is_guest ? '<button class="btn primary duel-btn" id="duel-btn">⚔️ Défier</button>' : p.id === state.me.id ? '<a class="btn ghost sm" href="#/defis">⚔️ Mes défis</a>' : ''}
        <div class="stats">
          <div><strong>${tours.length}</strong><span>tournoi${tours.length > 1 ? 's' : ''} joué${tours.length > 1 ? 's' : ''}</span></div>
          <div><strong>${wins.length}</strong><span>victoire${wins.length > 1 ? 's' : ''} ${I.trophee}</span></div>
          <div><strong>${pts(bal(id).points)}</strong><span>points · ${rankOf(id)}</span></div>
          <div><strong>${rubis(bal(id).rubis)}</strong><span>rubis</span></div>
        </div>
        ${state.me.is_admin ? `<button class="btn ghost sm" id="give">${I.rubis} Donner / retirer des rubis ou points</button>` : ''}
      </div>
    </div>
    ${vsMe ? `<div class="card h2h-me">
      ${avatar(state.me, 'av md')}<div><small>Toi contre ${uname(p)}</small>
      <b class="${vsMe.w > vsMe.l ? 'up' : vsMe.w < vsMe.l ? 'down' : ''}">${vsMe.w} – ${vsMe.l}</b></div>${avatar(p, 'av md')}</div>` : ''}
    <section>
      <h2>Palmarès</h2>
      <div class="palma">
        <div class="pal gold"><span>🏆</span><b>${wins.length}</b><small>titre${wins.length > 1 ? 's' : ''}</small></div>
        <div class="pal silver"><span>🥈</span><b>${finals.length}</b><small>finale${finals.length > 1 ? 's' : ''} perdue${finals.length > 1 ? 's' : ''}</small></div>
        <div class="pal"><span>⚔️</span><b>${W} – ${L}</b><small>victoires – défaites</small></div>
        <div class="pal"><span>📈</span><b>${played.length ? Math.round(100 * W / played.length) : 0}%</b><small>de victoires</small></div>
        <div class="pal fire"><span>🔥</span><b>${bestStreak(mm)}</b><small>meilleure série</small></div>
      </div>
      ${wins.length ? `<div class="trophies">${wins.map(t => `<a href="#/tournoi/${esc(t.id)}" class="trophy">${I.trophee} ${esc(t.name)}</a>`).join('')}</div>` : ''}
    </section>
    <section id="prof-ach"></section>
    <section>
      <h2>Historique des matchs</h2>
      <div class="tlist mhist">
        ${mm.slice(0, 30).map(x => `
          <a href="${x.duel ? `#/profil/${esc(x.opp)}` : `#/tournoi/${esc(x.t.id)}`}" class="tline mrow ${x.done ? (x.won ? 'w' : 'l') : 'todo'} ${x.duel ? 'duel' : ''}">
            <span class="mres">${x.done ? (x.won ? 'V' : 'D') : '⚔️'}</span>
            <span class="mopp">${avatar(oppOf(x, { get: who }), 'av sm')} <span>${uname(oppOf(x, { get: who }))}</span></span>
            <span class="mscore">${x.mine != null ? `${esc(x.mine)} – ${esc(x.theirs)}` : x.done ? '' : 'à jouer'}</span>
            <small class="muted mwhere">${x.duel ? '⚔️ ' : ''}${esc(x.t.name)} · ${esc(x.title)}</small>
          </a>`).join('') || '<p class="empty">Aucun match joué pour l\'instant.</p>'}
      </div>
    </section>
    ${h2h.length ? `<section>
      <h2>Face-à-face</h2>
      <div class="tlist">
        ${h2h.map(([uid, r]) => `
          <a href="#/profil/${esc(uid)}" class="tline h2h">
            <span class="mopp">${avatar(who(uid), 'av sm')} <span>${uname(who(uid))}</span></span>
            <span class="h2h-bar"><i style="width:${Math.round(100 * r.w / (r.w + r.l))}%"></i></span>
            <b class="${r.w > r.l ? 'up' : r.w < r.l ? 'down' : ''}">${r.w} – ${r.l}</b>
          </a>`).join('')}
      </div>
    </section>` : ''}
    <section>
      <h2>Tournois</h2>
      <div class="tlist">
        ${tours.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map(t => `
          <a href="#/tournoi/${esc(t.id)}" class="tline">
            <span>${winnersOf(t).includes(id) ? I.trophee + ' ' : ''}${esc(t.name)}</span>
            ${tBadge(t)}
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
  $('#duel-btn')?.addEventListener('click', () => duelDialog(p));
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
  const by = { points: 'points', season: 'season' };
  const [board, past] = await Promise.all([safe(() => api.seasonBoard?.()), safe(() => api.seasons?.())]);
  const sPts = new Map((board || []).map(r => [r.user_id, r.points]));
  const people = new Map(list.map(m => [m.id, m]));
  const draw = key => {
    if (key === 'season') return drawSeason();

    const sorted = [...list].sort((a, b) => b[key] - a[key] || a.username.localeCompare(b.username));
    const podium = sorted.slice(0, 3);
    $('#lb').className = 'by-' + key;
    $('#lb').innerHTML = `
      <div class="podium">
        ${[1, 0, 2].map(i => podium[i] ? `
          <a href="#/profil/${esc(podium[i].id)}" class="podium-step p${i + 1}">
            ${avatar(podium[i], 'av lg')}
            <strong>${uname(podium[i])}</strong>
            ${pts(podium[i].points)}
            <div class="step">${[I.medal1, I.medal2, I.medal3][i]}</div>
          </a>` : '<div></div>').join('')}
      </div>
      <div class="lb-table">
        ${sorted.slice(3).map((m, i) => `
          <a href="#/profil/${esc(m.id)}" class="lb-row ${m.id === state.me.id ? 'me-row' : ''}">
            <span class="lb-rank">${i + 4}</span>
            ${avatar(m, 'av sm')}
            <span class="lb-name">${uname(m)}</span>
            ${pts(m.points)}
          </a>`).join('') || (sorted.length ? '' : '<p class="empty">Personne pour l\'instant.</p>')}
      </div>`;
  };
  // Saison du mois : seuls les points gagnés ce mois-ci comptent ; le top 3 gagne un titre exclusif
  const drawSeason = () => {
    const now = new Date(), name = now.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'Europe/Paris' });
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1), days = Math.max(0, Math.ceil((end - now) / 864e5));
    const rows = list.filter(m => sPts.get(m.id) > 0).map(m => ({ ...m, sp: sPts.get(m.id) })).sort((a, b) => b.sp - a.sp);
    const myRank = rows.findIndex(m => m.id === state.me.id);
    const short = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }).slice(5, 7)) - 1];
    const prizes = [['👑', 'Champion', 'or', '+100'], ['🥈', 'Vice-champion', 'galaxie', '+60'], ['🥉', 'Podium', 'feu', '+30']];
    const last = (past || [])[0];
    $('#lb').className = 'by-season';
    $('#lb').innerHTML = `
      <div class="season-hero">
        <div><small>Saison en cours</small><h2>🗓️ Saison de ${esc(name)}</h2>
          <p>Seuls les ${I.points} points gagnés <b>ce mois-ci</b> comptent. Tout le monde repart de zéro le 1<sup>er</sup> du mois !</p></div>
        <div class="season-end"><b>${days}</b><small>jour${days > 1 ? 's' : ''} restant${days > 1 ? 's' : ''}</small></div>
      </div>
      <div class="season-prizes">${prizes.map(([ic, t, fx, r], i) => `<div class="sp-card r${i + 1}"><span class="sp-ic">${ic}</span>
        <span class="sp-t">${t}<em>${short}</em></span><small>Titre exclusif · ${r} ${I.rubis}</small></div>`).join('')}</div>
      ${myRank >= 0 ? `<p class="season-me">Tu es <b>${myRank + 1}<sup>${myRank ? 'e' : 'er'}</sup></b> avec ${pts(rows[myRank].sp)} ce mois-ci${myRank > 2 ? ` · encore ${rows[2].sp - rows[myRank].sp + 1} ${I.points} pour le podium !` : ' : accroche-toi ! 🔥'}</p>`
        : '<p class="season-me">Tu n\'as pas encore de points ce mois-ci : joue un tournoi, un défi ou un Quiz Battle pour entrer dans la course ! ⚔️</p>'}
      <div class="lb-table">${rows.map((m, i) => `
        <a href="#/profil/${esc(m.id)}" class="lb-row ${m.id === state.me.id ? 'me-row' : ''} ${i < 3 ? 'top' : ''}">
          <span class="lb-rank">${[I.medal1, I.medal2, I.medal3][i] || i + 1}</span>${avatar(m, 'av sm')}
          <span class="lb-name">${uname(m)}</span>${pts(m.sp)}
        </a>`).join('') || '<p class="empty">Personne n\'a encore marqué de points ce mois-ci. À toi de jouer !</p>'}</div>
      ${last?.ranking?.length ? `<div class="season-past"><h3>🏆 Champions de ${esc(new Date(last.month + 'T12:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))}</h3>
        <div class="sp-past">${last.ranking.map(r => { const m = people.get(r.user_id); return m ? `<a href="#/profil/${esc(m.id)}">${[I.medal1, I.medal2, I.medal3][r.rank - 1]} ${avatar(m, 'av sm')} <b>${uname(m)}</b> <small>${r.points} pts</small></a>` : ''; }).join('')}</div></div>` : ''}`;
  };
  app.innerHTML = `
    <div class="page-head"><h1>Classement</h1>
      <div class="seg"><button class="on" data-k="season">🗓️ Saison</button><button data-k="points">${I.points} Points (total)</button></div>
    </div>
    <p class="small">On gagne des points et des rubis en participant aux tournois, en gagnant des matchs et grâce aux events des admins.</p>
    <a href="#/pantheon" class="pantheon-link">🏛️ <span><b>Panthéon de Wuhu</b><small>Les champions de chaque compétition</small></span> →</a>
    <div id="lb"></div>`;
  draw('season');
  app.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    app.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    draw(by[b.dataset.k]);
  }));
}

// ---------- Réactions sur les matchs ----------
const REACTS = ['🔥', '😂', '😱', '👏'];
let reactCache = { tid: null, rows: [] };
async function loadReactions(tid, fresh) {
  if (fresh || reactCache.tid !== tid) reactCache = { tid, rows: (await safe(() => api.listReactions?.(tid))) || [] };
  return reactCache.rows;
}
// Petite pastille sur chaque match de l'arbre : la réaction la plus utilisée + le total
async function markReactions(tid) {
  const rows = await loadReactions(tid, true);
  document.querySelectorAll('#real-bracket .match[data-mid]').forEach(el => {
    el.querySelector('.mreact')?.remove();
    const mine = rows.filter(r => r.match_id === el.dataset.mid);
    if (!mine.length) return;
    const top = REACTS.map(e => [e, mine.filter(r => r.emoji === e).length]).sort((a, b) => b[1] - a[1])[0][0];
    el.insertAdjacentHTML('beforeend', `<span class="mreact">${top} ${mine.length}</span>`);
  });
}
async function drawReactions(el, t, mid, people) {
  if (!el) return;
  const me = state.me.id;
  const rows = (await loadReactions(t.id)).filter(r => r.match_id === mid);
  el.innerHTML = `<small>Ta réaction</small><div class="rx">${REACTS.map(e => {
    const by = rows.filter(r => r.emoji === e);
    const names = by.map(r => people.get(r.user_id)?.username).filter(Boolean).join(', ');
    return `<button class="rxb ${by.some(r => r.user_id === me) ? 'on' : ''}" data-rx="${e}" title="${esc(names)}"><span>${e}</span>${by.length ? `<b>${by.length}</b>` : ''}</button>`;
  }).join('')}</div>`;
  el.querySelectorAll('[data-rx]').forEach(b => b.addEventListener('click', () => safe(async () => {
    const e = b.dataset.rx, on = !b.classList.contains('on');
    b.classList.add('pop');
    await api.react(t.id, mid, me, e, on);
    const rs = reactCache.rows.filter(r => !(r.match_id === mid && r.user_id === me && r.emoji === e));
    if (on) rs.push({ match_id: mid, user_id: me, emoji: e });
    reactCache.rows = rs;
    if (on) floatEmoji(b, e);
    drawReactions(el, t, mid, people); markReactions(t.id);
  })));
}
function floatEmoji(el, e) {
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('span'); s.className = 'rx-float'; s.textContent = e;
    s.style.cssText = `left:${r.left + r.width / 2 + (i - 2.5) * 10}px;top:${r.top}px;--dx:${(i - 2.5) * 14}px;animation-delay:${i * .05}s`;
    document.body.appendChild(s); setTimeout(() => s.remove(), 1300);
  }
}

// ---------- Quiz Nintendo du jour ----------
async function quizCard(q) {
  const mine = await safe(() => api.myQuizAnswer(q.id, state.me.id));
  const res = mine ? await safe(() => api.quizResult(q.id)) : null;
  const L = 'ABCD';
  return `<div class="quiz-q">${esc(q.question)}</div>
    ${q.image_url ? `<img class="quiz-img" src="${esc(q.image_url)}" alt="">` : ''}
    <div class="quiz-ch ${mine ? 'answered' : ''}">${q.choices.map((c, i) => {
      const cls = mine ? (i === res?.answer ? 'good' : i === mine.choice ? 'bad' : '') : '';
      return `<button class="qc ${cls}" data-qc="${i}" ${mine ? 'disabled' : ''}><b>${L[i]}</b>${esc(c)}</button>`;
    }).join('')}</div>
    ${mine ? `<p class="quiz-res ${mine.correct ? 'ok' : 'ko'}">${mine.correct ? `🎉 Bonne réponse ! +${q.reward} ${I.rubis}` : '😅 Raté ! Retente ta chance demain.'}
      ${res?.total ? `<small>${res.good} sur ${res.total} ont trouvé (${Math.round(100 * res.good / res.total)} %)</small>` : ''}</p>
      ${res?.explanation ? `<p class="quiz-why">💡 ${esc(res.explanation)}</p>` : ''}`
      : `<p class="small">Une seule réponse possible : réfléchis bien ! Bonne réponse = ${rubis(q.reward)}</p>`}`;
}
async function drawQuiz(slotSel = '#quiz-slot') {
  const slot = $(slotSel); if (!slot || !api.quizByDay) return;
  const q = await safe(() => api.quizByDay(parisDay()));
  if (!q) { slot.innerHTML = ''; return; }
  const body = await quizCard(q);
  // Sur l'accueil, la carte peut être repliée (repliée d'office une fois la question répondue)
  const home = slotSel === '#quiz-slot', key = 'wuhu-quizfold-' + q.id;
  const answered = /class="quiz-res (ok|ko)"/.exec(body);
  let saved = null; try { saved = localStorage.getItem(key); } catch {}
  const folded = home && (saved ? saved === '1' : !!answered);
  const summary = answered ? (answered[1] === 'ok' ? `✅ Bonne réponse aujourd'hui ! +${q.reward} ${I.rubis}` : '😅 Raté aujourd\'hui… retente demain !')
    : `❓ Une nouvelle question t'attend · ${rubis(q.reward)}`;
  slot.innerHTML = `<section class="card quiz-card ${folded ? 'folded' : ''}"><div class="quiz-head"><h2>🧠 Quiz du jour</h2>
    <span class="quiz-tools"><a href="#/quiz" class="small">Classement →</a>${home ? `<button type="button" class="quiz-fold" aria-expanded="${!folded}" title="${folded ? 'Afficher' : 'Masquer'} la question">${folded ? 'Afficher ▾' : 'Masquer ▴'}</button>` : ''}</span></div>
    ${home ? `<button type="button" class="quiz-sum">${summary}</button>` : ''}
    <div id="quiz-body">${body}</div></section>`;
  const card = $('.quiz-card', slot);
  const setFold = f => {
    card.classList.toggle('folded', f);
    const t = $('.quiz-fold', card); if (t) { t.textContent = f ? 'Afficher ▾' : 'Masquer ▴'; t.setAttribute('aria-expanded', String(!f)); }
    try { localStorage.setItem(key, f ? '1' : '0'); } catch {}
  };
  $('.quiz-fold', card)?.addEventListener('click', () => setFold(!card.classList.contains('folded')));
  $('.quiz-sum', card)?.addEventListener('click', () => setFold(false));
  slot.querySelectorAll('[data-qc]').forEach(b => b.addEventListener('click', () => safe(async () => {
    slot.querySelectorAll('[data-qc]').forEach(x => (x.disabled = true));
    const r = await api.quizAnswer(q.id, Number(b.dataset.qc));
    if (r.correct) { burst(b); toast(`Bonne réponse ! +${r.reward} rubis`); await loadBalances(); renderNav(); }
    else toast('Raté !', 'err');
    drawQuiz(slotSel);
  })));
}
async function pageQuiz() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const me = state.me;
  const [board, members] = await Promise.all([safe(() => api.quizBoard()), safe(() => api.listMembers())]);
  const people = new Map((members || []).map(m => [m.id, m]));
  const month = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  app.innerHTML = `
    <div class="page-head"><h1>🧠 Quiz du jour</h1></div>
    <div id="quiz-page-slot"></div>
    <section>
      <h2>Classement de ${esc(month)}</h2>
      <div class="lb-table">${(board || []).filter(r => people.has(r.user_id)).map((r, i) => `
        <a href="#/profil/${esc(r.user_id)}" class="lb-row ${r.user_id === me.id ? 'me-row' : ''}">
          <span class="lb-rank">${[I.medal1, I.medal2, I.medal3][i] || i + 1}</span>${avatar(people.get(r.user_id), 'av sm')}
          <span class="lb-name">${uname(people.get(r.user_id))}</span><b>${r.good} ✓</b><small class="muted">/ ${r.played}</small>
        </a>`).join('') || '<p class="empty">Personne n\'a encore joué ce mois-ci.</p>'}</div>
    </section>
    ${me.is_admin ? '<p class="small muted admin-hint">⚙️ Pour gérer les questions : <a href="#/parametres/quiz">Paramètres → Quiz</a></p>' : ''}`;
  await drawQuiz('#quiz-page-slot');
  if (!$('#quiz-page-slot').innerHTML) $('#quiz-page-slot').innerHTML = '<p class="empty">Pas de question aujourd\'hui. Reviens demain !</p>';
}
async function drawQuizAdmin() {
  const box = $('#quiz-admin'); if (!box) return;
  const list = (await safe(() => api.quizList())) || [];
  const today = parisDay();
  const next = (() => { const used = new Set(list.map(q => q.day)); let d = new Date(); for (;;) { const s = parisDay(d); if (!used.has(s)) return s; d = new Date(+d + 864e5); } })();
  const keyRow = q => (Array.isArray(q.key) ? q.key[0] : q.key) || {};
  const keyOf = q => keyRow(q).answer;
  const upcoming = list.filter(q => q.day && q.day >= today).sort((a, b) => a.day.localeCompare(b.day));
  const past = list.filter(q => q.day && q.day < today);
  const bank = list.filter(q => !q.day);
  const row = q => `<div class="qa-row ${q.day === today ? 'today' : ''}">
      <span class="qa-day">${!q.day ? '🎮 Banque' : q.day === today ? 'Aujourd\'hui' : new Date(q.day + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      <span class="qa-q">${q.image_url ? '🖼️ ' : ''}${esc(q.question)}<small>✓ ${esc(q.choices[keyOf(q)] ?? '?')}${q.day ? ` · ${q.reward} rubis` : ''}${keyRow(q).explanation ? ' · 💡' : ''}</small></span>
      ${!q.day || q.day >= today ? `<button class="btn ghost sm" data-qedit="${esc(q.id)}">Modifier</button>` : ''}
      <button class="btn danger sm" data-qdel="${esc(q.id)}">✕</button></div>`;
  box.innerHTML = `
    <div class="page-head"><h2>Gérer les questions <span class="admin-label">Admin</span></h2><button class="btn primary sm" id="q-add">+ Nouvelle question</button></div>
    <p class="small">Une question par jour. Les membres ne voient une question que le jour J, et la bonne réponse reste secrète.
    ${upcoming.length ? `Questions prévues jusqu'au <b>${esc(new Date(upcoming.at(-1).day + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }))}</b>.` : '<b>Aucune question prévue : pense à en ajouter !</b>'}</p>
    <div class="qa-list">${upcoming.map(row).join('')}</div>
    <h3 class="qa-bank-h">🎮 Banque du Quiz Battle <small class="muted">(${bank.length + past.length} question${bank.length + past.length > 1 ? 's' : ''} jouable${bank.length + past.length > 1 ? 's' : ''})</small></h3>
    <p class="small">Le Quiz Battle sur Discord (<b>/quizbattle</b>) pioche dans les questions de la banque (sans date) et dans les questions du jour déjà passées.</p>
    <div class="qa-list">${bank.map(row).join('') || '<p class="empty">Aucune question dans la banque pour l\'instant.</p>'}</div>
    ${past.length ? `<details class="qa-past"><summary>Questions passées (${past.length})</summary><div class="qa-list">${past.map(row).join('')}</div></details>` : ''}`;
  const form = q => {
    const ch = q?.choices || ['', '', '', ''];
    const ans = q ? keyOf(q) : 0;
    let img = q?.image_url || '';
    const isBank = q ? !q.day : false;
    const f = openModal(`
      <h2>${q ? 'Modifier la question' : 'Nouvelle question'}</h2>
      <div class="form qf">
      <div class="qf-type">
        <label class="qf-opt"><input type="radio" name="qf-type" value="day" ${isBank ? '' : 'checked'}> 📅 Question du jour</label>
        <label class="qf-opt"><input type="radio" name="qf-type" value="bank" ${isBank ? 'checked' : ''}> 🎮 Banque du Quiz Battle</label>
      </div>
      <label id="qf-day-l">Jour<input type="date" id="qf-day" value="${esc(q?.day || next)}" min="${today}"></label>
      <label>Question<textarea id="qf-q" rows="2" maxlength="300" placeholder="Ex : Quel est le premier jeu où apparaît Wario ?">${esc(q?.question || '')}</textarea></label>
      <p class="small">Réponses (2 à 4) : coche la bonne.</p>
      ${[0, 1, 2, 3].map(i => `<div class="qf-ch"><input type="radio" name="qf-ok" value="${i}" ${i === ans ? 'checked' : ''}><input type="text" id="qf-c${i}" maxlength="120" placeholder="Réponse ${'ABCD'[i]}${i > 1 ? ' (facultatif)' : ''}" value="${esc(ch[i] || '')}"></div>`).join('')}
      <label>Explication de la bonne réponse <small class="muted">(facultatif, affichée après la réponse)</small><textarea id="qf-x" rows="2" maxlength="500" placeholder="Ex : Wario apparaît pour la première fois dans Super Mario Land 2 (1992).">${esc(keyRow(q || {}).explanation || '')}</textarea></label>
      <div class="qf-img">
        <span class="small">Image <span class="muted">(facultatif, visible aussi sur Discord)</span></span>
        <div class="qf-img-row"><div id="qf-prev" class="qf-prev">${img ? `<img src="${esc(img)}" alt="">` : '🖼️'}</div>
          <label class="btn ghost sm">📷 Choisir une image<input type="file" id="qf-file" accept="image/*" hidden></label>
          <button type="button" class="btn ghost sm" id="qf-noimg" ${img ? '' : 'hidden'}>Retirer</button></div>
      </div>
      <label id="qf-r-l">Rubis pour une bonne réponse<input type="number" id="qf-r" min="0" max="500" value="${q?.reward ?? 10}"></label>
      </div>
      <div class="actions"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="qf-save">Enregistrer</button></div>`);
    const bankMode = () => f.querySelector('[name=qf-type]:checked')?.value === 'bank';
    const syncType = () => { $('#qf-day-l', f).hidden = bankMode(); $('#qf-r-l', f).hidden = bankMode(); };
    f.querySelectorAll('[name=qf-type]').forEach(r => r.addEventListener('change', syncType)); syncType();
    $('#qf-file', f).addEventListener('change', e => safe(async () => {
      const file = e.target.files?.[0]; if (!file) return;
      $('#qf-prev', f).innerHTML = '<span class="small">Envoi…</span>';
      const blob = await shrinkPhoto(file);
      img = await api.uploadImage(new File([blob], 'quiz.jpg', { type: 'image/jpeg' }), 'quiz');
      $('#qf-prev', f).innerHTML = `<img src="${esc(img)}" alt="">`; $('#qf-noimg', f).hidden = false;
    }));
    $('#qf-noimg', f).addEventListener('click', () => { img = ''; $('#qf-prev', f).innerHTML = '🖼️'; $('#qf-noimg', f).hidden = true; });
    $('#qf-save', f).addEventListener('click', () => safe(async () => {
      const raw = [0, 1, 2, 3].map(i => $('#qf-c' + i, f).value.trim());
      const okIdx = Number(f.querySelector('[name=qf-ok]:checked')?.value ?? 0);
      if (!raw[okIdx]) return toast('La bonne réponse cochée est vide', 'err');
      const keep = raw.map((c, i) => [c, i]).filter(([c]) => c);
      if (keep.length < 2) return toast('Il faut au moins 2 réponses', 'err');
      const question = $('#qf-q', f).value.trim();
      if (question.length < 3) return toast('Écris la question', 'err');
      if (!bankMode() && !$('#qf-day', f).value) return toast('Choisis le jour', 'err');
      await api.quizSave({ id: q?.id, day: bankMode() ? null : $('#qf-day', f).value, question, choices: keep.map(([c]) => c),
        answer: keep.findIndex(([, i]) => i === okIdx), reward: bankMode() ? 0 : Number($('#qf-r', f).value) || 0,
        image_url: img || null, explanation: $('#qf-x', f).value.trim() });
      closeModal(); toast('Question enregistrée'); drawQuizAdmin(); drawQuiz('#quiz-page-slot');
    }));
  };
  $('#q-add', box).addEventListener('click', () => form(null));
  box.querySelectorAll('[data-qedit]').forEach(b => b.addEventListener('click', () => form(list.find(q => q.id === b.dataset.qedit))));
  box.querySelectorAll('[data-qdel]').forEach(b => b.addEventListener('click', () => safe(async () => {
    if (!confirm('Supprimer cette question (et les réponses déjà données) ?')) return;
    await api.quizDelete(b.dataset.qdel); toast('Question supprimée'); drawQuizAdmin();
  })));
}

// ---------- Photos des events ----------
// Réduit une photo avant l'envoi (max 1600 px, JPEG) : rapide sur mobile et léger à stocker
async function shrinkPhoto(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(img.src);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', .82));
}
async function showPhotos(body, c, people) {
  body.innerHTML = '<div class="loading">Chargement…</div>';
  const me = state.me;
  const list = (await safe(() => api.listPhotos(c.id))) || [];
  const who = id => people.get(id) || { id, username: '?' };
  const likes = p => (p.likes || []).length, liked = p => (p.likes || []).some(l => l.user_id === me.id);
  const top = [...list].filter(p => likes(p) > 0).sort((a, b) => likes(b) - likes(a)).slice(0, 3);
  const tile = (p, big) => `<button class="ph ${big ? 'big' : ''}" data-ph="${esc(p.id)}">
      <img src="${esc(p.url)}" alt="${esc(p.caption || 'Photo')}" loading="lazy">
      <span class="ph-meta">${avatarImg(who(p.user_id), 'av xs')}<span class="ph-like ${liked(p) ? 'on' : ''}">❤️ ${likes(p)}</span></span>
      ${big ? `<span class="ph-cap">${esc(p.caption || '')}</span>` : ''}
    </button>`;
  body.innerHTML = `
    <section>
      <div class="page-head"><h2>📸 Photos de l'event</h2>
        <label class="btn primary sm ph-add">+ Ajouter des photos<input type="file" accept="image/*" multiple id="ph-file" hidden></label></div>
      <p class="small">Partage tes photos de ${esc(c.name)} ! Mets un ❤️ à tes préférées : les plus aimées deviennent les moments forts.</p>
      <div id="ph-progress"></div>
      ${top.length ? `<h3 class="ph-h">⭐ Les moments forts</h3><div class="ph-top">${top.map((p, i) => `<div class="ph-rank r${i + 1}">${tile(p, true)}<b>${['🥇', '🥈', '🥉'][i]}</b></div>`).join('')}</div>` : ''}
      ${list.length ? `<h3 class="ph-h">Toutes les photos <small class="muted">${list.length}</small></h3>` : ''}
      <div class="ph-grid">${list.map(p => tile(p)).join('') || '<p class="empty">Aucune photo pour l\'instant : sois le premier à en partager une !</p>'}</div>
    </section>`;
  $('#ph-file', body).addEventListener('change', e => safe(async () => {
    const files = [...e.target.files].filter(f => f.type.startsWith('image/')).slice(0, 20);
    if (!files.length) return;
    const caption = files.length === 1 ? (prompt('Une petite légende ? (facultatif)') || '').slice(0, 200) : '';
    const prog = $('#ph-progress', body);
    for (let i = 0; i < files.length; i++) {
      prog.innerHTML = `<div class="ph-up">⏳ Envoi de la photo ${i + 1} / ${files.length}…</div>`;
      await api.addPhoto(c.id, me.id, await shrinkPhoto(files[i]), caption);
    }
    toast(files.length > 1 ? `${files.length} photos ajoutées !` : 'Photo ajoutée !');
    showPhotos(body, c, people);
  }));
  body.querySelectorAll('[data-ph]').forEach(b => b.addEventListener('click', () => {
    const p = list.find(x => x.id === b.dataset.ph);
    const box = openModal(`
      <div class="ph-view"><img src="${esc(p.url)}" alt=""></div>
      ${p.caption ? `<p class="ph-vcap">${esc(p.caption)}</p>` : ''}
      <div class="ph-vbar">
        <a href="#/profil/${esc(p.user_id)}" class="ph-by">${avatarImg(who(p.user_id), 'av sm')} ${uname(who(p.user_id))}</a>
        <button class="btn ${liked(p) ? 'primary' : 'ghost'} sm" id="ph-like">❤️ ${likes(p)}</button>
        ${p.user_id === me.id || me.is_admin ? '<button class="btn danger sm" id="ph-del">Supprimer</button>' : ''}
        <button class="btn ghost sm" data-close>Fermer</button>
      </div>`, 'ph-modal');
    $('#ph-like', box).addEventListener('click', () => safe(async () => {
      await api.likePhoto(p.id, me.id, !liked(p)); closeModal(); showPhotos(body, c, people);
    }));
    $('#ph-del', box)?.addEventListener('click', () => safe(async () => {
      if (!confirm('Supprimer cette photo ?')) return;
      await api.deletePhoto(p); closeModal(); toast('Photo supprimée'); showPhotos(body, c, people);
    }));
  }));
}

// ---------- Tirage au sort en direct ----------
// L'admin lance : le placement est tiré, enregistré, puis tout le monde (sur la page du tournoi
// ou en mode soirée) voit les boules sortir de la machine une par une.
const seenDraws = new Set();
function maybePlayDraw(t, people) {
  const at = t.bracket?.draw?.at;
  if (!at || Date.now() - at > 3 * 60e3 || seenDraws.has(t.id + at)) return;
  seenDraws.add(t.id + at);
  playDraw(t, people);
}
function playDraw(t, people) {
  const first = t.bracket.matches.filter(m => m.b === 'W' && m.r === 1);
  const order = first.flatMap(m => m.slots.map(s => s.p || null));
  const balls = order.filter(Boolean);
  const who = id => people.get(id) || { id, username: '?' };
  const box = openModal(`
    <div class="draw">
      <div class="draw-head"><small>🎰 Tirage au sort en direct</small><h2>${esc(t.name)}</h2></div>
      <div class="drum"><div class="drum-in">${balls.map((id, i) => `<span class="ball" data-id="${esc(id)}" style="--i:${i};--x:${(i * 37) % 70 + 8}%;--y:${(i * 53) % 60 + 12}%">${avatarImg(who(id), 'av sm')}</span>`).join('')}</div><div class="drum-chute"></div></div>
      <div class="draw-out" id="draw-out"></div>
      <div class="draw-pairs">${first.map((m, i) => `<div class="dpair" data-k="${i}"><span class="dp" data-s="0">?</span><b>VS</b><span class="dp" data-s="1">?</span></div>`).join('')}</div>
      <div class="actions center"><button class="btn ghost sm" id="draw-skip">Passer ⏭</button></div>
    </div>`, 'draw-modal');
  let k = 0, stop = false;
  const pairs = box.querySelectorAll('.dpair');
  const fill = (i, quick) => {
    const id = order[i], pair = pairs[Math.floor(i / 2)], slot = pair.querySelectorAll('.dp')[i % 2];
    slot.innerHTML = id ? `${avatarImg(who(id), 'av xs')} ${uname(who(id))}` : '<i class="muted">Exempt</i>';
    slot.classList.add('in');
    if (i % 2 === 1) pair.classList.add('done');
    if (id) box.querySelector(`.ball[data-id="${CSS.escape(id)}"]`)?.classList.add('gone');
    if (!quick && id) {
      const out = $('#draw-out', box);
      out.innerHTML = `<div class="draw-pick">${avatarImg(who(id), 'av lg')}<strong>${esc(who(id).username)}</strong></div>`;
    }
    if (!quick) pair.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const step = () => {
    if (stop || !document.body.contains(box)) return;
    if (k >= order.length) return finish();
    fill(k, false); k++;
    setTimeout(step, order[k - 1] ? 1300 : 300);
  };
  const finish = () => {
    stop = true;
    for (; k < order.length; k++) fill(k, true);
    $('#draw-out', box).innerHTML = '<div class="draw-done">🏁 Le tirage est terminé, que les matchs commencent !</div>';
    box.querySelector('.drum').classList.add('empty');
    confetti();
    const b = $('#draw-skip', box); b.textContent = 'Voir l\'arbre'; b.onclick = () => closeModal();
  };
  $('#draw-skip', box).addEventListener('click', finish, { once: true });
  setTimeout(step, 1600);
}
// pluie de confettis plein écran
function confetti(n = 80) {
  const layer = document.createElement('div'); layer.className = 'confetti';
  layer.innerHTML = Array.from({ length: n }, (_, i) => `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * .8).toFixed(2)}s;--t:${(2 + Math.random() * 1.5).toFixed(2)}s;--h:${Math.floor(Math.random() * 360)};--r:${Math.floor(Math.random() * 360)}deg"></i>`).join('');
  document.body.appendChild(layer); setTimeout(() => layer.remove(), 4200);
}

// ---------- Mode soirée Wuhu Contest ----------
// Bandeau d'accueil : compétition en cours, ou qui commence dans moins de 24 h
function partyBanner(comps) {
  const now = Date.now();
  const c = comps.find(x => compStatus(x) === 'running') || comps.find(x => x.starts_at && +new Date(x.starts_at) > now && +new Date(x.starts_at) - now < 864e5);
  if (!c) return '';
  const live = compStatus(c) === 'running';
  return `<a href="#/soiree/${esc(c.id)}" class="party-banner ${live ? 'live' : ''}">
    <span class="pb-ic">${live ? '<span class="live-dot"></span>' : '🎉'}</span>
    <span class="pb-tx"><b>${live ? 'EN DIRECT' : 'C\'est bientôt'} · ${esc(c.name)}</b><small>${live ? 'Les matchs, les résultats et le classement en direct' : `Début ${esc(fmtDate(c.starts_at))}`}</small></span>
    <span class="pb-go">Mode soirée →</span></a>`;
}
let partyTimers = [];
async function pageParty(cid) {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [c, members] = await Promise.all([safe(() => api.getCompetition(cid)), safe(() => api.listMembers())]);
  if (!c) { app.innerHTML = '<p class="empty">Compétition introuvable.</p>'; return; }
  const people = new Map((members || []).map(m => [m.id, m]));
  const who = id => people.get(id) || { id, username: '?' };
  let prevDone = null;
  const feed = [];
  partyTimers.forEach(clearInterval); partyTimers = [];
  const stage = partyStage(id => people.get(id));
  const seenDuels = new Set();

  const draw = async () => {
    if (!location.hash.startsWith('#/soiree/')) return;
    const tours = (await safe(() => api.tournamentsOf(cid))) || [];
    const ledger = await safe(() => api.ledgerForTournaments(tours.map(t => t.id))) || [];
    const tot = new Map(); ledger.forEach(l => tot.set(l.user_id, (tot.get(l.user_id) || 0) + (l.points || 0)));
    const rank = [...tot].filter(([u]) => people.has(u)).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const live = [], doneNow = new Map();
    tours.forEach(t => {
      if (!t.bracket) return;
      maybePlayDraw(t, withTeams(t.bracket, people));
      const st = resolveBracket(t.bracket).state;
      t.bracket.matches.forEach(m => {
        const s = st[m.id];
        if (s.playable && !s.done && t.status === 'running') live.push({ t, m, s });
        if (s.playable && s.done) doneNow.set(t.id + m.id, { t, m, s });
      });
    });
    // nouveaux résultats depuis l'ouverture de la page : on fête ça
    let fresh = [];
    if (prevDone) {
      fresh = [...doneNow].filter(([k]) => !prevDone.has(k)).map(([, v]) => v);
      if (fresh.length) { feed.unshift(...fresh); confetti(60); }
    } else feed.push(...[...doneNow.values()].slice(-6).reverse());
    // les petits habitants : inscrits à la soirée + joueurs des tournois
    const expand = (t, id) => teamOf(t, id)?.members || [id];
    const [regs, parts] = await Promise.all([safe(() => api.compMembers(cid)),
      Promise.all(tours.map(t => safe(() => api.listParticipants(t.id))))]);
    const ids = new Set([...(regs || []).map(r => r.user_id), ...(parts || []).flat().filter(Boolean).map(p => p.user_id)]);
    // les défis en cours entre membres : ils se bagarrent aussi sur l'île
    const duelsNow = ((await safe(() => api.liveDuels?.())) || []).filter(d => people.has(d.challenger) && people.has(d.opponent));
    const duelWins = duelsNow.filter(d => d.status === 'done' && d.winner && !seenDuels.has(d.id));
    duelsNow.forEach(d => { if (d.status === 'done') seenDuels.add(d.id); });
    stage.update({
      ids: [...ids].filter(id => people.has(id)),
      fights: [...live.map(x => ({ title: x.t.name, sides: x.s.players.filter(Boolean).map(id => expand(x.t, id)) })),
        ...duelsNow.filter(d => d.status !== 'done').map(d => ({ title: `Défi${d.game ? ' · ' + d.game : ''}`, sides: [[d.challenger], [d.opponent]] }))],
      winners: [...fresh.flatMap(x => expand(x.t, x.s.winner)), ...(prevDone ? duelWins.map(d => d.winner) : [])].filter(Boolean),
    });
    prevDone = doneNow;
    const start = c.starts_at ? new Date(c.starts_at) : null;
    const before = start && start > new Date();
    const running = tours.some(t => t.status === 'running');
    const finished = tours.length && tours.every(t => t.status === 'done');
    const line = x => {
      const [a, b] = x.s.players, sc = x.s.result?.s;
      const who = id => teamOf(x.t, id) ? teamPerson(id, teamOf(x.t, id), m => people.get(m)) : people.get(id) || { id, username: '?' };
      if (x.s.players.length === 4) return `<div class="pm ${x.s.done ? 'done' : 'live'}">
        <span class="pm-t">${esc(x.t.name)} · ${esc(roundTitle(x.t.bracket, x.m.b, x.m.r))}</span>
        <div class="pm4">${(x.s.ranking || x.s.players.filter(Boolean)).map((id, k) => `<span class="pm-p ${x.s.ranking && k < 2 ? 'win' : ''}">${x.s.ranking ? `<b>${PLACE[k]}</b>` : ''}${avatarImg(who(id), 'av sm')}${uname(who(id))}</span>`).join('')}</div></div>`;
      return `<div class="pm ${x.s.done ? 'done' : 'live'}">
        <span class="pm-t">${esc(x.t.name)} · ${esc(roundTitle(x.t.bracket, x.m.b, x.m.r))}</span>
        <div class="pm-row">
          <span class="pm-p ${x.s.done && x.s.winner === a ? 'win' : ''}">${avatarImg(who(a), 'av sm')}${uname(who(a))}</span>
          <b class="pm-sc">${sc ? `${esc(sc[0])} – ${esc(sc[1])}` : x.s.done ? '✓' : 'VS'}</b>
          <span class="pm-p r ${x.s.done && x.s.winner === b ? 'win' : ''}">${uname(who(b))}${avatarImg(who(b), 'av sm')}</span>
        </div></div>`;
    };
    const el = $('#party'); if (!el) return;
    el.innerHTML = `
      <div class="party-top">
        <a href="#/competition/${esc(c.id)}" class="party-back">←</a>
        ${state.me.is_admin ? '<button type="button" class="party-back party-imgs" id="party-imgs" title="Mes images de soirée">🖼️</button><button type="button" class="party-back party-imgs" id="party-place" title="Placer les images">✋</button>' : ''}
        <div><small>${running ? '<span class="live-dot"></span> EN DIRECT' : finished ? '🏁 TERMINÉ' : '🎉 SOIRÉE'}</small><h1>${esc(c.name)}</h1></div>
        <div class="party-clock" id="party-clock"></div>
      </div>
      ${before && !running ? `<div class="party-count"><small>Début dans</small><div id="countdown" data-at="${start.getTime()}"></div></div>` : ''}
      <div id="stage-slot"></div>
      <div class="party-grid">
        <section class="pbox"><h2>⚔️ Matchs en cours <span class="pill-info">${live.length}</span></h2>
          ${live.map(line).join('') || `<p class="pempty">${finished ? 'Tous les matchs sont joués !' : 'Aucun match en cours pour l\'instant.'}</p>`}</section>
        <section class="pbox"><h2>📣 Derniers résultats</h2>
          ${feed.slice(0, 8).map(line).join('') || '<p class="pempty">Les résultats arriveront ici en direct.</p>'}</section>
        <section class="pbox"><h2>🏆 Classement de la soirée</h2>
          ${rank.map(([u, n], i) => `<div class="prank r${i + 1}"><span>${['🥇', '🥈', '🥉'][i] || i + 1}</span>${avatarImg(who(u), 'av sm')}<b>${uname(who(u))}</b><em>${n} pts</em></div>`).join('') || '<p class="pempty">Pas encore de points.</p>'}</section>
      </div>`;
    $('#stage-slot')?.appendChild(stage.el); stage.measure();
    $('#party-imgs')?.addEventListener('click', () => partyImagesDialog(c, drawDeco));
    $('#party-place')?.addEventListener('click', () => partyPlaceMode(c, drawDeco));
    tick();
  };
  const drawDeco = () => {
    const box = $('#party-deco'); if (!box) return;
    box.innerHTML = (c.party_images || []).slice(0, PARTY_MAX).map((im, i) => {
      const [x, y] = partyPos(im, i), size = { s: 70, m: 110, l: 160, xl: 230 }[im.size] || 110;
      return `<span class="pd" data-i="${i}" style="left:${x}%;top:${y}%;width:${size}px"><img src="${esc(im.url)}" alt="" draggable="false" style="animation-duration:${(2.2 + (i % 3) * .5).toFixed(1)}s;animation-delay:${(i * .35).toFixed(2)}s"></span>`;
    }).join('');
  };
  const tick = () => {
    const ck = $('#party-clock'); if (ck) ck.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const cd = $('#countdown'); if (cd) {
      let s = Math.max(0, Math.floor((+cd.dataset.at - Date.now()) / 1000));
      const d = Math.floor(s / 86400); s %= 86400;
      const p = n => String(n).padStart(2, '0');
      cd.innerHTML = `${d ? `<span><b>${d}</b>j</span>` : ''}<span><b>${p(Math.floor(s / 3600))}</b>h</span><span><b>${p(Math.floor(s % 3600 / 60))}</b>min</span><span><b>${p(s % 60)}</b>s</span>`;
    }
  };
  app.innerHTML = `<div class="party party-wrap"><div class="party-deco" id="party-deco"></div><div id="party"></div></div>`;
  drawDeco();
  await draw();
  // mises à jour en direct (+ filet de sécurité toutes les 20 s)
  const tours = (await safe(() => api.tournamentsOf(cid))) || [];
  let tm;
  const subs = tours.map(t => api.subscribe(t.id, () => { clearTimeout(tm); tm = setTimeout(draw, 500); }));
  unsubscribe = () => { subs.forEach(f => f && f()); partyTimers.forEach(clearInterval); partyTimers = []; stage.stop(); };
  partyTimers.push(setInterval(tick, 1000), setInterval(draw, 20000));
}

// ---------- La scène du mode soirée : les inscrits se baladent sur l'île ----------
// Chaque membre est un petit perso (avatar + pseudo) qui marche au hasard. Quand il a un match en cours,
// il file à l'arène retrouver son adversaire et ils s'affrontent ; le gagnant d'un match qui vient de finir saute de joie.
function partyStage(getP) {
  const el = document.createElement('section');
  el.className = 'pstage';
  el.innerHTML = `<div class="pstage-head"><b>🏝️ Sur l'île ce soir</b><span id="ps-count"></span></div>
    <div class="pstage-field"><div class="pstage-sea"></div><div class="pstage-arenas"></div><div class="pstage-folk"></div></div>`;
  const field = $('.pstage-field', el), folk = $('.pstage-folk', el), arenas = $('.pstage-arenas', el);
  const W = new Map(); // id → walker
  let fights = [], raf = 0, last = 0, size = { w: 600, h: 220 }, stopped = false;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  // un point au hasard sur l'herbe de l'île (ellipse au centre de la scène)
  const spot = () => {
    const a = rnd(0, Math.PI * 2), r = Math.sqrt(Math.random()) * .9;
    return { x: size.w * (.5 + Math.cos(a) * .38 * r), y: Math.max(58, Math.min(size.h - 18, size.h * (.64 + Math.sin(a) * .24 * r))) };
  };
  const measure = () => { const r = field.getBoundingClientRect(); if (r.width) size = { w: r.width, h: r.height }; };
  function add(id) {
    const p = getP(id); if (!p) return;
    const d = document.createElement('div');
    d.className = 'walker';
    d.innerHTML = `<span class="wk-fx"></span><span class="wk-body">${avatarImg(p, 'av')}</span><span class="wk-name">${esc(p.username)}</span>`;
    folk.appendChild(d);
    const s = spot();
    W.set(id, { id, el: d, x: s.x, y: s.y, tx: s.x, ty: s.y, wait: rnd(0, 2), speed: rnd(28, 52), dir: 1, mode: 'walk' });
  }
  function update({ ids, fights: f, winners }) {
    measure();
    const want = new Set([...ids.slice(0, 40), ...f.flatMap(x => x.sides.flat())].filter(id => getP(id)));
    for (const id of want) if (!W.has(id)) add(id);
    for (const [id, w] of W) if (!want.has(id)) { w.el.remove(); W.delete(id); }
    el.hidden = !want.size;
    // arènes : une par match en cours, autant que la largeur le permet ; un joueur n'est que dans une arène à la fois
    const maxA = Math.max(1, Math.floor(size.w / 130));
    const taken = new Set();
    fights = [];
    for (const x of f) {
      if (fights.length >= maxA) break;
      const sides = x.sides.map(team => team.filter(id => W.has(id) && !taken.has(id))).filter(t => t.length);
      if (sides.length < 2) continue;
      sides.flat().forEach(id => taken.add(id));
      fights.push({ ...x, sides });
    }
    const n = fights.length;
    $('#ps-count', el).textContent = `${want.size} inscrit${want.size > 1 ? 's' : ''}${n ? ` · ⚔️ ${n} bagarre${n > 1 ? 's' : ''} en cours` : ''}`;
    arenas.innerHTML = fights.map((x, k) => `<div class="arena" style="left:${((k + .5) / n) * 100}%"><span class="arena-ring"></span>
      <span class="brawl"><i></i><i></i><i></i><i></i><i></i><b>💥</b><b>⭐</b><b>👊</b><b>💫</b></span><small>${x.sides.map(team => team.map(id => esc(getP(id)?.username || '?')).join(' & ')).join(' ⚔️ ')}<em>${esc(x.title)}</em></small></div>`).join('');
    const fighting = new Map();
    fights.forEach((x, k) => {
      const sides = x.sides;
      sides.forEach((team, si) => team.forEach((id, mi) => {
        const ang = sides.length === 2 ? (si ? 0 : Math.PI) : Math.PI + (si / sides.length) * Math.PI * 2;
        // position relative à l'arène (recalculée à chaque image : la scène peut changer de taille)
        fighting.set(id, { cf: (k + .5) / n, n, ax: Math.cos(ang), ay: Math.sin(ang), mi, face: Math.cos(ang) > .1 ? -1 : 1 });
      }));
    });
    for (const [id, w] of W) {
      const fz = fighting.get(id);
      if (fz) { w.mode = 'fight'; w.fz = fz; w.face = fz.face; }
      else if (w.mode === 'fight') { w.mode = 'walk'; w.wait = 0; }
      w.el.classList.toggle('fighting', !!fz);
    }
    for (const id of winners || []) {
      const w = W.get(id); if (!w) continue;
      w.el.classList.add('cheer'); w.cheerUntil = performance.now() + 6000;
    }
  }
  function tick(t) {
    if (stopped) return;
    const dt = Math.min(.05, (t - (last || t)) / 1000); last = t;
    if (!document.hidden && el.isConnected) {
      if (Math.random() < .02) measure();
      for (const w of W.values()) {
        if (w.cheerUntil && t > w.cheerUntil) { w.el.classList.remove('cheer'); w.cheerUntil = 0; }
        if (w.mode === 'fight' && w.fz) {
          // la bagarre : les joueurs tournent l'un autour de l'autre dans le nuage, en se rentrant dedans
          const z = w.fz, s = t / 1000, ph = Math.atan2(z.ay, z.ax) + s * 3.2 + z.mi;
          const r = 14 + 9 * Math.sin(s * 7 + z.mi * 2);
          w.tx = z.cf * size.w + Math.cos(ph) * r * 1.4; w.ty = size.h * .55 + 18 + Math.sin(ph) * r * .55;
        }
        const dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
        let moving = false;
        if (dist > 2) {
          const sp = (w.mode === 'fight' ? 260 : w.speed) * dt;
          w.x += dx / dist * Math.min(sp, dist); w.y += dy / dist * Math.min(sp, dist);
          if (Math.abs(dx) > 1) w.dir = dx > 0 ? 1 : -1;
          moving = true;
        } else if (w.mode === 'fight') {
          w.dir = Math.sin(t / 180 + w.fz.mi) > 0 ? 1 : -1;
        } else if ((w.wait -= dt) <= 0) {
          const s = spot(); w.tx = s.x; w.ty = s.y; w.wait = rnd(1.5, 5);
        }
        w.el.classList.toggle('moving', moving);
        w.el.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`;
        w.el.style.zIndex = Math.round(w.y);
        w.el.style.setProperty('--dir', w.dir);
      }
    }
    raf = requestAnimationFrame(tick);
  }
  if (calm) { el.classList.add('calm'); } 
  raf = requestAnimationFrame(tick);
  return { el, update, measure, stop() { stopped = true; cancelAnimationFrame(raf); } };
}

// Images perso du mode soirée : elles « respirent » (grossissent / rétrécissent) sur les bords de l'écran
// position = centre de l'image, en % de l'écran (x, y) ; sans position choisie, on prend une place par défaut
const PARTY_MAX = 12;
const PARTY_SPOTS = [[5, 14], [95, 14], [5, 88], [95, 88], [4, 50], [96, 50], [40, 95], [55, 4], [25, 6], [75, 95], [70, 6], [28, 94]];
const partyPos = (im, i) => (Number.isFinite(im.x) && Number.isFinite(im.y)) ? [im.x, im.y] : PARTY_SPOTS[i % PARTY_SPOTS.length];

// Mode « placer » : on glisse les images où on veut sur l'écran, puis on enregistre
function partyPlaceMode(c, redraw) {
  const wrap = $('.party-wrap'), box = $('#party-deco');
  if (!wrap || !box || wrap.classList.contains('placing')) return;
  if (!(c.party_images || []).length) { toast('Ajoute d\'abord des images avec 🖼️'); return; }
  const orig = c.party_images;
  const list = c.party_images.map((im, i) => { const [x, y] = partyPos(im, i); return { ...im, x, y }; });
  wrap.classList.add('placing');
  const bar = document.createElement('div');
  bar.className = 'pd-bar';
  bar.innerHTML = `<span>✋ Glisse tes images où tu veux · <small>touche une image puis ➕ / ➖ pour sa taille</small></span>
    <span class="pd-sz"><button type="button" class="btn ghost sm" data-sz="-1">➖</button><button type="button" class="btn ghost sm" data-sz="1">➕</button></span>
    <button type="button" class="btn ghost sm" id="pd-cancel">Annuler</button><button type="button" class="btn primary sm" id="pd-save">Enregistrer</button>`;
  document.body.appendChild(bar);
  const SZ = ['s', 'm', 'l', 'xl'];
  let sel = 0;
  const paint = () => {
    c.party_images = list; redraw();
    box.querySelectorAll('.pd').forEach(el => el.classList.toggle('sel', +el.dataset.i === sel));
  };
  paint();
  let drag = null;
  const down = e => {
    const el = e.target.closest('.pd'); if (!el) return;
    e.preventDefault(); sel = +el.dataset.i; drag = el;
    box.querySelectorAll('.pd').forEach(x => x.classList.toggle('sel', x === el));
    el.setPointerCapture?.(e.pointerId);
  };
  const move = e => {
    if (!drag) return;
    const r = box.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100));
    const y = Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100));
    const im = list[+drag.dataset.i]; im.x = Math.round(x * 10) / 10; im.y = Math.round(y * 10) / 10;
    drag.style.left = im.x + '%'; drag.style.top = im.y + '%';
  };
  const up = () => { drag = null; };
  box.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  bar.querySelectorAll('[data-sz]').forEach(b => b.addEventListener('click', () => {
    const im = list[sel]; if (!im) return;
    const k = Math.min(SZ.length - 1, Math.max(0, SZ.indexOf(im.size || 'm') + +b.dataset.sz));
    im.size = SZ[k]; paint();
  }));
  const stop = () => {
    wrap.classList.remove('placing'); bar.remove();
    box.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  $('#pd-cancel', bar).addEventListener('click', () => {
    stop(); c.party_images = orig; redraw();
  });
  $('#pd-save', bar).addEventListener('click', () => safe(async () => {
    await api.updateCompetition(c.id, { party_images: list });
    stop(); c.party_images = list; redraw(); toast('Emplacements enregistrés 🎉');
  }));
}
function partyImagesDialog(c, redraw) {
  let list = [...(c.party_images || [])];
  const box = openModal(`<h2>🖼️ Images de la soirée</h2>
    <p class="small">Ajoute tes propres images (logo, mascotte, stickers…) : elles s'affichent autour de l'écran du mode soirée et grossissent / rétrécissent en rythme. 12 images maximum. Les PNG avec fond transparent et les GIF animés rendent le mieux. Ensuite, utilise ✋ pour les placer où tu veux.</p>
    <div class="pi-list" id="pi-list"></div>
    <label class="btn ghost sm pi-add">📷 Ajouter une image<input type="file" id="pi-file" accept="image/*" hidden></label>
    <div class="actions"><button type="button" class="btn ghost" data-close>Fermer</button><button type="button" class="btn primary" id="pi-save">Enregistrer</button></div>`);
  const render = () => {
    $('#pi-list', box).innerHTML = list.map((im, i) => `<div class="pi-row">
      <img src="${esc(im.url)}" alt="">
      <select data-size="${i}">${[['s', 'Petite'], ['m', 'Moyenne'], ['l', 'Grande'], ['xl', 'Très grande']].map(([v, l]) => `<option value="${v}" ${(im.size || 'm') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="btn danger sm" data-del="${i}">✕</button></div>`).join('') || '<p class="empty">Aucune image pour l\'instant.</p>';
    box.querySelectorAll('[data-size]').forEach(sel => sel.addEventListener('change', () => { list[+sel.dataset.size].size = sel.value; }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { list.splice(+b.dataset.del, 1); render(); }));
    $('.pi-add', box).style.display = list.length >= PARTY_MAX ? 'none' : '';
  };
  render();
  $('#pi-file', box).addEventListener('change', e => safe(async () => {
    const file = e.target.files?.[0]; if (!file) return;
    const png = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
    // les PNG/GIF/WebP gardent leur transparence ; les photos sont allégées
    if (file.type === 'image/gif' && file.size >= 6e6) { toast('GIF trop lourd (6 Mo max)'); return; }
    // un GIF n'est jamais recompressé, sinon il perdrait son animation
    const up = file.type === 'image/gif' || (png && file.size < 3e6) ? file : new File([await shrinkPhoto(file)], 'soiree.jpg', { type: 'image/jpeg' });
    const url = await api.uploadImage(up, 'soiree');
    list.push({ url, size: 'm' }); render(); e.target.value = '';
  }));
  $('#pi-save', box).addEventListener('click', () => safe(async () => {
    await api.updateCompetition(c.id, { party_images: list });
    c.party_images = list; closeModal(); toast('Images enregistrées'); redraw();
  }));
}

// ---------- Carte de l'île ----------
const MAP_SPOTS = [
  { x: 48, y: 14, ic: '🏛️', label: 'Le Panthéon', sub: 'Les champions', href: '#/pantheon' },
  { x: 56, y: 27, ic: '🌋', label: 'Le Volcan', sub: 'Classement', href: '#/classement' },
  { x: 69, y: 37, ic: '🏟️', label: 'Le Stade', sub: 'Tournois', href: '#/tournois' },
  { x: 25, y: 54, ic: '🏘️', label: 'Le Village', sub: 'Habitants', href: '#/membres' },
  { x: 43, y: 72, ic: '⛵', label: 'Le Port', sub: 'Mes succès', href: '#/succes' },
  { x: 80, y: 57, ic: '🏴‍☠️', label: 'La Plage', sub: 'Coffre au trésor', href: '#/boutique' },
];
// endroits sur la terre ferme où les habitants se promènent (en %)
const MAP_LAND = [[28, 34], [42, 41], [23, 45], [54, 41], [60, 47], [74, 57], [86, 70], [80, 86], [13, 41], [36, 27], [49, 32], [64, 34], [86, 57], [89, 81], [30, 60], [45, 52], [70, 49], [22, 25], [40, 47], [82, 74]];
function islandMap() {
  return `<section class="island-sec">
    <h2>🏝️ L'île Wuhu <small class="muted" id="online-count"></small></h2>
    <div class="island-map" id="island-map">
      <img src="ile-carte.svg" alt="Carte de l'île Wuhu" draggable="false">
      <div class="isl-people" id="isl-people"></div>
      ${MAP_SPOTS.map(p => `<a href="${p.href}" class="spot" style="left:${p.x}%;top:${p.y}%"><span class="spot-ic">${p.ic}</span><span class="spot-lb"><b>${p.label}</b><small>${p.sub}</small></span></a>`).join('')}
    </div>
  </section>`;
}
let walkTimer = null;
async function drawIslanders() {
  const box = $('#isl-people'); if (!box) return;
  const ids = [...(state.online || new Set([state.me.id]))];
  if (!state.people || ids.some(id => !state.people.has(id))) {
    state.people = new Map(((await safe(() => api.listMembers())) || []).map(p => [p.id, p]));
    if (!$('#isl-people')) return;
  }
  const people = ids.map(id => state.people.get(id)).filter(Boolean).slice(0, 30);
  const c = $('#online-count'); if (c) c.textContent = `· ${people.length} habitant${people.length > 1 ? 's' : ''} sur l'île en ce moment`;
  const pick = () => MAP_LAND[Math.floor(Math.random() * MAP_LAND.length)];
  const have = new Set([...box.children].map(e => e.dataset.id));
  people.forEach((p, i) => {
    if (have.has(p.id)) return;
    const [x, y] = MAP_LAND[(i * 7) % MAP_LAND.length];
    box.insertAdjacentHTML('beforeend', `<a href="#/profil/${esc(p.id)}" class="isl-mii ${p.id === state.me.id ? 'me' : ''}" data-id="${esc(p.id)}" style="left:${x}%;top:${y}%;--d:${(i % 5) * .3}s" title="${esc(p.username)}">${avatarImg(p, 'av sm')}<span>${esc(p.username)}</span></a>`);
  });
  [...box.children].forEach(e => { if (!people.some(p => p.id === e.dataset.id)) e.remove(); });
  clearInterval(walkTimer);
  walkTimer = setInterval(() => {
    const b = $('#isl-people'); if (!b) return clearInterval(walkTimer);
    [...b.children].forEach(e => { if (Math.random() < .5) { const [x, y] = pick(); e.style.left = x + (Math.random() * 4 - 2) + '%'; e.style.top = y + (Math.random() * 4 - 2) + '%'; } });
  }, 4500);
}

// ---------- Panthéon : un champion par compétition terminée ----------
async function pagePantheon() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [comps0, members] = await Promise.all([safe(() => api.listCompetitions()), safe(() => api.listMembers())]);
  const done = (comps0 || []).filter(c => compStatus(c) === 'done' && (c.tournaments || []).length)
    .sort((a, b) => (b.starts_at || b.created_at || '').localeCompare(a.starts_at || a.created_at || ''));
  const people = new Map((members || []).map(m => [m.id, m]));
  const who = id => people.get(id) || { id, username: '?' };
  const ledger = await safe(() => api.ledgerForTournaments(done.flatMap(c => c.tournaments.map(t => t.id)))) || [];
  const halls = done.map(c => {
    const ids = new Set(c.tournaments.map(t => t.id)), tot = new Map();
    ledger.filter(l => ids.has(l.tournament_id)).forEach(l => tot.set(l.user_id, (tot.get(l.user_id) || 0) + (l.points || 0)));
    const titles = uid => c.tournaments.filter(t => winnersOf(t).includes(uid)).length;
    const rank = [...tot].sort((a, b) => b[1] - a[1] || titles(b[0]) - titles(a[0])).slice(0, 3);
    return { c, rank, titles };
  }).filter(h => h.rank.length);
  const date = c => (c.starts_at || c.created_at) ? new Date(c.starts_at || c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  app.innerHTML = `
    <div class="pantheon-head">
      <div class="ph-cols" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <h1>🏛️ Panthéon de Wuhu</h1>
      <p>Les grands champions de chaque compétition, gravés dans le marbre pour toujours.</p>
    </div>
    ${halls.map(({ c, rank, titles }) => {
      const [first, ...rest] = rank, p = who(first[0]);
      return `<section class="hall">
        <div class="statue-wrap">
          <a href="#/profil/${esc(p.id)}" class="statue">
            <div class="st-glow"></div>
            <div class="st-av">${avatarImg(p, 'av xl')}</div>
            <div class="st-pedestal">
              <span class="st-crown">👑</span>
              <strong class="st-name">${esc(p.username)}</strong>
              <span class="st-comp">Champion · ${esc(c.name)}</span>
              <span class="st-meta">${pts(first[1])} · ${titles(first[0])} titre${titles(first[0]) > 1 ? 's' : ''} ${I.trophee}</span>
            </div>
          </a>
        </div>
        <div class="hall-info">
          <h2><a href="#/competition/${esc(c.id)}">${esc(c.name)}</a></h2>
          <p class="small">${esc(date(c))} · ${c.tournaments.length} tournoi${c.tournaments.length > 1 ? 's' : ''}</p>
          ${rest.length ? `<div class="hall-podium">${rest.map(([uid, n], i) => `<a href="#/profil/${esc(uid)}" class="hp">${[I.medal2, I.medal3][i]} ${avatar(who(uid), 'av sm')} <span>${uname(who(uid))}</span> ${pts(n)}</a>`).join('')}</div>` : ''}
          <div class="hall-tours">${c.tournaments.filter(t => winnersOf(t).length).map(t => `<a href="#/tournoi/${esc(t.id)}" class="trophy">${I.trophee} ${esc(t.name)} : <b>${esc(t.winner_team ? teamOf(t, t.winner_team)?.name || '?' : who(t.winner_id).username)}</b></a>`).join('')}</div>
        </div>
      </section>`;
    }).join('') || '<p class="empty">Aucune compétition terminée pour l\'instant : la première statue t\'attend peut-être !</p>'}`;
}

// ---------- Récompense du jour ----------
const DAILY = [20, 20, 30, 30, 40, 40, 100];
const parisDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
async function drawDaily() {
  const slot = $('#daily-slot'); if (!slot) return;
  const me = state.me;
  const [d, ach, done, st] = await Promise.all([safe(() => api.getDaily(me.id)), safe(() => api.listAchievements()), safe(() => api.achievementsDone(me.id)), safe(() => api.myStats())]);
  if (!$('#daily-slot')) return;
  const today = parisDay(), yesterday = parisDay(new Date(Date.now() - 864e5));
  const claimed = d?.last_claim === today;
  // jour de la semaine où l'on en est (la série continue si on est venu hier)
  const streak = claimed ? d.streak : d?.last_claim === yesterday ? d.streak + 1 : 1;
  const pos = (streak - 1) % 7;
  const ready = achReady(ach || [], new Set((done || []).map(x => x.achievement_id)), st || {});
  slot.innerHTML = `<section class="daily card ${claimed ? 'claimed' : 'ready'}">
    <div class="daily-head">
      <div><h2>🎁 Récompense du jour</h2><p class="small">${claimed ? `Série de <b>${streak} jour${streak > 1 ? 's' : ''}</b> 🔥 Reviens demain pour la suite !` : streak > 1 ? `Série de ${streak - 1} jour${streak > 2 ? 's' : ''} en cours : ne la casse pas !` : 'Connecte-toi chaque jour : les gains grimpent jusqu\'au 7ᵉ jour.'}</p></div>
      ${claimed ? '<span class="pill-info">✓ Récupérée</span>' : `<button class="btn primary" id="daily-claim">Récupérer ${rubis(DAILY[pos])}</button>`}
    </div>
    <div class="daily-week">${DAILY.map((r, i) => `<div class="dday ${i < pos || (claimed && i === pos) ? 'got' : i === pos ? 'now' : ''} ${i === 6 ? 'big' : ''}">
      <small>Jour ${i + 1}</small><span class="${i === 6 ? 'dr-big' : ''}">${I.rubis}${i === 6 ? I.rubis : ''}</span><b>${r}</b></div>`).join('')}</div>
    ${ready.length ? `<a href="#/succes" class="ach-ready">🏅 ${ready.length} succès à récupérer ! <span>Voir →</span></a>` : ''}
  </section>`;
  $('#daily-claim', slot)?.addEventListener('click', e => safe(async () => {
    e.target.disabled = true;
    const r = await api.claimDaily();
    toast(`+${r.amount} rubis ! Jour ${r.streak} 🔥`);
    burst(e.target);
    await loadBalances(); renderNav(); drawDaily(); refreshAchCount();
    const hm = $('.hero-money'); if (hm) hm.innerHTML = `${rubis(bal(me.id).rubis)} ${pts(bal(me.id).points)}`;
  }));
}
// petite explosion de rubis autour d'un bouton
function burst(el) {
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span'); s.className = 'burst'; s.innerHTML = I.rubis;
    const a = (i / 14) * Math.PI * 2, d = 60 + (i % 3) * 25;
    s.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px`;
    document.body.appendChild(s); setTimeout(() => s.remove(), 900);
  }
}

// =====================================================================
//  Blind test : extraits lus depuis YouTube (rien n'est hébergé sur le site)
// =====================================================================
let ytApi = null;
function ytReady() {
  if (window.YT?.Player) return Promise.resolve();
  ytApi ??= new Promise(res => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
  return ytApi;
}
// Accepte un lien YouTube (watch, youtu.be, shorts, music) ou directement l'identifiant de 11 caractères
function ytId(v) {
  v = String(v || '').trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  const m = v.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const parseTime = v => { v = String(v || '0').trim(); if (v.includes(':')) { const [m, s] = v.split(':').map(Number); return (m || 0) * 60 + (s || 0); } return Number(v) || 0; };

// Le « lecteur » : la vidéo est cachée derrière un vinyle jusqu'à la réponse
function btStage(box, track, { onState } = {}) {
  box.innerHTML = `<div class="bt-stage">
      <div class="bt-video"><div id="bt-yt-${track.id}"></div></div>
      <div class="bt-cover"><div class="bt-vinyl"><span>🎵</span></div><small class="bt-hint">Appuie sur ▶️ pour écouter l'extrait</small></div>
    </div>
    <div class="bt-controls"><button class="btn primary bt-play">▶️ Écouter l'extrait (${track.duration_s} s)</button>
      <div class="bt-bar"><i></i></div></div>`;
  const stage = $('.bt-stage', box), bar = $('.bt-bar i', box), btn = $('.bt-play', box);
  let player = null, ready = false, timer = 0, t0 = 0, broken = false;
  const stop = () => { clearInterval(timer); timer = 0; stage.classList.remove('playing'); try { player?.pauseVideo(); } catch {} btn.disabled = broken; btn.textContent = '🔁 Réécouter'; };
  const play = () => {
    if (!ready || broken) return;
    try { player.seekTo(track.start_s, true); player.unMute(); player.setVolume(90); player.playVideo(); } catch {}
    stage.classList.add('playing'); btn.disabled = true; btn.textContent = '🎧 Écoute…';
    t0 = performance.now(); clearInterval(timer);
    timer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (track.duration_s * 1000));
      bar.style.width = (k * 100) + '%';
      if (k >= 1) stop();
    }, 100);
    onState?.('play');
  };
  btn.disabled = true; btn.textContent = '⏳ Chargement…';
  ytReady().then(() => {
    player = new YT.Player(`bt-yt-${track.id}`, {
      host: 'https://www.youtube-nocookie.com', videoId: track.youtube_id, width: '100%', height: '100%',
      playerVars: { start: track.start_s, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3 },
      events: {
        onReady: () => { ready = true; btn.disabled = false; btn.textContent = `▶️ Écouter l'extrait (${track.duration_s} s)`; },
        onError: e => {
          broken = true; btn.disabled = true; btn.textContent = '⚠️ Extrait indisponible';
          $('.bt-hint', box).textContent = [101, 150].includes(e.data) ? 'Cette vidéo ne peut pas être lue en dehors de YouTube.' : 'La vidéo est introuvable ou privée.';
          onState?.('error', e.data);
        },
      },
    });
  });
  btn.addEventListener('click', play);
  return {
    reveal() { stop(); stage.classList.add('revealed'); },
    destroy() { clearInterval(timer); try { player?.destroy(); } catch {} },
    play,
  };
}
const BT_LETTERS = ['A', 'B', 'C', 'D'];
function btChoices(track, { picked = null, answer = null } = {}) {
  return `<div class="quiz-ch bt-choices ${answer != null ? 'answered' : ''}">${track.choices.map((c, i) => {
    const cls = answer == null ? '' : i === answer ? 'good' : i === picked ? 'bad' : '';
    return `<button class="qc ${cls}" data-bt="${i}" ${answer != null ? 'disabled' : ''}><b>${BT_LETTERS[i]}</b>${esc(c)}</button>`;
  }).join('')}</div>`;
}
let btCurrent = null;
async function pageBlindtest() {
  btCurrent?.destroy(); btCurrent = null;
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const day = parisDay();
  const today = await safe(() => api.btToday(day));
  app.innerHTML = `
    <div class="page-head"><h1>🎵 Blind test</h1></div>
    <p class="small">Écoute l'extrait, trouve de quel jeu vient la musique ! Les extraits sont lus depuis YouTube : monte le son 🔊</p>
    <section class="card bt-card" id="bt-day"></section>
    <section class="card bt-card bt-multi-card" id="bt-multi">${btMultiCard()}</section>
    ${state.me.is_admin ? '<p class="small muted admin-hint">⚙️ Pour gérer les musiques : <a href="#/parametres/blindtest">Paramètres → Blind test</a></p>' : ''}`;
  await drawBtDay(today);
  bindBtMulti($('#bt-multi'));
}
async function drawBtDay(t) {
  const box = $('#bt-day'); if (!box) return;
  if (!t) { box.innerHTML = '<div class="quiz-head"><h2>🎧 Blind test du jour</h2></div><p class="empty">Pas de blind test aujourd\'hui. Reviens demain !</p>'; return; }
  const res = await safe(() => api.btResult(t.id));
  box.innerHTML = `<div class="quiz-head"><h2>🎧 Blind test du jour</h2><span class="small">${res ? '' : `Bonne réponse : ${rubis(t.reward)} ${pts(t.reward)}`}</span></div>
    <div id="bt-day-stage"></div><p class="bt-q">De quel jeu vient cette musique ?</p><div id="bt-day-ch"></div><div id="bt-day-res"></div>`;
  btCurrent?.destroy();
  btCurrent = btStage($('#bt-day-stage', box), t);
  const showRes = r => {
    $('#bt-day-ch', box).innerHTML = btChoices(t, { picked: r.choice, answer: r.answer });
    $('#bt-day-res', box).innerHTML = `<p class="quiz-res ${r.correct ? 'ok' : 'ko'}">${r.correct ? `🎉 Bien joué ! +${r.reward} ${I.rubis} +${r.reward} ${I.points}` : '😅 Raté ! Retente ta chance demain.'}
      ${r.total ? `<small>${r.good} sur ${r.total} ont trouvé</small>` : ''}</p>
      ${r.title ? `<p class="bt-title">🎶 ${esc(r.title)}</p>` : ''}${r.explanation ? `<p class="quiz-why">💡 ${esc(r.explanation)}</p>` : ''}`;
    btCurrent.reveal();
  };
  if (res) return showRes(res);
  $('#bt-day-ch', box).innerHTML = btChoices(t);
  box.querySelectorAll('[data-bt]').forEach(b => b.addEventListener('click', () => safe(async () => {
    box.querySelectorAll('[data-bt]').forEach(x => (x.disabled = true));
    const r = await api.btAnswer(t.id, Number(b.dataset.bt));
    if (r.correct) { burst(b); toast(`Bonne réponse ! +${r.reward} rubis`); await loadBalances(); renderNav(); } else toast('Raté !', 'err');
    showRes({ ...r, choice: Number(b.dataset.bt) });
  })));
}
async function btSeries() {
  const pool = (await safe(() => api.btPool(parisDay()))) || [];
  if (pool.length < 5) return toast('Pas encore assez de musiques pour une série (il en faut 5)', 'err');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const list = pool.slice(0, 10), run = crypto.randomUUID();
  let k = 0, score = 0;
  const box = $('#bt-series');
  const round = () => {
    const t = list[k];
    box.innerHTML = `<div class="quiz-head"><h2>🔥 Série · ${k + 1} / ${list.length}</h2><b class="bt-score">${score} ✓</b></div>
      <div id="bt-s-stage"></div><p class="bt-q">De quel jeu vient cette musique ?</p><div id="bt-s-ch">${btChoices(t)}</div><div id="bt-s-res"></div>`;
    btCurrent?.destroy();
    btCurrent = btStage($('#bt-s-stage', box), t, { onState: s => { if (s === 'error') $('#bt-s-res', box).innerHTML = '<button class="btn ghost" id="bt-skip">Passer cette musique →</button>'; $('#bt-skip')?.addEventListener('click', next); } });
    box.querySelectorAll('[data-bt]').forEach(b => b.addEventListener('click', () => safe(async () => {
      box.querySelectorAll('[data-bt]').forEach(x => (x.disabled = true));
      const r = await api.btCheck(run, t.id, Number(b.dataset.bt));
      if (r.correct) { score++; burst(b); }
      $('#bt-s-ch', box).innerHTML = btChoices(t, { picked: Number(b.dataset.bt), answer: r.answer });
      $('.bt-score', box).textContent = `${score} ✓`;
      $('#bt-s-res', box).innerHTML = `<p class="quiz-res ${r.correct ? 'ok' : 'ko'}">${r.correct ? '🎉 Bonne réponse !' : '😅 Raté !'}</p>
        ${r.title ? `<p class="bt-title">🎶 ${esc(r.title)}</p>` : ''}
        <button class="btn primary" id="bt-next">${k + 1 < list.length ? 'Musique suivante →' : 'Voir mon score 🏁'}</button>`;
      btCurrent.reveal();
      $('#bt-next', box).addEventListener('click', next);
    })));
  };
  const next = () => safe(async () => {
    k++;
    if (k < list.length) return round();
    btCurrent?.destroy(); btCurrent = null;
    const f = await api.btFinish(run);
    if (f?.record) confetti(70);
    box.innerHTML = `<div class="quiz-head"><h2>🏁 Série terminée !</h2></div>
      <div class="bt-final"><b>${f?.score ?? score}</b><span>/ ${f?.total ?? list.length}</span></div>
      <p>${f?.record ? `🏆 <b>Nouveau record !</b>${f.previous != null ? ` (avant : ${f.previous})` : ''}` : 'Pas de record cette fois… retente ta chance !'}</p>
      <button class="btn primary" id="bt-again">🔁 Rejouer</button> <button class="btn ghost" id="bt-back">Retour</button>`;
    $('#bt-again', box).addEventListener('click', () => btSeries());
    $('#bt-back', box).addEventListener('click', () => pageBlindtest());
  });
  round();
}
async function drawBtAdmin() {
  const box = $('#bt-admin'); if (!box) return;
  const list = (await safe(() => api.btList())) || [];
  const today = parisDay();
  const keyOf = t => (Array.isArray(t.key) ? t.key[0] : t.key) || {};
  const next = (() => { const used = new Set(list.map(t => t.day)); let d = new Date(); for (;;) { const s = parisDay(d); if (!used.has(s)) return s; d = new Date(+d + 864e5); } })();
  const upcoming = list.filter(t => t.day && t.day >= today), bank = list.filter(t => !t.day), past = list.filter(t => t.day && t.day < today);
  const row = t => `<div class="qa-row ${t.day === today ? 'today' : ''}">
      <span class="qa-day">${!t.day ? '🎮 Banque' : t.day === today ? 'Aujourd\'hui' : new Date(t.day + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
      <span class="qa-q">🎵 ${esc(keyOf(t).title || t.choices[keyOf(t).answer] || '?')}<small>✓ ${esc(t.choices[keyOf(t).answer] ?? '?')} · ${mmss(t.start_s)} (${t.duration_s} s)</small></span>
      <button class="btn ghost sm" data-btplay="${esc(t.id)}">▶️ Écouter</button><button class="btn ghost sm" data-btedit="${esc(t.id)}">Modifier</button><button class="btn danger sm" data-btdel="${esc(t.id)}">✕</button></div>`;
  box.innerHTML = `
    <div class="page-head"><h2>Gérer le blind test <span class="admin-label">Admin</span></h2><button class="btn primary sm" id="bt-add">+ Nouvelle musique</button></div>
    <p class="small">Colle le lien YouTube d'une musique de jeu vidéo, choisis le début de l'extrait et les réponses. Teste toujours l'extrait : certaines vidéos refusent d'être lues ailleurs que sur YouTube.</p>
    <h3 class="qa-bank-h">📅 Blind tests du jour</h3>
    <div class="qa-list">${upcoming.map(row).join('') || '<p class="empty">Aucun blind test prévu.</p>'}</div>
    <h3 class="qa-bank-h">🎮 Banque du multijoueur <small class="muted">(${list.length} musique${list.length > 1 ? 's' : ''} en jeu, blind tests du jour compris)</small></h3>
    <div class="qa-list">${bank.map(row).join('') || '<p class="empty">La banque est vide : il faut au moins 5 musiques pour le multijoueur.</p>'}</div>
    ${past.length ? `<details class="qa-past"><summary>Blind tests passés (${past.length})</summary><div class="qa-list">${past.map(row).join('')}</div></details>` : ''}`;
  const form = t => {
    const k = t ? keyOf(t) : {}, ch = t?.choices || ['', '', '', ''];
    const f = openModal(`
      <h2>${t ? 'Modifier la musique' : 'Nouvelle musique'}</h2>
      <div class="form qf">
        <div class="qf-type">
          <label class="qf-opt"><input type="radio" name="bt-type" value="day" ${t && !t.day ? '' : 'checked'}> 📅 Blind test du jour</label>
          <label class="qf-opt"><input type="radio" name="bt-type" value="bank" ${t && !t.day ? 'checked' : ''}> 🎮 Banque du multijoueur</label>
        </div>
        <label id="bt-day-l">Jour<input type="date" id="bt-f-day" value="${esc(t?.day || next)}" min="${today}"></label>
        <label>Lien YouTube<input id="bt-f-yt" placeholder="https://www.youtube.com/watch?v=…" value="${t ? 'https://youtu.be/' + esc(t.youtube_id) : ''}"></label>
        <div class="bt-f-row"><label>Début de l'extrait<input id="bt-f-start" placeholder="1:05" value="${t ? mmss(t.start_s) : '0:00'}"></label>
          <label>Durée (s)<input type="number" id="bt-f-dur" min="5" max="60" value="${t?.duration_s ?? 20}"></label></div>
        <div id="bt-f-test" class="bt-f-test"></div><button type="button" class="btn ghost sm" id="bt-f-try">🎧 Tester l'extrait</button>
        <label>Titre affiché après la réponse<input id="bt-f-title" maxlength="120" placeholder="Ex : Gusty Garden Galaxy · Super Mario Galaxy" value="${esc(k.title || '')}"></label>
        <p class="small">Réponses (2 à 4) : coche la bonne.</p>
        ${[0, 1, 2, 3].map(i => `<div class="qf-ch"><input type="radio" name="bt-ok" value="${i}" ${i === (k.answer ?? 0) ? 'checked' : ''}><input type="text" id="bt-f-c${i}" maxlength="80" placeholder="Jeu ${'ABCD'[i]}${i > 1 ? ' (facultatif)' : ''}" value="${esc(ch[i] || '')}"></div>`).join('')}
        <label>Anecdote <small class="muted">(facultatif)</small><textarea id="bt-f-x" rows="2" maxlength="400">${esc(k.explanation || '')}</textarea></label>
        <label id="bt-r-l">Rubis et points pour une bonne réponse<input type="number" id="bt-f-r" min="0" max="200" value="${t?.reward ?? 15}"></label>
      </div>
      <div class="actions"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="bt-f-save">Enregistrer</button></div>`);
    const bankMode = () => f.querySelector('[name=bt-type]:checked')?.value === 'bank';
    const sync = () => { $('#bt-day-l', f).hidden = bankMode(); $('#bt-r-l', f).hidden = bankMode(); };
    f.querySelectorAll('[name=bt-type]').forEach(r => r.addEventListener('change', sync)); sync();
    let tester = null;
    $('#bt-f-try', f).addEventListener('click', () => {
      const id = ytId($('#bt-f-yt', f).value);
      if (!id) return toast('Lien YouTube invalide', 'err');
      tester?.destroy();
      tester = btStage($('#bt-f-test', f), { id: 'test' + Date.now(), youtube_id: id, start_s: parseTime($('#bt-f-start', f).value), duration_s: Math.min(60, Math.max(5, Number($('#bt-f-dur', f).value) || 20)) });
      $('#bt-f-test .bt-stage', f).classList.add('revealed');
    });
    $('#bt-f-save', f).addEventListener('click', () => safe(async () => {
      const id = ytId($('#bt-f-yt', f).value);
      if (!id) return toast('Colle un lien YouTube valide', 'err');
      const raw = [0, 1, 2, 3].map(i => $('#bt-f-c' + i, f).value.trim());
      const okIdx = Number(f.querySelector('[name=bt-ok]:checked')?.value ?? 0);
      if (!raw[okIdx]) return toast('La bonne réponse cochée est vide', 'err');
      const keep = raw.map((c, i) => [c, i]).filter(([c]) => c);
      if (keep.length < 2) return toast('Il faut au moins 2 réponses', 'err');
      if (!bankMode() && !$('#bt-f-day', f).value) return toast('Choisis le jour', 'err');
      await api.btSave({ id: t?.id, day: bankMode() ? null : $('#bt-f-day', f).value, youtube_id: id, start_s: parseTime($('#bt-f-start', f).value),
        duration_s: Math.min(60, Math.max(5, Number($('#bt-f-dur', f).value) || 20)), choices: keep.map(([c]) => c), answer: keep.findIndex(([, i]) => i === okIdx),
        title: $('#bt-f-title', f).value.trim(), explanation: $('#bt-f-x', f).value.trim(), reward: bankMode() ? 0 : Number($('#bt-f-r', f).value) || 0 });
      tester?.destroy(); closeModal(); toast('Musique enregistrée 🎵'); drawBtAdmin();
    }));
  };
  $('#bt-add', box).addEventListener('click', () => form(null));
  // écouter l'extrait tel qu'il est réglé (début + durée), vidéo visible pour vérifier
  box.querySelectorAll('[data-btplay]').forEach(b => b.addEventListener('click', () => {
    const t = list.find(x => x.id === b.dataset.btplay); if (!t) return;
    const k = keyOf(t);
    const m = openModal(`<h2>🎧 ${esc(k.title || t.choices[k.answer] || 'Extrait')}</h2>
      <p class="small">Début ${mmss(t.start_s)} · ${t.duration_s} s · réponse : <b>${esc(t.choices[k.answer] ?? '?')}</b></p>
      <div id="bt-listen"></div><div class="actions"><button type="button" class="btn ghost" data-close>Fermer</button></div>`);
    const st = btStage($('#bt-listen', m), { ...t, id: 'listen' + Date.now() });
    $('#bt-listen .bt-stage', m).classList.add('revealed');
    modal._onClose = () => st.destroy();
  }));
  box.querySelectorAll('[data-btedit]').forEach(b => b.addEventListener('click', () => form(list.find(x => x.id === b.dataset.btedit))));
  box.querySelectorAll('[data-btdel]').forEach(b => b.addEventListener('click', () => safe(async () => {
    if (!confirm('Supprimer cette musique ?')) return;
    await api.btDelete(b.dataset.btdel); toast('Supprimée'); drawBtAdmin();
  })));
}

// ---------- Blind test multijoueur : salons en temps réel ----------
// Tout le monde entend le même extrait au même moment (heure du serveur) ; le premier qui trouve marque le point.
function btMultiCard() {
  return `<div class="quiz-head"><h2>👥 Multijoueur</h2></div>
    <p>Joue avec tes amis en direct : <b>même musique au même moment</b>, le plus rapide marque le point ! <span class="muted">(2 joueurs minimum)</span></p>
    <div class="bt-multi">
      <div class="bt-mbox"><b>Créer un salon</b><span class="small muted">Nombre de musiques :</span>
        <div class="seg bt-n">${[5, 10, 15].map(n => `<button type="button" data-n="${n}" class="${n === 10 ? 'on' : ''}">${n} 🎵</button>`).join('')}</div>
        <button class="btn primary" id="bt-create">🎮 Créer un salon</button></div>
      <div class="bt-mbox"><b>Rejoindre avec un code</b>
        <div class="bt-join"><input id="bt-code" maxlength="4" placeholder="ABCD" autocomplete="off"><button class="btn primary" id="bt-join">Rejoindre</button></div></div>
    </div>`;
}
function bindBtMulti(box) {
  let n = 10;
  box.querySelectorAll('.bt-n [data-n]').forEach(b => b.addEventListener('click', () => { n = Number(b.dataset.n); box.querySelectorAll('.bt-n button').forEach(x => x.classList.toggle('on', x === b)); }));
  $('#bt-create', box).addEventListener('click', () => safe(async () => { const id = await api.btRoomCreate(n); location.hash = `#/blindtest/salon/${id}`; }));
  const join = () => safe(async () => {
    const code = $('#bt-code', box).value.trim().toUpperCase();
    if (code.length !== 4) return toast('Le code fait 4 caractères', 'err');
    const id = await api.btRoomJoin(code); location.hash = `#/blindtest/salon/${id}`;
  });
  $('#bt-join', box).addEventListener('click', join);
  $('#bt-code', box).addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
}
let btRoomPlayer = null;
async function pageBtRoom(arg) {
  app.innerHTML = `<div class="loading">Chargement du salon…</div>`;
  // lien partagé avec le code (4 lettres) : on rejoint d'abord
  let roomId = arg;
  if (/^[A-Za-z0-9]{4}$/.test(arg || '')) {
    const id = await safe(() => api.btRoomJoin(arg)); if (!id) { location.hash = '#/blindtest'; return; }
    roomId = id; history.replaceState(null, '', `#/blindtest/salon/${id}`);
  }
  const members = (await safe(() => api.listMembers())) || [];
  const people = new Map(members.map(m => [m.id, m]));
  const who = id => people.get(id) || { id, username: 'Joueur' };
  let st = null, offset = 0, ready = false, curIdx = -1, myTry = null, revealed = null, timers = [], unsub = null, gone = false;
  const clearT = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (f, ms) => timers.push(setTimeout(f, Math.max(0, ms)));
  const serverNow = () => Date.now() + offset;
  app.innerHTML = `<div class="bt-room">
      <div class="bt-room-top"><a href="#/blindtest" class="btn ghost sm">← Quitter</a><h1>🎵 Blind test · salon</h1><span class="bt-room-code" id="r-code"></span></div>
      <div class="bt-room-grid">
        <div class="card bt-room-main">
          <div class="bt-stage" id="r-stage"><div class="bt-video"><div id="r-yt"></div></div>
            <div class="bt-cover"><div class="bt-vinyl"><span>🎵</span></div><div class="bt-count" id="r-count"></div><small class="bt-hint" id="r-hint"></small></div></div>
          <div class="bt-bar"><i id="r-bar"></i></div>
          <div id="r-body"></div>
        </div>
        <aside class="card bt-room-side"><h3>👥 Joueurs</h3><div id="r-players"></div></aside>
      </div></div>`;
  const stage = $('#r-stage'), bar = $('#r-bar');
  // Le lecteur YouTube est créé au clic « Je suis prêt » : les navigateurs exigent un geste pour jouer du son
  const makePlayer = vid => new Promise(res => {
    ytReady().then(() => {
      btRoomPlayer?.destroy?.();
      btRoomPlayer = new YT.Player('r-yt', { host: 'https://www.youtube-nocookie.com', videoId: vid, width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3 },
        events: { onReady: e => { try { e.target.mute(); e.target.playVideo(); setTimeout(() => { try { e.target.pauseVideo(); e.target.unMute(); e.target.setVolume(90); } catch {} res(); }, 600); } catch { res(); } } } });
    });
  });
  const stopAudio = () => { try { btRoomPlayer?.pauseVideo(); } catch {} stage.classList.remove('playing'); };
  const load = async () => {
    const s = await safe(() => api.btRoomState(roomId));
    if (!s || gone) return;
    offset = new Date(s.now).getTime() - Date.now();
    st = s; render();
  };
  let pend = 0;
  const refresh = () => { clearTimeout(pend); pend = setTimeout(load, 120); };
  const players = () => {
    const box = $('#r-players'); if (!box) return;
    const tries = new Map((st.tries || []).map(t => [t.user_id, t]));
    box.innerHTML = st.players.map((p, i) => {
      const m = who(p.user_id), t = tries.get(p.user_id);
      return `<div class="bt-pl ${p.user_id === state.me.id ? 'me' : ''} ${st.room.round_winner === p.user_id ? 'win' : ''}">
        <span class="bt-pl-r">${st.room.status === 'lobby' ? '' : i + 1}</span>${avatar(m, 'av sm')}<span class="bt-pl-n">${uname(m)}${p.user_id === st.room.host ? ' 👑' : ''}</span>
        ${st.room.status === 'lobby' ? '' : `<b>${p.score}</b>`}${t ? `<span class="bt-pl-t">${st.room.round_winner === p.user_id ? '⚡' : t.correct ? '✅' : '❌'}</span>` : ''}</div>`;
    }).join('');
  };
  const render = () => {
    const r = st.room, body = $('#r-body');
    $('#r-code').innerHTML = `Code <b>${esc(r.code)}</b>`;
    players();
    if (r.status === 'closed') { body.innerHTML = '<p class="empty">Ce salon est fermé.</p><a class="btn primary" href="#/blindtest">Retour</a>'; return; }
    if (r.status === 'lobby') {
      const link = `${location.origin}${location.pathname}#/blindtest/salon/${r.code}`;
      const host = r.host === state.me.id;
      $('#r-hint').textContent = 'En attente des joueurs…';
      body.innerHTML = `<div class="bt-lobby">
        <p>Partage le code <b class="bt-big">${esc(r.code)}</b> ou le lien pour inviter tes amis :</p>
        <div class="bt-link"><input readonly value="${esc(link)}"><button class="btn ghost sm" id="r-copy">📋 Copier</button></div>
        <p class="small">${r.total} musiques · 20 s par extrait · une seule réponse par musique · seul le plus rapide marque le point · 🥇 +15 ${I.rubis} 🥈 +8 🥉 +4 (3 parties récompensées par jour)</p>
        ${ready ? '<p class="bt-ready">✅ Son activé, tu es prêt !</p>' : '<button class="btn primary big" id="r-ready">🔊 Je suis prêt (activer le son)</button>'}
        ${host ? `<button class="btn primary big" id="r-start" ${st.players.length < 2 ? 'disabled' : ''}>▶️ Lancer la partie ${st.players.length < 2 ? '(il faut 2 joueurs)' : `(${st.players.length} joueurs)`}</button>` : '<p class="muted">L\'hôte 👑 lancera la partie quand tout le monde est là.</p>'}
      </div>`;
      $('#r-copy')?.addEventListener('click', () => { navigator.clipboard?.writeText(link); toast('Lien copié !'); });
      $('#r-ready')?.addEventListener('click', () => safe(async () => {
        $('#r-ready').disabled = true; $('#r-ready').textContent = '⏳ Activation…';
        const pool = await safe(() => api.btPool(parisDay()));
        await makePlayer(pool?.[0]?.youtube_id || 'M7lc1UVf-VE');
        ready = true; render();
      }));
      $('#r-start')?.addEventListener('click', () => safe(async () => { if (!ready) { toast('Active le son avec « Je suis prêt » d\'abord 🔊', 'err'); return; } await api.btRoomStart(roomId); }));
      return;
    }
    if (r.status === 'done') {
      clearT(); stopAudio(); stage.classList.add('revealed');
      const rw = new Map((r.rewards || []).map(x => [x.user_id, x]));
      body.innerHTML = `<div class="bt-end"><h2>🏁 Partie terminée !</h2>
        <div class="bt-podium">${st.players.slice(0, 3).map((p, i) => { const m = who(p.user_id), x = rw.get(p.user_id);
          return `<div class="bt-pod p${i + 1}">${[I.medal1, I.medal2, I.medal3][i]}${avatar(m, 'av lg')}<b>${uname(m)}</b><span>${p.score} pt${p.score > 1 ? 's' : ''}</span>
            ${x?.rubis ? `<small>+${x.rubis} ${I.rubis} +${x.rubis} ${I.points}</small>` : x?.capped ? '<small>limite du jour atteinte</small>' : ''}</div>`; }).join('')}</div>
        <button class="btn primary" id="r-again">🔁 Nouveau salon</button> <a class="btn ghost" href="#/blindtest">Retour</a></div>`;
      if (st.players[0]?.user_id === state.me.id) confetti(80);
      $('#r-again').addEventListener('click', () => safe(async () => { const id = await api.btRoomCreate(r.total); location.hash = `#/blindtest/salon/${id}`; }));
      loadBalances().then(renderNav);
      return;
    }
    // ----- partie en cours -----
    if (!ready) {
      body.innerHTML = `<p>La partie a commencé !</p><button class="btn primary big" id="r-ready">🔊 Activer le son et jouer</button>`;
      $('#r-ready').addEventListener('click', () => safe(async () => { await makePlayer(st.track.youtube_id); ready = true; curIdx = -1; render(); }));
      return;
    }
    const t = st.track; if (!t) return;
    if (r.idx !== curIdx) {
      // nouvelle manche : on prépare la vidéo et on programme le départ à l'heure du serveur
      curIdx = r.idx; myTry = null; revealed = null; clearT(); stopAudio();
      stage.classList.remove('revealed'); bar.style.transition = 'none'; bar.style.width = '0';
      try { btRoomPlayer.cueVideoById({ videoId: t.youtube_id, startSeconds: t.start_s }); } catch {}
      const startAt = new Date(r.round_started_at).getTime() - offset;
      const tick = () => { const s = Math.ceil((startAt - Date.now()) / 1000); $('#r-count').textContent = s > 0 ? s : ''; if (s > 0) later(tick, 200); };
      tick();
      $('#r-hint').textContent = `Musique ${r.idx + 1} / ${st.count}`;
      later(() => {
        if (gone || st.room.idx !== curIdx) return;
        try { btRoomPlayer.seekTo(t.start_s, true); btRoomPlayer.playVideo(); } catch {}
        stage.classList.add('playing');
        requestAnimationFrame(() => { bar.style.transition = `width ${t.duration_s}s linear`; bar.style.width = '100%'; });
        // bouton de secours si le navigateur a bloqué la lecture
        later(() => { try { if (btRoomPlayer.getPlayerState() !== 1 && !revealed) $('#r-hint').innerHTML = '<button class="btn ghost sm" id="r-unmute">🔊 Pas de son ? Touche ici</button>'; $('#r-unmute')?.addEventListener('click', () => { btRoomPlayer.seekTo(t.start_s, true); btRoomPlayer.playVideo(); }); } catch {} }, 1500);
        later(() => { stopAudio(); doReveal(); }, t.duration_s * 1000);
      }, startAt - Date.now());
    }
    // l'extrait est toujours joué en entier : on ne dévoile la réponse qu'une fois le temps écoulé
    if (!revealed && serverNow() >= new Date(r.round_started_at).getTime() + t.duration_s * 1000) doReveal();
    drawChoices();
  };
  const drawChoices = () => {
    const t = st.track, body = $('#r-body');
    const started = serverNow() >= new Date(st.room.round_started_at).getTime();
    const ans = revealed?.answer;
    body.innerHTML = `<p class="bt-q">De quel jeu vient cette musique ?</p>
      ${btChoices(t, ans != null ? { picked: myTry?.choice ?? null, answer: ans } : {})}
      <div class="bt-room-res">${revealed ? `${revealed.winner ? `⚡ <b>${uname(who(revealed.winner))}</b> a trouvé !` : '⏱️ Personne n\'a trouvé…'}
        ${revealed.title ? `<p class="bt-title">🎶 ${esc(revealed.title)}</p>` : ''}<small class="muted">${st.room.idx + 1 < st.count ? 'Musique suivante dans un instant…' : 'Résultats dans un instant…'}</small>`
        : myTry ? (myTry.correct ? (st.room.round_winner === state.me.id || myTry.first ? '🎉 <b>Bonne réponse, tu es le premier !</b> +1 point ⚡' : `✅ Bonne réponse… mais <b>${uname(who(st.room.round_winner))}</b> a été plus rapide !`) : '❌ Raté ! Profite de la fin de l\'extrait…')
          : st.room.round_winner ? `<small>⚡ <b>${uname(who(st.room.round_winner))}</b> a déjà trouvé… mais tu peux encore répondre !</small>` : started ? '' : '<small class="muted">Prépare-toi…</small>'}</div>`;
    if (ans == null && !myTry) body.querySelectorAll('[data-bt]').forEach(b => b.addEventListener('click', () => safe(async () => {
      if (serverNow() < new Date(st.room.round_started_at).getTime()) return toast('Attends le début de l\'extrait !', 'err');
      body.querySelectorAll('[data-bt]').forEach(x => (x.disabled = true));
      const res = await api.btRoomAnswer(roomId, st.room.idx, Number(b.dataset.bt));
      if (res?.late) { toast('Trop tard !', 'err'); return; }
      myTry = { choice: Number(b.dataset.bt), correct: res.correct, first: res.first };
      if (res.winner && !st.room.round_winner) st.room.round_winner = res.winner;
      if (res.first) burst(b);
      drawChoices();
    })));
    else body.querySelectorAll('[data-bt]').forEach(x => (x.disabled = true));
  };
  const doReveal = async () => {
    if (revealed) return;
    const idx = st.room.idx;
    const res = await safe(() => api.btRoomReveal(roomId, idx));
    if (!res || st.room.idx !== idx) return;
    revealed = res; stopAudio(); stage.classList.add('revealed');
    const w = getComputedStyle(bar).width; bar.style.transition = 'none'; bar.style.width = w;
    drawChoices(); players();
    // l'hôte passe à la suite après 5 s ; les autres prennent le relais s'il ne répond plus
    later(() => api.btRoomNext(roomId, idx).catch(() => {}), st.room.host === state.me.id ? 5000 : 9000);
  };
  unsub = api.btRoomSubscribe(roomId, refresh);
  const poll = setInterval(load, 4000); // filet de sécurité si le temps réel décroche
  unsubscribe = () => { gone = true; clearT(); clearInterval(poll); unsub?.(); stopAudio(); try { btRoomPlayer?.destroy(); } catch {} btRoomPlayer = null;
    if (st?.room?.status === 'lobby') api.btRoomLeave(roomId).catch(() => {}); };
  await load();
}

// ---------- Bienvenue sur l'île (première visite) ----------
// L'avatar du nouveau membre descend en parachute sur l'île, puis on lui offre son cadeau et on lui montre l'essentiel.
function showWelcome(gift) {
  document.querySelector('.welcome')?.remove();
  const me = state.me; if (!me) return;
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `
    <div class="wl-sky">
      <span class="wl-cloud c1"></span><span class="wl-cloud c2"></span><span class="wl-cloud c3"></span>
      <div class="wl-island"><span class="wl-palm">🌴</span><span class="wl-palm p2">🌴</span></div>
      <div class="wl-drop"><span class="wl-chute">🪂</span><span class="wl-me">${avatar(me, 'av')}</span></div>
    </div>
    <div class="wl-card">
      <h2>Bienvenue sur l'île Wuhu, ${esc(me.username)} ! 🏝️</h2>
      <p class="muted">Tu viens d'atterrir sur l'île. Voici de quoi bien commencer :</p>
      ${gift ? `<div class="wl-gifts"><div class="wl-gift">${I.rubis}<b>+${gift.rubis}</b><small>rubis offerts</small></div>
        ${gift.title ? `<div class="wl-gift"><span class="uname fx fx-vague" data-t="${esc(gift.title)}">${esc(gift.title)}</span><small>ton premier titre (à équiper sur ton profil)</small></div>` : ''}</div>` : ''}
      <div class="wl-tips">
        <a href="#/tournois" data-go>🏆<b>Tournois</b><small>Inscris-toi aux compétitions</small></a>
        <a href="#/membres" data-go>⚔️<b>Défis</b><small>Défie n'importe quel membre</small></a>
        <a href="#/quiz" data-go>🧠<b>Quiz</b><small>Une question par jour</small></a>
        <a href="#/boutique" data-go>🎁<b>Boutique</b><small>Dépense tes ${I.rubis}</small></a>
      </div>
      <p class="small">🏅 Ton premier succès <b>« Bienvenue sur l'île »</b> t'attend dans <a href="#/succes" data-go>Mes succès</a> !</p>
      <button class="btn primary wl-go">Explorer l'île →</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => confetti(90), 1500);
  const close = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 350); };
  $('.wl-go', el).addEventListener('click', close);
  el.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', close));
}

// ---------- Défis amicaux (site + /defi sur Discord) ----------
const DUEL_GAMES = ['Mario Kart 8 Deluxe', 'Super Smash Bros. Ultimate', 'Splatoon 3', 'Mario Party Jamboree', 'Wii Sports', 'Wii Sports Resort', 'Tetris 99', 'Nintendo Switch Sports', 'Ping-pong (en vrai)', 'Échecs (en vrai)'];
const DUEL_RULES = `<div class="duel-rules">
  <p>🎮 <b>En ligne</b> sur vos jeux ou 🛋️ <b>en vrai</b>, quand vous voulez, même en dehors des tournois !</p>
  <p>🎁 <b>Gagnant</b> +10 ${I.rubis} +10 🍄 · <b>perdant</b> +3 ${I.rubis} +3 🍄</p>
  <p class="small muted">3 défis récompensés par jour maximum · 1 seul par duo et par jour · rien si le match dure moins de 3 minutes.</p>
  <p class="duel-warn">⚠️ Les défis servent à <b>jouer pour de vrai</b>. Se lancer des défis en boucle sans jouer pour gagner des rubis, c'est de la triche : les admins peuvent retirer les gains et sanctionner.</p>
</div>`;
function duelDialog(p) {
  const box = openModal(`<h2>⚔️ Défier ${uname(p)}</h2>
    <div class="duel-vs">${avatar(state.me, 'av lg')}<b>VS</b>${avatar(p, 'av lg')}</div>
    <label class="form">Sur quel jeu ? <small class="muted">(facultatif)</small>
      <input id="duel-game" list="duel-games" maxlength="80" placeholder="Mario Kart, Smash, ping-pong…">
      <datalist id="duel-games">${DUEL_GAMES.map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
    ${DUEL_RULES}
    <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><button type="button" class="btn primary" id="duel-go">⚔️ Lancer le défi</button></div>`);
  $('#duel-go', box).addEventListener('click', () => safe(async () => {
    $('#duel-go', box).disabled = true;
    try { await api.createDuel(p.id, $('#duel-game', box).value.trim()); }
    finally { const b = $('#duel-go', box); if (b) b.disabled = false; }
    closeModal(); toast(`Défi envoyé à ${p.username} ⚔️`); location.hash = '#/defis';
  }));
}
// Défis qui attendent une action de ma part
const duelTodo = (d, me) => (d.status === 'pending' && d.opponent_d === me) || d.status === 'accepted' || (d.status === 'claimed' && d.claimed_by_d !== me);
async function refreshDuelCount() {
  if (!state.me?.in_guild || !api.myDuels) return;
  const r = await safe(() => api.myDuels()); if (!r) return;
  const n = (r.duels || []).filter(d => duelTodo(d, r.me)).length;
  if (n !== state.duelCount) { state.duelCount = n; renderNav(); }
}
async function pageDuels() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const [r, members] = await Promise.all([safe(() => api.myDuels()), safe(() => api.listMembers())]);
  if (!r) { app.innerHTML = '<p class="empty">Impossible de charger tes défis.</p>'; return; }
  const me = r.me, list = r.duels || [];
  const people = new Map((members || []).map(m => [m.id, m]));
  const pl = (d, x) => {
    const uid = x === d.challenger_d ? d.challenger : d.opponent;
    return people.get(uid) || { id: uid, username: d.names?.[x]?.n || 'Joueur', avatar_url: d.names?.[x]?.a || null, _noacc: !uid };
  };
  const other = d => d.challenger_d === me ? d.opponent_d : d.challenger_d;
  const nm = (d, x) => x === me ? 'Toi' : uname(pl(d, x));
  const link = (d, x) => { const q = pl(d, x); return q._noacc ? avatar(q, 'av md') : `<a href="#/profil/${esc(q.id)}">${avatar(q, 'av md')}</a>`; };
  const card = d => {
    const o = other(d), game = d.game ? `<span class="duel-game">🎮 ${esc(d.game)}</span>` : '';
    let txt = '', btns = '';
    if (d.status === 'pending') {
      if (d.opponent_d === me) { txt = `<b>${nm(d, o)}</b> te défie !`; btns = `<button class="btn primary sm" data-a="acc">✅ J'accepte</button><button class="btn danger sm" data-a="dec">Je refuse</button>`; }
      else { txt = `En attente de la réponse de <b>${nm(d, o)}</b>…`; btns = `<button class="btn ghost sm" data-a="can">Annuler</button>`; }
    } else if (d.status === 'accepted') {
      txt = `Défi accepté ! Une fois le match joué, qui a gagné ?`;
      btns = `<button class="btn primary sm" data-a="win" data-w="${esc(me)}">🏆 J'ai gagné</button><button class="btn ghost sm" data-a="win" data-w="${esc(o)}">🏆 ${nm(d, o)} a gagné</button><button class="btn ghost sm" data-a="can">Annuler</button>`;
    } else if (d.status === 'claimed') {
      if (d.claimed_by_d === me) txt = `Tu as déclaré ta victoire. <b>${nm(d, o)}</b> doit confirmer…`;
      else { txt = `<b>${nm(d, o)}</b> dit avoir gagné. Tu confirmes ?`; btns = `<button class="btn primary sm" data-a="ok">✅ Je confirme</button><button class="btn danger sm" data-a="no">Je conteste</button>`; }
    } else if (d.status === 'done') {
      const won = d.winner_d === me;
      txt = `${won ? '🏆 <b>Victoire</b>' : '😅 Défaite'} contre <b>${nm(d, o)}</b>` +
        (d.reward_w != null ? `<br><small class="muted">🎁 ${won ? `+${d.reward_w}` : `+${d.reward_l}`} ${I.rubis} ${won ? `+${d.reward_w}` : `+${d.reward_l}`} 🍄${d.reward_note ? ` · ${esc(d.reward_note)}` : ''}</small>` : '');
    } else txt = d.status === 'declined' ? `Défi refusé` : `Défi annulé`;
    return `<div class="card duel-card st-${d.status} ${duelTodo(d, me) ? 'todo' : ''}" data-id="${esc(d.id)}">
      <div class="duel-vs sm">${link(d, d.challenger_d)}<b>VS</b>${link(d, d.opponent_d)}</div>
      <div class="duel-info">${game}<p>${txt}</p>${btns ? `<div class="duel-acts">${btns}</div>` : ''}</div></div>`;
  };
  const open = list.filter(d => ['pending', 'accepted', 'claimed'].includes(d.status));
  const todo = open.filter(d => duelTodo(d, me)), wait = open.filter(d => !duelTodo(d, me));
  const past = list.filter(d => !open.includes(d)).slice(0, 15);
  app.innerHTML = `
    <div class="page-head"><h1>⚔️ Mes défis</h1><p class="muted">Défie n'importe quel membre depuis son profil, ou avec <b>/defi</b> sur Discord.</p></div>
    <details class="card duel-howto"><summary>Comment ça marche ?</summary>
      <ol><li>Va sur le profil d'un membre et clique <b>⚔️ Défier</b>.</li><li>Il accepte le défi ici (ou sur Discord).</li><li>Jouez ! Puis l'un de vous indique le gagnant et l'autre confirme.</li></ol>${DUEL_RULES}</details>
    <section><h2>À toi de jouer <span class="pill-info">${todo.length}</span></h2>
      <div class="duel-list">${todo.map(card).join('') || '<p class="empty">Rien à faire pour l\'instant. <a href="#/membres">Trouve un adversaire →</a></p>'}</div></section>
    ${wait.length ? `<section><h2>En attente</h2><div class="duel-list">${wait.map(card).join('')}</div></section>` : ''}
    ${past.length ? `<section><h2>Récemment</h2><div class="duel-list">${past.map(card).join('')}</div></section>` : ''}`;
  app.querySelectorAll('.duel-card [data-a]').forEach(b => b.addEventListener('click', () => safe(async () => {
    const id = b.closest('.duel-card').dataset.id, a = b.dataset.a;
    if (a === 'can' && !confirm('Annuler ce défi ?')) return;
    if (a === 'dec' && !confirm('Refuser ce défi ?')) return;
    b.disabled = true;
    const res = await api.duelAct(id, a, b.dataset.w);
    if (res?.status === 'done' && res.reward) {
      const rw = res.reward;
      toast(rw.win || rw.lose ? `Défi terminé ! 🎁 Gagnant +${rw.win} rubis · perdant +${rw.lose} rubis` : `Défi terminé${rw.note ? ` (${rw.note})` : ''}`);
      await loadBalances(); renderNav();
    } else toast({ accepted: a === 'no' ? 'Contesté : indiquez à nouveau le gagnant' : 'Défi accepté ! Bon match ⚔️', claimed: 'Victoire déclarée : ton adversaire doit confirmer', declined: 'Défi refusé', cancelled: 'Défi annulé' }[res?.status] || 'OK');
    refreshDuelCount(); pageDuels();
  })));
}

// ---------- Succès ----------
const achGoal = (a, st) => a.goal || (a.metric === 'collection' ? st.collection_total || 0 : 0);
const achReady = (list, done, st) => list.filter(a => !done.has(a.id) && (st[a.metric] || 0) >= achGoal(a, st));
// Pastille sur l'avatar : nombre de succès prêts à récupérer
async function refreshAchCount() {
  if (!state.me?.in_guild || !api.listAchievements) return;
  const [list, done, st] = await Promise.all([safe(() => api.listAchievements()), safe(() => api.achievementsDone(state.me.id)), safe(() => api.myStats())]);
  const n = achReady(list || [], new Set((done || []).map(x => x.achievement_id)), st || {}).length;
  if (n !== state.achCount) { state.achCount = n; renderNav(); }
  refreshDuelCount();
}
async function pageAchievements() {
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  const me = state.me;
  const [list, done0, st0] = await Promise.all([safe(() => api.listAchievements()), safe(() => api.achievementsDone(me.id)), safe(() => api.myStats())]);
  const done = new Set((done0 || []).map(x => x.achievement_id)), st = st0 || {};
  const all = list || [];
  const ready = new Set(achReady(all, done, st).map(a => a.id));
  const order = a => ready.has(a.id) ? 0 : done.has(a.id) ? 2 : 1;
  app.innerHTML = `
    <div class="page-head"><h1>Mes succès</h1><div class="big-money">🏅 ${done.size} / ${all.length}</div></div>
    <p class="small">Débloque des succès en jouant, en gagnant et en ouvrant des coffres. Chaque succès rapporte des rubis.</p>
    ${ready.size > 1 ? '<div class="actions"><button class="btn primary" id="ach-all">Tout récupérer</button></div>' : ''}
    <div class="ach-list">${[...all].sort((a, b) => order(a) - order(b) || a.position - b.position).map(a => {
      const goal = achGoal(a, st), v = Math.min(st[a.metric] || 0, goal), isDone = done.has(a.id), isReady = ready.has(a.id);
      return `<div class="ach card ${isDone ? 'done' : isReady ? 'ready' : 'locked'}">
        <div class="ach-ic">${esc(a.icon)}</div>
        <div class="ach-body"><strong>${esc(a.name)}</strong><small>${esc(a.description)}</small>
          ${isDone ? '' : `<div class="ach-bar"><i style="width:${goal ? Math.round(100 * v / goal) : 100}%"></i><span>${v} / ${goal}</span></div>`}</div>
        <div class="ach-side">${isDone ? '<span class="ach-ok">✓</span>' : isReady ? `<button class="btn primary sm" data-ach="${esc(a.id)}">+${a.reward} ${I.rubis}</button>` : `<span class="ach-rew">${rubis(a.reward)}</span>`}</div>
      </div>`;
    }).join('')}</div>`;
  const claim = async id => { const r = await api.claimAchievement(id); return r.reward; };
  app.querySelectorAll('[data-ach]').forEach(b => b.addEventListener('click', () => safe(async () => {
    b.disabled = true; const n = await claim(b.dataset.ach); burst(b); toast(`Succès débloqué ! +${n} rubis`);
    await loadBalances(); renderNav(); refreshAchCount(); setTimeout(pageAchievements, 500);
  })));
  $('#ach-all')?.addEventListener('click', e => safe(async () => {
    e.target.disabled = true; let n = 0;
    for (const id of ready) n += await claim(id);
    burst(e.target); toast(`${ready.size} succès récupérés ! +${n} rubis`);
    await loadBalances(); renderNav(); refreshAchCount(); setTimeout(pageAchievements, 500);
  }));
}

// ---------- Boutique ----------
const RARITY = { commun: ['Commun', 'r-commun'], rare: ['Rare', 'r-rare'], epique: ['Épique', 'r-epique'], legendaire: ['Légendaire', 'r-legendaire'] };
const colorRarity = price => price <= 80 ? 'commun' : price <= 140 ? 'rare' : price <= 220 ? 'epique' : 'legendaire';
const rarityTag = r => `<span class="rar ${RARITY[r]?.[1] || ''}">${RARITY[r]?.[0] || ''}</span>`;
const SHOP_TABS = [
  ['coffres', '🎁', 'Coffre'], ['pseudo', '✨', 'Pseudos'], ['frame', '🖼️', 'Cadres'],
  ['title', '🏷️', 'Titres'], ['victory', '🎉', 'Victoires'],
];
const SLOT = { frame: 'item_frame', banner: 'item_banner', title: 'item_title', victory: 'item_victory' };
const KIND_LABEL = { pseudo: 'Effet de pseudo', frame: "Cadre d'avatar", banner: 'Bannière de profil', title: 'Titre', victory: 'Effet de victoire' };

// Aperçu d'un objet, porté par le joueur p
function itemPreview(it, p) {
  switch (it.kind) {
    case 'pseudo': return `<div class="ip ip-pseudo fx-stage">${uname({ ...p, name_color: it.id })}</div>`;
    case 'frame': return `<div class="ip ip-frame">${frameWrap(it.effect, 'av lg', avatarImg(p, 'av lg'))}</div>`;
    case 'banner': return `<div class="ip ip-banner"><div class="mini-banner bn bn-${esc(it.effect)}"></div>${avatar(p, 'av md')}</div>`;
    case 'title': return `<div class="ip ip-title"><div>${uname(p)}</div><span class="wtitle">${fxName(it.name, it.effect)}</span></div>`;
    case 'victory': return `<div class="ip ip-victory">${victoryFx(it.effect, 14)}<span class="ip-win">${I.trophee} Vainqueur</span></div>`;
  }
  return '';
}
const CHEST_COL = { bois: ['#b9773f', '#7a4a22', '#e0a86a'], argent: ['#c4d2e0', '#7f93a8', '#ffffff'], or: ['#ffcf3f', '#c48a00', '#fff3b0'], wuhu: ['#ffcf3f', '#c48a00', '#fff3b0'] };
const chestSvg = (id, open = false) => {
  const [a, b, c] = CHEST_COL[id] || CHEST_COL.bois;
  return `<svg class="chest-svg ${open ? 'open' : ''}" viewBox="0 0 120 100" aria-hidden="true">
    <ellipse cx="60" cy="94" rx="44" ry="5" fill="rgba(0,0,0,.15)"/>
    <rect x="14" y="46" width="92" height="44" rx="8" fill="${a}" stroke="${b}" stroke-width="4"/>
    <rect x="14" y="58" width="92" height="6" fill="${b}" opacity=".5"/>
    <g class="lid"><path d="M14 48 Q14 16 60 16 Q106 16 106 48 Z" fill="${a}" stroke="${b}" stroke-width="4"/>
    <path d="M30 22 Q60 12 90 22" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/></g>
    <rect x="50" y="40" width="20" height="22" rx="4" fill="${c}" stroke="${b}" stroke-width="3"/>
    <circle cx="60" cy="50" r="3" fill="${b}"/>
  </svg>`;
};

async function pageShop(tab = state.shopTab || 'coffres') {
  state.shopTab = tab;
  if (!app.querySelector('.shop-page')) app.innerHTML = `<div class="loading">Chargement…</div>`;
  const me = state.me;
  const [owned, ownedItems, chests] = await Promise.all([
    safe(() => api.listOwned(me.id)), safe(() => api.listOwnedItems(me.id)), safe(() => api.listChests()), loadColors(), loadBalances()]);
  const have = new Set([...(owned || []), ...(ownedItems || [])]);
  const money = bal(me.id).rubis;
  const all = [
    ...[...state.colors.values()].filter(c => c.effect).map(c => ({ ...c, kind: 'pseudo', rarity: colorRarity(c.price) })),
    ...state.items.values(),
  ].map(i => ({ ...i, in_shop: false }));  // tout s'obtient uniquement dans le coffre
  const equipped = it => it.kind === 'pseudo' ? me.name_color === it.id : me[SLOT[it.kind]] === it.id;
  const count = k => all.filter(i => i.kind === k && have.has(i.id)).length + ' / ' + all.filter(i => i.kind === k).length;

  const itemCard = it => `
    <div class="card item-card ${equipped(it) ? 'equipped' : ''} ${RARITY[it.rarity]?.[1]}">
      ${itemPreview(it, me)}
      <div class="ic-head"><strong>${esc(it.name)}</strong>${rarityTag(it.rarity)}</div>
      ${equipped(it) ? `<span class="pill-info">Équipé</span><button class="btn ghost sm" data-unequip="${esc(it.kind)}">Retirer</button>`
        : have.has(it.id) ? `<button class="btn ghost sm" data-equip="${esc(it.id)}">Équiper</button>`
        : it.in_shop ? `${rubis(it.price)}<button class="btn primary sm" data-buy="${esc(it.id)}" ${money < it.price ? 'disabled' : ''}>Acheter</button>`
        : '<span class="chest-only">🔒 À gagner dans le coffre</span>'}
    </div>`;

  const chestCard = c => {
    const got = all.filter(i => have.has(i.id)).length;
    const tot = c.w_commun + c.w_rare + c.w_epique + c.w_legendaire || 1;
    const odds = ['commun', 'rare', 'epique', 'legendaire'].filter(r => c['w_' + r]).map(r =>
      `<li class="${RARITY[r][1]}"><span>${RARITY[r][0]}</span><b>${Math.round(100 * c['w_' + r] / tot)}%</b></li>`).join('');
    return `<div class="card chest-card chest-big chest-${esc(c.id)}">
      <div class="chest-stage">${chestSvg(c.id)}</div>
      <strong>${esc(c.name)}</strong>
      <ul class="odds">${odds}</ul>
      <div class="collec"><span>Ta collection</span><b>${got} / ${all.length}</b><i style="width:${Math.round(100 * got / (all.length || 1))}%"></i></div>
      <button class="btn primary big" data-chest="${esc(c.id)}" ${money < c.price ? 'disabled' : ''}>Ouvrir · ${rubis(c.price)}</button>
      ${money < c.price ? `<p class="small center">Il te manque ${c.price - money} rubis.</p>` : ''}
    </div>`;
  };

  const body = tab === 'coffres' ? `
      <p class="small">Tout s'obtient dans le coffre : effets de pseudo, cadres, titres et effets de victoire, au hasard.
      Un doublon est recyclé en rubis. Équipe tes trouvailles dans les autres onglets.</p>
      <div class="chests-one">${(chests || []).map(chestCard).join('')}</div>`
    : `${tab === 'pseudo' ? `<p class="small">L'effet s'affiche partout sur le site : profil, arbres, classement…</p>`
        : tab === 'frame' ? `<p class="small">Un cadre animé autour de ta photo, partout sur le site.</p>`
        : tab === 'title' ? `<p class="small">Un petit titre sous ton pseudo : profil, membres, fiches de match.</p>`
        : `<p class="small">L'animation qui se déclenche sur la fiche du match quand tu gagnes.</p>`}
      <div class="grid shop">
        ${tab === 'pseudo' ? `<div class="card item-card ${!me.name_color ? 'equipped' : ''}">
          <div class="ip ip-pseudo">${uname({ ...me, name_color: null })}</div>
          <div class="ic-head"><strong>Sans effet</strong><span class="muted small">couleur du rôle</span></div>
          ${!me.name_color ? '<span class="pill-info">Équipé</span>' : '<button class="btn ghost sm" data-unequip="pseudo">Équiper</button>'}
        </div>` : ''}
        ${all.filter(i => i.kind === tab).map(itemCard).join('')}
      </div>`;

  app.innerHTML = `<div class="shop-page">
    <div class="page-head"><h1>Boutique</h1><div class="big-money">${rubis(money)}</div></div>
    <nav class="shop-tabs">${SHOP_TABS.map(([k, ic, label]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}"><span>${ic}</span>${label}${k !== 'coffres' ? `<small>${count(k)}</small>` : ''}</button>`).join('')}</nav>
    ${body}</div>`;

  const byId = id => all.find(i => i.id === id);
  const equip = (kind, id) => safe(async () => {
    if (kind === 'pseudo') { await api.equipColor(id); me.name_color = id; }
    else { await api.equipItem(kind, id); me[SLOT[kind]] = id; }
    toast(id ? 'Équipé !' : 'Retiré'); renderNav(); pageShop(tab);
  });
  app.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => pageShop(b.dataset.tab)));
  app.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', () => { const it = byId(b.dataset.equip); equip(it.kind, it.id); }));
  app.querySelectorAll('[data-unequip]').forEach(b => b.addEventListener('click', () => equip(b.dataset.unequip, null)));
  app.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => safe(async () => {
    const it = byId(b.dataset.buy);
    if (!confirm(`Acheter « ${it.name} » pour ${it.price} rubis ?`)) return;
    if (it.kind === 'pseudo') { await api.buyColor(it.id); me.name_color = it.id; }
    else { await api.buyItem(it.id); me[SLOT[it.kind]] = it.id; }
    toast('Acheté et équipé !'); await loadBalances(); renderNav(); pageShop(tab);
  })));
  app.querySelectorAll('[data-chest]').forEach(b => b.addEventListener('click', () => openChestDialog((chests || []).find(c => c.id === b.dataset.chest))));
}

// Ouverture d'un coffre : il tremble, s'ouvre, et révèle l'objet
async function openChestDialog(c) {
  const box = openModal(`
    <div class="chest-open stage-shake">
      <div class="co-rays"></div>
      <div class="co-chest">${chestSvg(c.id)}</div>
      <div class="co-reveal"></div>
    </div>`, 'chest-modal');
  let res;
  try { res = await api.openChest(c.id); }
  catch (e) { closeModal(); toast(e.message || 'Erreur', 'err'); return; }
  await new Promise(r => setTimeout(r, 1400));
  await loadBalances(); renderNav(); refreshAchCount();
  const it = res.kind === 'pseudo'
    ? { ...(state.colors.get(res.id) || {}), id: res.id, name: res.name, effect: res.effect, kind: 'pseudo', rarity: res.rarity }
    : { ...(state.items.get(res.id) || {}), ...res };
  const st = $('.chest-open', box);
  st.classList.remove('stage-shake'); st.classList.add('opened', RARITY[res.rarity][1]);
  $('.co-chest', box).innerHTML = chestSvg(c.id, true);
  $('.co-reveal', box).innerHTML = `
    <div class="co-card ${RARITY[res.rarity][1]}">
      ${rarityTag(res.rarity)}
      ${itemPreview(it, state.me)}
      <strong>${esc(res.name)}</strong>
      <small class="muted">${KIND_LABEL[res.kind] || ''}</small>
      ${res.duplicate ? `<p class="co-dup">Doublon ! Recyclé en ${rubis(res.refund)}</p>` : '<p class="co-new">✨ Nouveau !</p>'}
    </div>
    <div class="actions center">
      ${!res.duplicate ? '<button class="btn primary" id="co-equip">Équiper</button>' : ''}
      <button class="btn ghost" id="co-again" ${bal(state.me.id).rubis < c.price ? 'disabled' : ''}>Rouvrir · ${rubis(c.price)}</button>
      <button class="btn ghost" data-close>Fermer</button>
    </div>`;
  const back = () => { closeModal(); if (location.hash.startsWith('#/boutique')) pageShop(); };
  $('[data-close]', box)?.addEventListener('click', back);
  $('#co-equip', box)?.addEventListener('click', () => safe(async () => {
    if (res.kind === 'pseudo') { await api.equipColor(res.id); state.me.name_color = res.id; }
    else { await api.equipItem(res.kind, res.id); state.me[SLOT[res.kind]] = res.id; }
    toast('Équipé !'); renderNav(); back();
  }));
  $('#co-again', box)?.addEventListener('click', () => openChestDialog(c));
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
      <button data-tab="quiz">🧠 Quiz</button>
      <button data-tab="blindtest">🎵 Blind test</button>
      <button data-tab="ecrans">🎬 Écrans d'attente</button>
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
    ({ fond: showBg, icones: showIcons, galerie: showGallery,
       quiz: () => { body.innerHTML = '<section id="quiz-admin"></section>'; drawQuizAdmin(); },
       blindtest: () => { body.innerHTML = '<section id="bt-admin"></section>'; drawBtAdmin(); },
       ecrans: () => drawScenesAdmin(body) })[k]?.();
    history.replaceState(null, '', '#/parametres/' + k);
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
  refreshAchCount();
  // présence : qui est sur le site en ce moment
  // carte de l'île mise de côté pour plus tard : if (state.me?.in_guild && api.presence) api.presence(state.me.id, ids => { state.online = new Set(ids); drawIslanders(); });
  if (state.me?.is_admin) settlePending();
  window.addEventListener('hashchange', route);
  route();
  // Première visite : cadeau et animation de bienvenue
  if (state.me?.in_guild && api.welcome) {
    const w = await safe(() => api.welcome());
    if (w?.new) { await loadBalances(); renderNav(); showWelcome(w); }
  }
})();

// ---------- Écrans d'attente perso (taverne…) ----------
// L'admin choisit le fond, le décor et les membres présents ; les avatars vivent leur vie (se baladent, discutent, dansent).
let sceneStop = null;
const sceneEmojis = sc => (sc.bubbles || '').split(/\s+/).filter(Boolean);
async function pageScene(id) {
  sceneStop?.(); sceneStop = null;
  app.innerHTML = `<div class="loading">Chargement…</div>`;
  let [sc, members] = await Promise.all([safe(() => api.getScene(id)), safe(() => api.listMembers())]);
  if (!sc) { app.innerHTML = '<p class="empty">Écran introuvable.</p>'; return; }
  const people = new Map((members || []).map(m => [m.id, m]));
  const admin = state.me.is_admin;
  app.innerHTML = `
    <div class="scene-page">
      <div class="scene" id="scene">
        <div class="scene-bg"></div><div class="scene-floor"></div>
        <div class="scene-decor back"></div><div class="scene-dance"></div><div class="scene-folk"></div><div class="scene-decor front"></div>
        <div class="scene-title"><span class="scene-emoji"></span><b class="scene-name"></b><small class="scene-count"></small></div>
        <button class="scene-fs" title="Plein écran" type="button">⛶</button>
      </div>
      ${admin ? `<div class="scene-tools">
        <button class="btn ghost sm" data-st="people">👥 Qui est là ?</button>
        <button class="btn ghost sm" data-st="bg">🖼️ Fond</button>
        <button class="btn ghost sm" data-st="decor">🧩 Décor</button>
        <button class="btn ghost sm" data-st="floor">🚶 Zone de marche</button>
        <button class="btn ghost sm" data-st="info">✏️ Nom & ambiance</button>
        <a class="btn ghost sm" href="#/parametres/ecrans">⚙️ Tous les écrans</a>
      </div>` : ''}
    </div>`;
  const root = $('#scene'), folk = $('.scene-folk', root), back = $('.scene-decor.back', root), front = $('.scene-decor.front', root);
  const W = new Map();
  const rnd = (a, b) => a + Math.random() * (b - a);
  const spot = () => ({ x: rnd(5, 95), y: rnd(sc.floor_top, sc.floor_bottom) });
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function paintScene() {
    root.style.setProperty('--scene-bg', sc.background_url ? `url('${sc.background_url.replace(/'/g, '%27')}')` : 'none');
    root.classList.toggle('no-bg', !sc.background_url);
    $('.scene-emoji', root).textContent = sc.emoji || '';
    $('.scene-name', root).textContent = sc.name || '';
    $('.scene-floor', root).style.cssText = `top:${sc.floor_top}%;height:${sc.floor_bottom - sc.floor_top}%`;
    const deco = (list, z) => list.map((d, i) => ({ d, i })).filter(({ d }) => (d.z || 'back') === z).map(({ d, i }) =>
      `<img class="sd ${d.flip ? 'flip' : ''}" data-i="${i}" src="${esc(d.url)}" alt="" style="left:${d.x}%;top:${d.y}%;width:${d.w || 18}%">`).join('');
    back.innerHTML = deco(sc.decor || [], 'back');
    front.innerHTML = deco(sc.decor || [], 'front');
    // les présents
    const want = new Set((sc.members || []).filter(id => people.has(id)));
    for (const uid of want) if (!W.has(uid)) {
      const p = people.get(uid), d = document.createElement('div');
      d.className = 'sw';
      d.innerHTML = `<span class="sw-bubble"></span><span class="sw-body">${avatarImg(p, 'av')}</span><span class="sw-name">${esc(p.username)}</span>`;
      folk.appendChild(d);
      const s = spot();
      W.set(uid, { el: d, bub: $('.sw-bubble', d), x: s.x, y: s.y, tx: s.x, ty: s.y, wait: rnd(0, 3), speed: rnd(4, 8), dir: 1, act: 'idle', until: 0 });
    }
    for (const [uid, w] of W) if (!want.has(uid)) { w.el.remove(); W.delete(uid); }
    for (const w of W.values()) { w.y = Math.min(sc.floor_bottom, Math.max(sc.floor_top, w.y)); w.ty = Math.min(sc.floor_bottom, Math.max(sc.floor_top, w.ty)); }
    $('.scene-count', root).textContent = want.size ? `${want.size} personne${want.size > 1 ? 's' : ''}` : (admin ? 'Personne pour l\'instant : clique sur 👥' : '');
    // mode « piste de danse » : les avatars en gros plan qui dansent
    const dance = sc.mode === 'dance';
    root.classList.toggle('mode-dance', dance);
    const crewKey = dance ? [...want].join(',') : '';
    if (crewKey !== paintScene.crew) {
      paintScene.crew = crewKey;
      const ids = [...want];
      $('.scene-dance', root).innerHTML = dance ? `<div class="dz-lights"><i></i><i></i><i></i><i></i><i></i></div><span class="dz-ball">🪩</span>
        <div class="dz-crew">${ids.map((uid, i) => `<div class="dz m-bounce" data-u="${esc(uid)}" style="--hue:${(i * 47) % 360}"><span class="dz-bub"></span>
          <span class="dz-fig"><span class="dz-leg l"></span><span class="dz-leg r"></span><span class="dz-torso"></span><span class="dz-arm l"><i></i></span><span class="dz-arm r"><i></i></span><span class="dz-av">${avatarImg(people.get(uid), 'av')}</span></span>
          <b>${esc(people.get(uid).username)}</b></div>`).join('')}</div>` : '';
      sizeDance();
    }
  }
  // taille des danseurs : le plus gros possible selon leur nombre et la taille de l'écran
  function sizeDance() {
    if (sc.mode !== 'dance') return;
    const n = Math.max(1, root.querySelectorAll('.dz').length), r = root.getBoundingClientRect();
    if (!r.width) return;
    let best = 34;
    for (let rows = 1; rows <= 4; rows++) {
      const perRow = Math.ceil(n / rows);
      const s = Math.min((r.width * .9) / perRow / 1.7 - 10, ((r.height * .8) / rows - 40) / 2.35);
      if (s > best) best = s;
    }
    root.style.setProperty('--dz', Math.max(34, Math.min(best, r.height * .3)) + 'px');
  }

  // la vie des petits habitants
  let raf = 0, last = 0, stopped = false;
  const say = (w, txt, ms = 2600) => { w.bub.textContent = txt; w.el.classList.add('talk'); w.bubUntil = performance.now() + ms; };
  function tick(t) {
    if (stopped) return;
    const dt = Math.min(.05, (t - (last || t)) / 1000); last = t;
    if (!document.hidden && sc.mode !== 'dance') {
      const emo = sceneEmojis(sc), list = [...W.values()];
      for (const w of list) {
        if (w.bubUntil && t > w.bubUntil) { w.el.classList.remove('talk'); w.bubUntil = 0; }
        const dx = w.tx - w.x, dy = w.ty - w.y, dist = Math.hypot(dx, dy);
        if (w.act === 'walk' && dist > .3) {
          const sp = w.speed * dt;
          w.x += dx / dist * Math.min(sp, dist); w.y += dy / dist * Math.min(sp, dist) * 1.4;
          if (Math.abs(dx) > .1) w.dir = dx > 0 ? 1 : -1;
        } else if (w.act === 'walk') { w.act = 'idle'; w.wait = rnd(1.5, 5); }
        else if (t > w.until && (w.wait -= dt) <= 0) {
          // prochaine envie : marcher, rejoindre quelqu'un pour discuter, danser ou dire un truc
          const r = Math.random();
          if (r < .45) { const s = spot(); w.tx = s.x; w.ty = s.y; w.act = 'walk'; }
          else if (r < .65 && list.length > 1) {
            const o = list[Math.floor(Math.random() * list.length)];
            if (o !== w) { w.tx = Math.min(95, Math.max(5, o.x + (o.x > w.x ? -5 : 5))); w.ty = o.y; w.act = 'walk'; w.chatWith = o; }
          } else if (r < .8 && !calm) { w.act = 'dance'; w.until = t + 2600; w.el.classList.add('dance'); setTimeout(() => w.el.classList.remove('dance'), 2600); w.act = 'idle'; w.wait = rnd(2, 4); }
          else if (emo.length) { say(w, emo[Math.floor(Math.random() * emo.length)]); w.wait = rnd(2, 5); }
          else w.wait = rnd(2, 5);
        }
        if (w.chatWith && w.act === 'idle') { const o = w.chatWith; w.chatWith = null; if (emo.length) { say(w, '💬'); setTimeout(() => say(o, emo[Math.floor(Math.random() * emo.length)]), 900); } w.dir = o.x > w.x ? 1 : -1; w.wait = rnd(3, 6); }
        const k = (w.y - sc.floor_top) / Math.max(1, sc.floor_bottom - sc.floor_top);
        w.el.classList.toggle('moving', w.act === 'walk');
        w.el.style.left = w.x + '%'; w.el.style.top = w.y + '%';
        w.el.style.zIndex = Math.round(w.y * 10);
        w.el.style.setProperty('--dir', w.dir);
        w.el.style.setProperty('--k', (.75 + k * .55).toFixed(3));
      }
    }
    raf = requestAnimationFrame(tick);
  }
  paintScene();
  raf = requestAnimationFrame(tick);
  const unsub = api.sceneSubscribe?.(id, async () => { const n = await safe(() => api.getScene(id)); if (n && !root.classList.contains('placing')) { sc = n; paintScene(); } });
  // piste de danse : un danseur passe en vedette à tour de rôle, et des bulles apparaissent
  // chorégraphie : toutes les 4 s (8 temps), nouveau pas ; parfois tous ensemble, parfois en vague, parfois chacun son style, parfois un solo
  const MOVES = ['bounce', 'disco', 'jacks', 'floss', 'wave', 'robot', 'moon', 'clap', 'twist'];
  let starI = 0, step = 0, lastMove = '';
  const pickMove = () => { let m; do m = MOVES[Math.floor(Math.random() * MOVES.length)]; while (m === lastMove); lastMove = m; return m; };
  const danceTimer = setInterval(() => {
    if (sc.mode !== 'dance' || document.hidden) return;
    sizeDance();
    const all = [...root.querySelectorAll('.dz')]; if (!all.length) return;
    const plan = ['sync', 'wave', 'sync', 'free', 'solo', 'wave', 'sync', 'free'][step++ % 8];
    const mv = pickMove();
    all.forEach((d, i) => {
      const m = plan === 'free' ? MOVES[Math.floor(Math.random() * MOVES.length)] : plan === 'solo' ? 'bounce' : mv;
      d.className = d.className.replace(/\bm-\w+/g, '').replace(/\s+/g, ' ').trim() + ' m-' + m;
      d.style.setProperty('--dl', plan === 'wave' ? `${(i * .12).toFixed(2)}s` : '0s');
      d.classList.remove('star', 'solo');
    });
    if (all.length > 1 || plan === 'solo') {
      const st = all[starI++ % all.length]; st.classList.add('star');
      if (plan === 'solo') { st.className = st.className.replace(/\bm-\w+/g, '') + ' m-spin solo'; }
    }
    root.querySelector('.scene-dance')?.setAttribute('data-plan', plan);
    const emo = sceneEmojis(sc), d = all[Math.floor(Math.random() * all.length)], b = d && $('.dz-bub', d);
    if (b && emo.length) { b.textContent = emo[Math.floor(Math.random() * emo.length)]; d.classList.add('talk'); setTimeout(() => d.classList.remove('talk'), 2200); }
  }, 4000);
  const onResize = () => sizeDance();
  window.addEventListener('resize', onResize); document.addEventListener('fullscreenchange', onResize);
  sceneStop = () => { stopped = true; cancelAnimationFrame(raf); unsub?.(); clearInterval(danceTimer); window.removeEventListener('resize', onResize); document.removeEventListener('fullscreenchange', onResize); };

  $('.scene-fs', root).addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {});
  });
  if (!admin) return;
  const save = patch => safe(async () => { Object.assign(sc, patch); paintScene(); await api.updateScene(id, patch); });
  const pickFile = (accept = 'image/*', multiple = false) => new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.onchange = () => res([...inp.files]); inp.click();
  });
  // choisir une image : envoyer depuis l'appareil ou piocher dans « Mes images »
  const chooseImage = (title, maxSize) => new Promise(async resolve => {
    const gal = (await safe(() => api.listGallery())) || [];
    const m = openModal(`<h2>${title}</h2>
      <button class="btn primary" id="sc-up" type="button">📤 Envoyer une image</button>
      ${gal.length ? `<p class="small">ou choisis dans tes images :</p><div class="sc-gal">${gal.map((g, i) => `<button type="button" data-g="${i}"><img src="${esc(g.url)}" alt="" loading="lazy"></button>`).join('')}</div>` : '<p class="small muted">Astuce : ajoute tes décors dans Paramètres → Mes images pour les retrouver ici.</p>'}
      <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button></div>`);
    $('#sc-up', m).onclick = async () => {
      const [f] = await pickFile('image/png,image/jpeg,image/webp,image/gif'); if (!f) return;
      await safe(async () => { toast('Envoi…'); const url = await api.uploadImage(await shrinkImage(f, maxSize, f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'), 'ecrans'); closeModal(); resolve(url); });
    };
    m.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { closeModal(); resolve(gal[+b.dataset.g].url); });
  });

  const tools = {
    people() {
      const list = [...people.values()].filter(p => !p.is_guest).sort((a, b) => a.username.localeCompare(b.username));
      const sel = new Set(sc.members || []);
      const m = openModal(`<h2>👥 Qui est dans « ${esc(sc.name)} » ?</h2>
        <input id="sc-q" placeholder="Rechercher un membre…" autocomplete="off">
        <div class="row wrap sc-pk-bar"><button type="button" class="btn ghost sm" id="sc-all">Tout le monde</button><button type="button" class="btn ghost sm" id="sc-none">Personne</button><span class="small muted" id="sc-n"></span></div>
        <div class="sc-pick">${list.map(p => `<label class="sc-pp" data-n="${esc(p.username.toLowerCase())}"><input type="checkbox" value="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}>${avatarImg(p, 'av sm')}<span>${esc(p.username)}</span></label>`).join('')}</div>
        <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><button type="button" class="btn primary" id="sc-ok">Enregistrer</button></div>`);
      const boxes = [...m.querySelectorAll('.sc-pick input')];
      const count = () => { $('#sc-n', m).textContent = `${boxes.filter(b => b.checked).length} choisi(s)`; };
      boxes.forEach(b => b.onchange = count); count();
      $('#sc-q', m).oninput = e => { const q = e.target.value.trim().toLowerCase(); m.querySelectorAll('.sc-pp').forEach(l => { l.hidden = q && !l.dataset.n.includes(q); }); };
      $('#sc-all', m).onclick = () => { boxes.forEach(b => { if (!b.closest('.sc-pp').hidden) b.checked = true; }); count(); };
      $('#sc-none', m).onclick = () => { boxes.forEach(b => b.checked = false); count(); };
      $('#sc-ok', m).onclick = () => { closeModal(); save({ members: boxes.filter(b => b.checked).map(b => b.value) }).then(() => toast('Liste mise à jour 👥')); };
    },
    async bg() {
      const m = openModal(`<h2>🖼️ Fond de l'écran</h2>
        <div class="row wrap"><button type="button" class="btn primary" id="sc-bg">${sc.background_url ? 'Changer le fond' : 'Choisir un fond'}</button>
        ${sc.background_url ? '<button type="button" class="btn ghost" id="sc-bg-del">Retirer le fond</button>' : ''}</div>
        <p class="small muted">Une image large (au moins 1920 × 1080) : une salle de taverne, une plage, un salon… Les avatars marchent dans la « zone de marche » que tu règles ensuite.</p>
        <div class="actions"><button type="button" class="btn ghost" data-close>Fermer</button></div>`);
      $('#sc-bg', m).onclick = async () => { const url = await chooseImage('Fond de l\'écran', 2560); if (url) { await save({ background_url: url }); toast('Fond enregistré 🖼️'); } };
      $('#sc-bg-del', m)?.addEventListener('click', () => { closeModal(); save({ background_url: null }); });
    },
    decor() { decorMode(); },
    floor() {
      const m = openModal(`<h2>🚶 Zone de marche</h2>
        <p class="small">Règle où les avatars peuvent marcher (le sol de ton décor). Plus ils sont bas, plus ils paraissent proches et grands.</p>
        <label class="set-line">Haut de la zone <b id="ft-v">${sc.floor_top}%</b><input type="range" id="ft" min="0" max="90" step="1" value="${sc.floor_top}"></label>
        <label class="set-line">Bas de la zone <b id="fb-v">${sc.floor_bottom}%</b><input type="range" id="fb" min="10" max="100" step="1" value="${sc.floor_bottom}"></label>
        <div class="actions"><button type="button" class="btn primary" data-close>OK</button></div>`);
      root.classList.add('show-floor');
      const upd = () => {
        let a = +$('#ft', m).value, b = +$('#fb', m).value; if (b < a + 5) b = Math.min(100, a + 5);
        $('#ft-v', m).textContent = a + '%'; $('#fb-v', m).textContent = b + '%';
        sc.floor_top = a; sc.floor_bottom = b; paintScene();
      };
      $('#ft', m).oninput = upd; $('#fb', m).oninput = upd;
      modal._onClose = () => { root.classList.remove('show-floor'); save({ floor_top: sc.floor_top, floor_bottom: sc.floor_bottom }); };
    },
    info() {
      const m = openModal(`<h2>✏️ Nom, ambiance & bulles</h2>
        <div class="form"><label>Nom de l'écran<input id="sc-name" value="${esc(sc.name)}" maxlength="40"></label>
        <label>Emoji<input id="sc-emo" value="${esc(sc.emoji)}" maxlength="4"></label>
        <label>Ambiance<select id="sc-mode"><option value="walk" ${sc.mode !== 'dance' ? 'selected' : ''}>🚶 Ils se baladent dans le décor</option><option value="dance" ${sc.mode === 'dance' ? 'selected' : ''}>🪩 Piste de danse (gros plan)</option></select></label>
        <label>Ce que les avatars disent dans leurs bulles (séparé par des espaces)<input id="sc-bub" value="${esc(sc.bubbles)}"></label></div>
        <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><button type="button" class="btn primary" id="sc-ok">Enregistrer</button></div>`);
      $('#sc-ok', m).onclick = () => { const p = { name: $('#sc-name', m).value.trim() || 'Écran', emoji: $('#sc-emo', m).value.trim(), bubbles: $('#sc-bub', m).value.trim(), mode: $('#sc-mode', m).value }; closeModal(); save(p); };
    },
  };
  app.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => tools[b.dataset.st]()));

  // Mode décor : ajouter des images, les glisser, changer leur taille, les mettre devant/derrière les avatars
  function decorMode() {
    if (root.classList.contains('placing')) return;
    const orig = JSON.parse(JSON.stringify(sc.decor || []));
    root.classList.add('placing');
    let sel = (sc.decor || []).length - 1;
    const bar = document.createElement('div'); bar.className = 'pd-bar sc-bar';
    bar.innerHTML = `<span>✋ Glisse les images · touche-en une pour la régler</span>
      <button type="button" class="btn primary sm" data-d="add">➕ Image</button>
      <span class="pd-sz"><button type="button" class="btn ghost sm" data-d="-">➖</button><button type="button" class="btn ghost sm" data-d="+">➕</button>
      <button type="button" class="btn ghost sm" data-d="z">⇅ Devant/derrière</button><button type="button" class="btn ghost sm" data-d="flip">↔️</button><button type="button" class="btn ghost sm" data-d="del">🗑️</button></span>
      <button type="button" class="btn ghost sm" data-d="cancel">Annuler</button><button type="button" class="btn primary sm" data-d="save">Enregistrer</button>`;
    document.body.appendChild(bar);
    const mark = () => root.querySelectorAll('.sd').forEach(el => el.classList.toggle('sel', +el.dataset.i === sel));
    const repaint = () => { paintScene(); mark(); };
    mark();
    let drag = null, off = [0, 0];
    const down = e => {
      const el = e.target.closest('.sd'); if (!el) return;
      e.preventDefault(); sel = +el.dataset.i; drag = el; mark();
      const r = root.getBoundingClientRect(), d = sc.decor[sel];
      off = [(e.clientX - r.left) / r.width * 100 - d.x, (e.clientY - r.top) / r.height * 100 - d.y];
    };
    const move = e => {
      if (!drag) return;
      const r = root.getBoundingClientRect(), d = sc.decor[sel];
      d.x = Math.round(Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100 - off[0])) * 10) / 10;
      d.y = Math.round(Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100 - off[1])) * 10) / 10;
      drag.style.left = d.x + '%'; drag.style.top = d.y + '%';
    };
    const up = () => { drag = null; };
    root.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    const stop = () => { root.classList.remove('placing'); bar.remove(); root.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); root.querySelectorAll('.sd.sel').forEach(x => x.classList.remove('sel')); };
    bar.addEventListener('click', async e => {
      const k = e.target.closest('[data-d]')?.dataset.d; if (!k) return;
      const d = sc.decor[sel];
      if (k === 'add') { const url = await chooseImage('Ajouter un élément de décor', 1400); if (url) { sc.decor = [...(sc.decor || []), { url, x: 50, y: 60, w: 18, z: 'back' }]; sel = sc.decor.length - 1; repaint(); } }
      else if (k === '+' && d) { d.w = Math.min(100, (d.w || 18) * 1.15); repaint(); }
      else if (k === '-' && d) { d.w = Math.max(3, (d.w || 18) / 1.15); repaint(); }
      else if (k === 'z' && d) { d.z = d.z === 'front' ? 'back' : 'front'; repaint(); toast(d.z === 'front' ? 'Devant les avatars' : 'Derrière les avatars'); }
      else if (k === 'flip' && d) { d.flip = !d.flip; repaint(); }
      else if (k === 'del' && d) { sc.decor.splice(sel, 1); sel = sc.decor.length - 1; repaint(); }
      else if (k === 'cancel') { stop(); sc.decor = orig; paintScene(); }
      else if (k === 'save') { stop(); await save({ decor: sc.decor }); toast('Décor enregistré 🧩'); }
    });
  }
}

// Paramètres → Écrans d'attente : liste, création, suppression
async function drawScenesAdmin(box) {
  const list = (await safe(() => api.listScenes())) || [];
  box.innerHTML = `<section class="card set-card">
      <div class="page-head"><h2>🎬 Écrans d'attente</h2><button class="btn primary sm" id="sc-new">+ Nouvel écran</button></div>
      <p class="small">Crée des écrans à afficher pendant vos soirées (taverne, salon, plage…). Tu choisis le fond, le décor et qui est présent : les avatars vivent leur vie tout seuls. L'écran des tournois, lui, se trouve sur chaque compétition (mode soirée).</p>
      <div class="sc-list">${list.map(s => `<div class="sc-item">
        <span class="sc-thumb" style="${s.background_url ? `background-image:url('${esc(s.background_url)}')` : ''}">${s.background_url ? '' : esc(s.emoji || '🎬')}</span>
        <span class="sc-info"><b>${esc(s.emoji || '')} ${esc(s.name)}</b><small>${s.mode === 'dance' ? '🪩 Piste de danse · ' : ''}${(s.members || []).length} personne(s) · ${(s.decor || []).length} élément(s) de décor</small></span>
        <a class="btn primary sm" href="#/ecran/${esc(s.id)}">Ouvrir</a><button class="btn danger sm" data-scdel="${esc(s.id)}">✕</button></div>`).join('') || '<p class="empty">Aucun écran pour l\'instant.</p>'}</div>
    </section>`;
  $('#sc-new', box).onclick = () => {
    const m = openModal(`<h2>Nouvel écran d'attente</h2>
      <div class="sc-tpl">${[['🍺', 'Taverne', '🍺 🍻 🎲 😂 🎵 🍕 💬 🃏'], ['🛋️', 'Salon', '🎮 😂 🍿 💬 🥤 😴'], ['🏖️', 'Plage', '🌊 ☀️ 🍹 🏐 😎 🐚'], ['🎄', 'Noël', '🎁 🎄 ⛄ 🍪 ☕ ✨'], ['🪩', 'Piste de danse', '🎵 🔥 💃 🕺 🎶 ✨ 🙌', 'dance'], ['🎬', 'Autre', '💬 😂 🎉']].map(([e, n, b, md]) => `<button type="button" data-tpl="${esc(e)}|${esc(n)}|${esc(b)}|${md || 'walk'}"><span>${e}</span>${n}</button>`).join('')}</div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button></div>`);
    m.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => safe(async () => {
      const [emoji, name, bubbles, mode] = b.dataset.tpl.split('|');
      const s = await api.createScene({ emoji, name, bubbles, mode });
      closeModal(); location.hash = '#/ecran/' + s.id;
    }));
  };
  box.querySelectorAll('[data-scdel]').forEach(b => b.onclick = () => safe(async () => {
    if (!confirm('Supprimer cet écran ?')) return;
    await api.deleteScene(b.dataset.scdel); drawScenesAdmin(box);
  }));
}
