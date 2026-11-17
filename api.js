// =====================================================================
//  Accès aux données : Supabase (vrai site) ou mode démo (si config.js
//  n'est pas encore rempli, pour voir le site tout de suite).
// =====================================================================
import { CONFIG } from './config.js';

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
  const PROFILE_COLS = 'id, username, avatar_url, roles, in_guild, is_admin';

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
        .select('tournament:wuhu_tournaments(id, name, game, status, winner_id, created_at)').eq('user_id', id));
      return parts.map(p => p.tournament).filter(Boolean);
    },

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
    roles: roleSets[i], in_guild: true, is_admin: i === 0,
  }));
  const me = members[0];
  const db = {
    tournaments: [
      { id: 't1', name: 'Coupe de tennis de Wuhu', game: 'Wii Sports Resort – Tennis', description: 'Matchs en 1 set. Rendez-vous sur le vocal !', format: 'single', status: 'open', max_players: 16, starts_at: null, bracket: null, winner_id: null, created_at: '2026-11-15' },
      { id: 't2', name: 'Tournoi de sabre', game: 'Wii Sports Resort – Duel', description: 'Double élimination : tout le monde a une seconde chance.', format: 'double', status: 'open', max_players: null, starts_at: null, bracket: null, winner_id: null, created_at: '2026-11-10' },
    ],
    participants: [],
  };
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
    subscribe(tid, cb) { subs.add(cb); return () => subs.delete(cb); },
  };
}

export const api = DEMO ? demoApi() : await supabaseApi();
