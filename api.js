// =====================================================================
//  Accès aux données : Supabase (vrai site) ou mode démo (si config.js
//  n'est pas encore rempli, pour voir le site tout de suite).
// =====================================================================
import { CONFIG } from './config.js';
import { resolveBracket } from './bracket.js';

export const DEMO = !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('TON-PROJET');

// ---------------------------------------------------------------------
//  Version Supabase
// ---------------------------------------------------------------------
async function supabaseApi() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
  });
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  const PROFILE_COLS = 'id, username, avatar_url, roles, in_guild, is_admin, name_color, is_guest, item_frame, item_banner, item_title, item_victory';

  return {
    async init() {
      const { data: { session } } = await sb.auth.getSession();
      if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
      if (!session) return null;
      // Juste après la connexion, Supabase nous donne le jeton Discord : on met les rôles à jour
      if (session.provider_token) {
        const { data, error } = await sb.functions.invoke('wuhu-sync-discord', {
          body: { provider_token: session.provider_token },
        });
        if (!error && data?.profile) return data.profile;
        console.warn('wuhu-sync-discord', error);
      }
      const p = ok(await sb.from('wuhu_profiles').select(PROFILE_COLS).eq('id', session.user.id).maybeSingle());
      if (p) return p;
      // Pas de profil et plus de jeton Discord : il faut se reconnecter
      await sb.auth.signOut();
      return null;
    },
    signIn() {
      return sb.auth.signInWithOAuth({
        provider: 'discord',
        options: { scopes: 'identify guilds.members.read', redirectTo: location.origin + location.pathname },
      });
    },

    listRoles: async () => ok(await sb.from('wuhu_roles').select('*').order('position')),
    saveRoles: async rows => ok(await sb.from('wuhu_roles').upsert(rows)),
    deleteRole: async id => ok(await sb.from('wuhu_roles').delete().eq('id', id)),
    signOut: () => sb.auth.signOut(),

    listTournaments: async () =>
      ok(await sb.from('wuhu_tournaments').select('*, participants:wuhu_participants(count)').order('created_at', { ascending: false })),
    getTournament: async id => ok(await sb.from('wuhu_tournaments').select('*').eq('id', id).maybeSingle()),
    listParticipants: async tid =>
      ok(await sb.from('wuhu_participants').select(`user_id, joined_at, profile:wuhu_profiles(${PROFILE_COLS})`)
        .eq('tournament_id', tid).order('joined_at')),
    join: async (tid, uid) => ok(await sb.from('wuhu_participants').insert({ tournament_id: tid, user_id: uid })),
    leave: async (tid, uid) => ok(await sb.from('wuhu_participants').delete().eq('tournament_id', tid).eq('user_id', uid)),
    createTournament: async t => ok(await sb.from('wuhu_tournaments').insert(t).select().single()),
    updateTournament: async (id, patch) => ok(await sb.from('wuhu_tournaments').update(patch).eq('id', id)),
    deleteTournament: async id => ok(await sb.from('wuhu_tournaments').delete().eq('id', id)),

    listMembers: async () =>
      ok(await sb.from('wuhu_profiles').select(PROFILE_COLS).eq('in_guild', true).order('username')),
    getProfile: async id => ok(await sb.from('wuhu_profiles').select(PROFILE_COLS).eq('id', id).maybeSingle()),
    async userStats(id) {
      const parts = ok(await sb.from('wuhu_participants')
        .select('tournament:wuhu_tournaments(id, name, game, status, winner_id, created_at, bracket, format, competition_id)').eq('user_id', id));
      return parts.map(p => p.tournament).filter(Boolean);
    },

    // ----- Compétitions -----
    listCompetitions: async () => ok(await sb.from('wuhu_competitions').select('*, tournaments:wuhu_tournaments(id, name, status, winner_id)').order('created_at', { ascending: false })),
    getCompetition: async id => ok(await sb.from('wuhu_competitions').select('*').eq('id', id).maybeSingle()),
    createCompetition: async c => ok(await sb.from('wuhu_competitions').insert(c).select().single()),
    updateCompetition: async (id, patch) => ok(await sb.from('wuhu_competitions').update(patch).eq('id', id)),
    deleteCompetition: async id => ok(await sb.from('wuhu_competitions').delete().eq('id', id)),
    tournamentsOf: async cid => ok(await sb.from('wuhu_tournaments').select('*, participants:wuhu_participants(count)').eq('competition_id', cid).order('position').order('created_at')),
    ledgerForTournaments: async ids => ids.length ? ok(await sb.from('wuhu_ledger').select('user_id, points, rubis, tournament_id').in('tournament_id', ids)) : [],

    // ----- Images -----
    async uploadImage(file, folder = 'tournois') {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      ok(await sb.storage.from('wuhu').upload(path, file, { contentType: file.type, upsert: false }));
      return sb.storage.from('wuhu').getPublicUrl(path).data.publicUrl;
    },
    async listGallery() {
      const files = ok(await sb.storage.from('wuhu').list('galerie', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } }));
      return files.filter(f => f.id).map(f => ({ name: f.name, path: 'galerie/' + f.name, url: sb.storage.from('wuhu').getPublicUrl('galerie/' + f.name).data.publicUrl }));
    },
    deleteImage: async path => ok(await sb.storage.from('wuhu').remove([path])),

    // ----- Thème du site (fond d'écran, icônes) : lisible même sans être connecté -----
    async getTheme() {
      const rows = ok(await sb.from('wuhu_settings').select('key, value').in('key', ['theme', 'icons']));
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    },
    saveSetting: async (key, value) => ok(await sb.from('wuhu_settings').upsert({ key, value })),

    // ----- Inscription à toute une compétition -----
    compMembers: async cid => ok(await sb.from('wuhu_comp_members').select('user_id, joined_at').eq('competition_id', cid).order('joined_at')),
    joinCompetition: async (cid, uid) => ok(await sb.rpc('wuhu_join_competition', uid ? { p_comp: cid, p_user: uid } : { p_comp: cid })),
    addGuest: async (name, tid, cid) => ok(await sb.rpc('wuhu_add_guest', { p_name: name, p_tournament: tid || null, p_competition: cid || null })),
    deleteGuest: async gid => ok(await sb.rpc('wuhu_delete_guest', { p_id: gid })),
    leaveCompetition: async cid => ok(await sb.rpc('wuhu_leave_competition', { p_comp: cid })),

    // ----- Score déclaré par un joueur du match -----
    reportScore: async (tid, mid, winner, s0, s1) =>
      ok(await sb.rpc('wuhu_report_score', { p_tid: tid, p_mid: mid, p_winner: winner, p_s0: s0, p_s1: s1 })),

    // ----- Rubis, points, couleurs -----
    balances: async () => ok(await sb.from('wuhu_balances').select('*')),
    ledger: async (uid, limit = 30) =>
      ok(await sb.from('wuhu_ledger').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(limit)),
    addLedger: async rows => ok(await sb.from('wuhu_ledger').insert(rows)),
    clearTournamentRewards: async tid => ok(await sb.from('wuhu_ledger').delete().eq('tournament_id', tid)),
    listColors: async () => ok(await sb.from('wuhu_colors').select('*').order('position')),
    listOwned: async uid => (ok(await sb.from('wuhu_owned_colors').select('color_id').eq('user_id', uid))).map(r => r.color_id),
    buyColor: async id => ok(await sb.rpc('wuhu_buy_color', { p_color: id })),
    equipColor: async id => ok(await sb.rpc('wuhu_equip_color', { p_color: id })),
    // ----- Objets (cadres, bannières, titres, victoires) et coffres -----
    listItems: async () => ok(await sb.from('wuhu_items').select('*').order('position')),
    listOwnedItems: async uid => (ok(await sb.from('wuhu_owned_items').select('item_id').eq('user_id', uid))).map(r => r.item_id),
    listChests: async () => ok(await sb.from('wuhu_chests').select('*').order('position')),
    buyItem: async id => ok(await sb.rpc('wuhu_buy_item', { p_item: id })),
    equipItem: async (kind, id) => ok(await sb.rpc('wuhu_equip_item', { p_kind: kind, p_item: id })),
    openChest: async id => ok(await sb.rpc('wuhu_open_chest', { p_chest: id })),

    subscribe(tid, cb) {
      const ch = sb.channel('t-' + tid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wuhu_tournaments', filter: `id=eq.${tid}` }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wuhu_participants', filter: `tournament_id=eq.${tid}` }, cb)
        .subscribe();
      return () => sb.removeChannel(ch);
    },
  };
}

// ---------------------------------------------------------------------
//  Mode démo (données inventées, rien n'est envoyé nulle part)
// ---------------------------------------------------------------------
function demoApi() {
  let roles = [
    { id: 'r1', name: 'Gardien de l\'île', color: '#e8504a', position: 0, hidden: false },
    { id: 'r2', name: 'Maître-nageur', color: '#f3a530', position: 1, hidden: false },
    { id: 'r3', name: 'Champion Wuhu', color: '#a259e6', position: 2, hidden: false },
    { id: 'r4', name: 'Sportif', color: '#2fb36b', position: 3, hidden: false },
    { id: 'r5', name: 'Résident', color: '#2fa4e7', position: 4, hidden: false },
  ];
  const names = ['Elphara', 'Matt', 'Sakura', 'Lucas', 'Aicha', 'Hugo', 'Nina', 'Théo', 'Inès', 'Yanis', 'Léa', 'Sami'];
  const roleSets = [
    ['r1', 'r4', 'r5'], ['r3', 'r4', 'r5', 'r9'], ['r2', 'r5'], ['r4', 'r5'],
    ['r5'], ['r4', 'r5'], ['r5', 'r9'], ['r5'], ['r4', 'r5'], ['r5'], ['r5'], ['r5'],
  ];
  const members = names.map((n, i) => ({
    id: 'u' + i, username: n, avatar_url: `https://cdn.discordapp.com/embed/avatars/${i % 6}.png`,
    roles: roleSets[i], in_guild: true, is_admin: i === 0, name_color: i === 1 ? 'fx-feu' : i === 2 ? 'fx-musique' : null,
    ...(i === 1 ? { item_frame: 'fr-feu', item_title: 'ti-feu', item_victory: 'vi-feu' } : {}),
  }));
  const colors = [
    ['vague', 'Vague de Wuhu', 40], ['led', 'Panneau LED', 60], ['glace', 'Glace', 80], ['feu', 'En feu', 80],
    ['musique', 'Mélodie', 100], ['coeurs', 'Coup de cœur', 100], ['neon', 'Néon', 120], ['eclair', 'Électrique', 140],
    ['glitch', 'Glitch', 160], ['fantome', 'Fantôme', 180], ['galaxie', 'Galaxie', 220], ['or', 'Or scintillant', 300],
  ].map(([effect, name, price], position) => ({ id: 'fx-' + effect, name, style: null, effect, price, position }));
  let owned = [['u1', 'fx-feu'], ['u2', 'fx-musique'], ['u0', 'fx-led']];
  const PRICE = { commun: 50, rare: 100, epique: 180, legendaire: 350 };
  const items = [
    ['fr-vague', 'frame', 'Cadre Vague', 'vague', 'commun'], ['fr-glace', 'frame', 'Cadre Givré', 'glace', 'commun'],
    ['fr-feu', 'frame', 'Cadre de Flammes', 'feu', 'rare'], ['fr-coeurs', 'frame', 'Cadre Cœurs', 'coeurs', 'rare'],
    ['fr-neon', 'frame', 'Cadre Néon', 'neon', 'rare'], ['fr-eclair', 'frame', 'Cadre Électrique', 'eclair', 'epique'],
    ['fr-galaxie', 'frame', 'Cadre Galaxie', 'galaxie', 'epique'], ['fr-or', 'frame', 'Cadre en Or', 'or', 'legendaire'],
    ['ti-nouveau', 'title', 'Petit nouveau', 'vague', 'commun'], ['ti-pecheur', 'title', 'Pêcheur de Wuhu', 'glace', 'commun'],
    ['ti-rock', 'title', 'Rockstar', 'musique', 'rare'], ['ti-coeur', 'title', "Cœur d'artichaut", 'coeurs', 'rare'],
    ['ti-feu', 'title', 'Âme en feu', 'feu', 'rare'], ['ti-glitch', 'title', 'Bug du système', 'glitch', 'epique'],
    ['ti-fantome', 'title', "Fantôme de l'île", 'fantome', 'epique'], ['ti-etoile', 'title', 'Étoile filante', 'galaxie', 'epique'],
    ['ti-legende', 'title', 'Légende de Wuhu', 'or', 'legendaire'],
    ['vi-confettis', 'victory', 'Confettis', 'confettis', 'commun'], ['vi-coeurs', 'victory', 'Pluie de cœurs', 'coeurs', 'rare'],
    ['vi-feu', 'victory', "Feu d'artifice", 'feu', 'rare'], ['vi-eclair', 'victory', 'Foudre', 'eclair', 'epique'],
    ['vi-galaxie', 'victory', "Pluie d'étoiles", 'galaxie', 'epique'], ['vi-or', 'victory', "Pluie d'or", 'or', 'legendaire'],
  ].map(([id, kind, name, effect, rarity], position) => ({ id, kind, name, effect, rarity, price: PRICE[rarity], in_shop: false, position }));
  const chests = [{ id: 'wuhu', name: 'Coffre de Wuhu', price: 60, w_commun: 60, w_rare: 28, w_epique: 10, w_legendaire: 2 }];
  let ownedItems = [['u1', 'fr-feu'], ['u1', 'ti-feu'], ['u1', 'vi-feu']];
  const SLOT = { frame: 'item_frame', banner: 'item_banner', title: 'item_title', victory: 'item_victory' };
  let ledger = [];
  let gallery = [];
  let compRegs = [];
  const settings = {};
  let lid = 1;
  const addL = (user_id, rubis, points, reason, tournament_id = null) =>
    ledger.push({ id: lid++, user_id, rubis, points, reason, tournament_id, created_at: new Date(Date.now() - lid * 3600e3).toISOString() });
  members.forEach((m, i) => addL(m.id, 10 + ((i * 37) % 90), 15 + ((i * 53) % 140), 'Points de départ (démo)'));
  addL('u0', 100, 0, 'Cadeau de bienvenue');
  const me = members[Number(new URLSearchParams(location.search).get('as')) || 0];
  const db = {
    tournaments: [
      { id: 't1', image_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="%2334bdf0"/><circle cx="200" cy="100" r="50" fill="%23d7f542"/></svg>', name: 'Coupe de tennis de Wuhu', game: 'Wii Sports Resort – Tennis', description: 'Matchs en 1 set. Rendez-vous sur le vocal !', format: 'single', status: 'open', max_players: 16, starts_at: null, bracket: null, winner_id: null, created_at: '2026-11-15' },
      { id: 't2', name: 'Tournoi de sabre', game: 'Wii Sports Resort – Duel', description: 'Double élimination : tout le monde a une seconde chance.', format: 'double', status: 'open', max_players: null, starts_at: null, bracket: null, winner_id: null, created_at: '2026-11-10' },
    ],
    participants: [],
    competitions: [{ id: 'c1', name: 'Wuhu Contest 3', description: 'La grande journée de compétition de l\'île : 4 tournois !', image_url: null, starts_at: '2026-12-06T14:00:00Z', created_at: '2026-11-16' }],
  };
  db.tournaments.forEach(t => { t.competition_id = 'c1'; });
  db.tournaments.push({ id: 't3', name: 'Mario Kart – Coupe Champignon', game: 'Mario Kart Wii', description: null, format: 'single', status: 'open', max_players: null, starts_at: null, bracket: null, winner_id: null, created_at: '2026-11-12', competition_id: null });
  ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].forEach((u, i) => db.participants.push({ tournament_id: 't1', user_id: u, joined_at: '2026-11-1' + i }));
  ['u0', 'u1', 'u2', 'u3', 'u4', 'u7', 'u8'].forEach((u, i) => db.participants.push({ tournament_id: 't2', user_id: u, joined_at: '2026-11-1' + i }));
  const prof = id => members.find(m => m.id === id);
  const subs = new Set();
  const notify = () => subs.forEach(f => f());
  const clone = x => structuredClone(x);

  return {
    async init() { return clone(me); },
    signIn() { alert('Mode démo : remplis config.js pour activer la vraie connexion Discord.'); },
    signOut() { location.reload(); },
    async listTournaments() {
      return clone(db.tournaments).map(t => ({ ...t, participants: [{ count: db.participants.filter(p => p.tournament_id === t.id).length }] }));
    },
    async getTournament(id) { return clone(db.tournaments.find(t => t.id === id) ?? null); },
    async listParticipants(tid) {
      return db.participants.filter(p => p.tournament_id === tid).map(p => ({ ...clone(p), profile: clone(prof(p.user_id)) }));
    },
    async join(tid, uid) { db.participants.push({ tournament_id: tid, user_id: uid, joined_at: new Date().toISOString() }); notify(); },
    async leave(tid, uid) { db.participants = db.participants.filter(p => !(p.tournament_id === tid && p.user_id === uid)); notify(); },
    async createTournament(t) {
      const x = { id: 't' + Date.now(), status: 'open', bracket: null, winner_id: null, created_at: new Date().toISOString(), ...t };
      db.tournaments.unshift(x); return clone(x);
    },
    async updateTournament(id, patch) { Object.assign(db.tournaments.find(t => t.id === id), clone(patch)); notify(); },
    async deleteTournament(id) { db.tournaments = db.tournaments.filter(t => t.id !== id); db.participants = db.participants.filter(p => p.tournament_id !== id); },
    async listMembers() { return clone(members); },
    async listRoles() { return clone(roles).sort((a, b) => a.position - b.position); },
    async saveRoles(rows) { rows.forEach(r => { const i = roles.findIndex(x => x.id === r.id); if (i >= 0) roles[i] = { ...r }; else roles.push({ ...r }); }); },
    async deleteRole(id) { roles = roles.filter(r => r.id !== id); },
    async getProfile(id) { return clone(prof(id) ?? null); },
    async userStats(id) {
      return db.participants.filter(p => p.user_id === id).map(p => clone(db.tournaments.find(t => t.id === p.tournament_id))).filter(Boolean);
    },
    async listCompetitions() {
      return clone(db.competitions).map(c => ({ ...c, tournaments: db.tournaments.filter(t => t.competition_id === c.id).map(t => ({ id: t.id, name: t.name, status: t.status, winner_id: t.winner_id })) }));
    },
    async getCompetition(id) { return clone(db.competitions.find(c => c.id === id) ?? null); },
    async createCompetition(c) { const x = { id: 'c' + Date.now(), created_at: new Date().toISOString(), ...c }; db.competitions.unshift(x); return clone(x); },
    async updateCompetition(id, patch) { Object.assign(db.competitions.find(c => c.id === id), clone(patch)); },
    async deleteCompetition(id) { db.competitions = db.competitions.filter(c => c.id !== id); db.tournaments.forEach(t => { if (t.competition_id === id) t.competition_id = null; }); },
    async tournamentsOf(cid) {
      return clone(db.tournaments.filter(t => t.competition_id === cid)).map(t => ({ ...t, participants: [{ count: db.participants.filter(p => p.tournament_id === t.id).length }] }));
    },
    async ledgerForTournaments(ids) { return clone(ledger.filter(l => ids.includes(l.tournament_id))); },
    async uploadImage(file, folder) {
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      if (folder === 'galerie') gallery.unshift({ name: file.name, path: 'galerie/' + file.name + Date.now(), url });
      return url;
    },
    async listGallery() { return clone(gallery); },
    async deleteImage(path) { gallery = gallery.filter(g => g.path !== path); },
    async getTheme() { return clone(settings); },
    async compMembers(cid) { return clone(compRegs.filter(r => r.competition_id === cid)); },
    async joinCompetition(cid, uid = me.id) {
      if (!compRegs.some(r => r.competition_id === cid && r.user_id === uid)) compRegs.push({ competition_id: cid, user_id: uid, joined_at: new Date().toISOString() });
      const full = [];
      db.tournaments.filter(t => t.competition_id === cid && t.status === 'open').forEach(t => {
        if (db.participants.some(p => p.tournament_id === t.id && p.user_id === uid)) return;
        const n = db.participants.filter(p => p.tournament_id === t.id).length;
        if (t.max_players && n >= t.max_players) full.push(t.name);
        else db.participants.push({ tournament_id: t.id, user_id: uid, joined_at: new Date().toISOString() });
      });
      notify(); return { full };
    },
    async addGuest(name, tid, cid) {
      const g = { id: 'g' + Date.now() + Math.random().toString(36).slice(2, 6), username: name.trim(), avatar_url: null, roles: [], in_guild: true, is_admin: false, name_color: null, is_guest: true };
      members.push(g);
      if (tid) db.participants.push({ tournament_id: tid, user_id: g.id, joined_at: new Date().toISOString() });
      if (cid) await this.joinCompetition(cid, g.id);
      notify(); return g.id;
    },
    async deleteGuest(gid) {
      const i = members.findIndex(m => m.id === gid && m.is_guest); if (i >= 0) members.splice(i, 1);
      db.participants = db.participants.filter(p => p.user_id !== gid);
      compRegs = compRegs.filter(r => r.user_id !== gid);
    },
    async leaveCompetition(cid) {
      compRegs = compRegs.filter(r => !(r.competition_id === cid && r.user_id === me.id));
      const open = new Set(db.tournaments.filter(t => t.competition_id === cid && t.status === 'open').map(t => t.id));
      db.participants = db.participants.filter(p => !(p.user_id === me.id && open.has(p.tournament_id)));
    },
    async saveSetting(key, value) { settings[key] = clone(value); },
    async reportScore(tid, mid, w, s0, s1) {
      const t = db.tournaments.find(x => x.id === tid);
      t.bracket.results[mid] = { w, s: s0 == null && s1 == null ? null : [s0 || 0, s1 || 0], by: me.id };
      const r = resolveBracket(t.bracket);
      t.status = r.champion ? 'done' : 'running'; t.winner_id = r.champion ?? null;
      notify(); return { champion: r.champion ?? null };
    },
    async balances() {
      return members.map(m => ({
        user_id: m.id,
        rubis: ledger.filter(l => l.user_id === m.id).reduce((a, l) => a + l.rubis, 0),
        points: ledger.filter(l => l.user_id === m.id).reduce((a, l) => a + l.points, 0),
      }));
    },
    async ledger(uid, limit = 30) {
      return clone(ledger.filter(l => l.user_id === uid).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit));
    },
    async addLedger(rows) { rows.forEach(r => addL(r.user_id, r.rubis || 0, r.points || 0, r.reason, r.tournament_id || null)); },
    async clearTournamentRewards(tid) { ledger = ledger.filter(l => l.tournament_id !== tid); },
    async listColors() { return clone(colors); },
    async listOwned(uid) { return owned.filter(o => o[0] === uid).map(o => o[1]); },
    async buyColor(id) {
      const c = colors.find(x => x.id === id);
      const bal = ledger.filter(l => l.user_id === me.id).reduce((a, l) => a + l.rubis, 0);
      if (owned.some(o => o[0] === me.id && o[1] === id)) throw new Error('Tu as déjà cette couleur');
      if (bal < c.price) throw new Error('Pas assez de rubis');
      addL(me.id, -c.price, 0, 'Achat : couleur ' + id);
      owned.push([me.id, id]); me.name_color = id;
    },
    async equipColor(id) { me.name_color = id; },
    async listItems() { return clone(items); },
    async listOwnedItems(uid) { return ownedItems.filter(o => o[0] === uid).map(o => o[1]); },
    async listChests() { return clone(chests); },
    async buyItem(id) {
      const it = items.find(x => x.id === id);
      const bal = ledger.filter(l => l.user_id === me.id).reduce((a, l) => a + l.rubis, 0);
      if (bal < it.price) throw new Error('Pas assez de rubis');
      addL(me.id, -it.price, 0, 'Achat : ' + it.name); ownedItems.push([me.id, id]); me[SLOT[it.kind]] = id;
    },
    async equipItem(kind, id) { me[SLOT[kind]] = id; },
    async openChest(cid) {
      const c = chests.find(x => x.id === cid);
      const bal = ledger.filter(l => l.user_id === me.id).reduce((a, l) => a + l.rubis, 0);
      if (bal < c.price) throw new Error('Pas assez de rubis');
      const rar = (r => r < c.w_commun ? 'commun' : r < c.w_commun + c.w_rare ? 'rare' : r < c.w_commun + c.w_rare + c.w_epique ? 'epique' : 'legendaire')(Math.random() * 100);
      const cr = p => p <= 80 ? 'commun' : p <= 140 ? 'rare' : p <= 220 ? 'epique' : 'legendaire';
      const pool = [...items.filter(i => i.rarity === rar), ...colors.filter(x => cr(x.price) === rar).map(x => ({ ...x, kind: 'pseudo' }))];
      const it = pool[Math.floor(Math.random() * pool.length)];
      addL(me.id, -c.price, 0, 'Ouverture : ' + c.name);
      const list = it.kind === 'pseudo' ? owned : ownedItems;
      const dup = list.some(o => o[0] === me.id && o[1] === it.id);
      const refund = dup ? { commun: 10, rare: 25, epique: 50, legendaire: 100 }[rar] : 0;
      if (dup) addL(me.id, refund, 0, 'Doublon recyclé : ' + it.name); else list.push([me.id, it.id]);
      return { kind: it.kind, id: it.id, name: it.name, effect: it.effect, rarity: rar, duplicate: dup, refund };
    },
    subscribe(tid, cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}

export const api = DEMO ? demoApi() : await supabaseApi();
