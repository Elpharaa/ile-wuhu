// =====================================================================
//  Accès aux données : Supabase (vrai site) ou mode démo (si config.js
//  n'est pas encore rempli, pour voir le site tout de suite).
// =====================================================================
import { CONFIG } from './config.js';
import { resolveBracket } from './bracket.js?v=20261119p';

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
    // ----- Équipes (2 contre 2) -----
    listTeams: async tid => ok(await sb.from('wuhu_teams').select('*').eq('tournament_id', tid).order('created_at')),
    createTeam: async (tid, name, members) => ok(await sb.from('wuhu_teams').insert({ tournament_id: tid, name, members })),
    deleteTeam: async id => ok(await sb.from('wuhu_teams').delete().eq('id', id)),
    renameTeam: async (id, name) => ok(await sb.rpc('wuhu_rename_team', { p_team: id, p_name: name })),
    // ----- Réactions sur les matchs -----
    listReactions: async tid => ok(await sb.from('wuhu_match_reactions').select('match_id, user_id, emoji').eq('tournament_id', tid)),
    listDuels: async uid => {
      let q = sb.from('wuhu_duels').select('id, challenger, opponent, game, winner, done_at').eq('status', 'done').order('done_at', { ascending: false }).limit(500);
      if (uid) q = q.or(`challenger.eq.${uid},opponent.eq.${uid}`);
      return ok(await q);
    },
    // ----- Défis amicaux (aussi lancés depuis Discord avec /defi) -----
    myDuels: async () => ok(await sb.rpc('wuhu_my_duels')),
    createDuel: async (opp, game) => ok(await sb.rpc('wuhu_duel_create', { p_opponent: opp, p_game: game || null })),
    duelAct: async (id, action, winnerD) => ok(await sb.rpc('wuhu_duel_act', { p_id: id, p_action: action, p_winner_d: winnerD || null })),
    react: async (tid, mid, uid, emoji, on) => ok(on
      ? await sb.from('wuhu_match_reactions').insert({ tournament_id: tid, match_id: mid, user_id: uid, emoji })
      : await sb.from('wuhu_match_reactions').delete().eq('tournament_id', tid).eq('match_id', mid).eq('user_id', uid).eq('emoji', emoji)),
    // ----- Quiz du jour -----
    quizByDay: async day => ok(await sb.from('wuhu_quiz_questions').select('*').eq('day', day).maybeSingle()),
    myQuizAnswer: async (qid, uid) => ok(await sb.from('wuhu_quiz_answers').select('*').eq('question_id', qid).eq('user_id', uid).maybeSingle()),
    quizAnswer: async (qid, choice) => ok(await sb.rpc('wuhu_quiz_answer', { p_question: qid, p_choice: choice })),
    quizResult: async qid => ok(await sb.rpc('wuhu_quiz_result', { p_question: qid })),
    quizBoard: async () => ok(await sb.rpc('wuhu_quiz_board')),
    quizList: async () => ok(await sb.from('wuhu_quiz_questions').select('*, key:wuhu_quiz_keys(answer, explanation)').order('day', { ascending: false, nullsFirst: false })),
    quizSave: async q => ok(await sb.rpc('wuhu_quiz_save', { p_id: q.id || null, p_day: q.day || null, p_question: q.question, p_choices: q.choices, p_answer: q.answer, p_reward: q.reward, p_image: q.image_url || null, p_explanation: q.explanation || null })),
    quizDelete: async id => ok(await sb.from('wuhu_quiz_questions').delete().eq('id', id)),
    // ----- Photos des events (envoyées par les membres) -----
    listPhotos: async cid => ok(await sb.from('wuhu_photos').select('*, likes:wuhu_photo_likes(user_id)').eq('competition_id', cid).order('created_at', { ascending: false })),
    async addPhoto(cid, uid, blob, caption) {
      const path = `photos/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      ok(await sb.storage.from('wuhu').upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
      const url = sb.storage.from('wuhu').getPublicUrl(path).data.publicUrl;
      return ok(await sb.from('wuhu_photos').insert({ competition_id: cid, user_id: uid, path, url, caption: caption || null }).select().single());
    },
    async deletePhoto(ph) {
      await sb.storage.from('wuhu').remove([ph.path]);
      ok(await sb.from('wuhu_photos').delete().eq('id', ph.id));
    },
    likePhoto: async (pid, uid, on) => ok(on ? await sb.from('wuhu_photo_likes').insert({ photo_id: pid, user_id: uid })
      : await sb.from('wuhu_photo_likes').delete().eq('photo_id', pid).eq('user_id', uid)),

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
    reportFfa: async (tid, mid, rank) => ok(await sb.rpc('wuhu_report_ffa', { p_tid: tid, p_mid: mid, p_rank: rank })),
    reportScore: async (tid, mid, winner, s0, s1) =>
      ok(await sb.rpc('wuhu_report_score', { p_tid: tid, p_mid: mid, p_winner: winner, p_s0: s0, p_s1: s1 })),

    // ----- Rubis, points, couleurs -----
    balances: async () => ok(await sb.from('wuhu_balances').select('*')),
    // ----- Blind test Nintendo (extraits YouTube) -----
    btToday: async day => ok(await sb.from('wuhu_bt_tracks').select('id, day, youtube_id, start_s, duration_s, choices, reward').eq('day', day).maybeSingle()),
    btPool: async day => ok(await sb.from('wuhu_bt_tracks').select('id, youtube_id, start_s, duration_s, choices').or(`day.is.null,day.lt.${day}`)),
    btAnswer: async (id, choice) => ok(await sb.rpc('wuhu_bt_answer', { p_track: id, p_choice: choice })),
    btResult: async id => ok(await sb.rpc('wuhu_bt_result', { p_track: id })),
    btCheck: async (run, id, choice) => ok(await sb.rpc('wuhu_bt_check', { p_run: run, p_track: id, p_choice: choice })),
    btFinish: async run => ok(await sb.rpc('wuhu_bt_finish', { p_run: run })),
    btBest: async () => ok(await sb.from('wuhu_bt_best').select('*').order('best', { ascending: false }).order('at').limit(10)),
    btList: async () => ok(await sb.from('wuhu_bt_tracks').select('*, key:wuhu_bt_keys(answer, title, explanation)').order('day', { ascending: true, nullsFirst: false }).order('created_at')),
    btSave: async t => ok(await sb.rpc('wuhu_bt_save', { p_id: t.id || null, p_day: t.day || null, p_youtube: t.youtube_id, p_start: t.start_s, p_duration: t.duration_s,
      p_choices: t.choices, p_answer: t.answer, p_title: t.title || '', p_explanation: t.explanation || '', p_reward: t.reward })),
    btDelete: async id => ok(await sb.rpc('wuhu_bt_delete', { p_id: id })),
    // Blind test multijoueur (salons en temps réel)
    btRoomCreate: async total => ok(await sb.rpc('wuhu_bt_room_create', { p_total: total })),
    btRoomJoin: async code => ok(await sb.rpc('wuhu_bt_room_join', { p_code: code })),
    btRoomLeave: async id => ok(await sb.rpc('wuhu_bt_room_leave', { p_room: id })),
    btRoomStart: async id => ok(await sb.rpc('wuhu_bt_room_start', { p_room: id })),
    btRoomState: async id => ok(await sb.rpc('wuhu_bt_room_state', { p_room: id })),
    btRoomAnswer: async (id, idx, choice) => ok(await sb.rpc('wuhu_bt_room_answer', { p_room: id, p_idx: idx, p_choice: choice })),
    btRoomReveal: async (id, idx) => ok(await sb.rpc('wuhu_bt_room_reveal', { p_room: id, p_idx: idx })),
    btRoomNext: async (id, idx) => ok(await sb.rpc('wuhu_bt_room_next', { p_room: id, p_idx: idx })),
    btRoomByCode: async code => ok(await sb.from('wuhu_bt_rooms').select('id, status').eq('code', code.toUpperCase()).in('status', ['lobby', 'playing', 'done']).order('created_at', { ascending: false }).limit(1).maybeSingle()),
    btRoomSubscribe(id, cb) {
      const ch = sb.channel('bt-' + id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wuhu_bt_rooms', filter: `id=eq.${id}` }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wuhu_bt_room_players', filter: `room_id=eq.${id}` }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'wuhu_bt_room_tries', filter: `room_id=eq.${id}` }, cb)
        .subscribe();
      return () => sb.removeChannel(ch);
    },
    // Accueil des nouveaux (cadeau donné une seule fois) et saisons mensuelles
    welcome: async () => ok(await sb.rpc('wuhu_welcome')),
    seasonBoard: async month => ok(await sb.rpc('wuhu_season_board', month ? { p_month: month } : {})),
    seasons: async () => ok(await sb.from('wuhu_seasons').select('*').order('month', { ascending: false }).limit(12)),
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
    // ----- Récompense du jour et succès -----
    getDaily: async uid => ok(await sb.from('wuhu_daily').select('*').eq('user_id', uid).maybeSingle()),
    claimDaily: async () => ok(await sb.rpc('wuhu_claim_daily')),
    listAchievements: async () => ok(await sb.from('wuhu_achievements').select('*').order('position')),
    achievementsDone: async uid => ok(await sb.from('wuhu_achievements_done').select('achievement_id, done_at').eq('user_id', uid)),
    myStats: async () => ok(await sb.rpc('wuhu_my_stats')),
    claimAchievement: async id => ok(await sb.rpc('wuhu_claim_achievement', { p_id: id })),

    // Qui est sur le site en ce moment (présence en temps réel, rien n'est stocké)
    presence(uid, cb) {
      const ch = sb.channel('wuhu-ile', { config: { presence: { key: uid } } });
      ch.on('presence', { event: 'sync' }, () => cb(Object.keys(ch.presenceState())))
        .subscribe(async st => { if (st === 'SUBSCRIBED') await ch.track({ at: Date.now() }); });
      return () => sb.removeChannel(ch);
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
  let daily = { user_id: 'u0', last_claim: new Date(Date.now() - 864e5).toISOString().slice(0, 10), streak: 3, best_streak: 3 };
  const achievements = [
    ['bienvenue', "Bienvenue sur l'île", 'Te connecter au site', '🏝️', 'login', 1, 10], ['tournoi-1', 'Premier tournoi', 'Jouer 1 tournoi', '🎮', 'played', 1, 15],
    ['tournoi-5', 'Habitué', 'Jouer 5 tournois', '🎯', 'played', 5, 40], ['match-1', 'Première victoire', 'Gagner 1 match', '⚔️', 'mwins', 1, 10],
    ['match-10', 'Combattant', 'Gagner 10 matchs', '🥊', 'mwins', 10, 50], ['titre-1', 'Champion', 'Remporter 1 tournoi', '🏆', 'titles', 1, 60],
    ['coffre-1', 'Chasseur de trésor', 'Ouvrir 1 coffre', '🎁', 'chests', 1, 10], ['collec-10', 'Collectionneur', 'Posséder 10 objets ou effets', '🧺', 'collection', 10, 30],
    ['collec-all', 'Collection complète', 'Posséder tous les objets et effets', '💎', 'collection', 0, 300], ['fidele-7', 'Fidèle', "Récompense du jour 7 jours d'affilée", '📅', 'streak', 7, 50],
  ].map(([id, name, description, icon, metric, goal, reward], position) => ({ id, name, description, icon, metric, goal, reward, position }));
  const achDone = [['u0', 'bienvenue'], ['u1', 'bienvenue'], ['u1', 'match-1']];
  const SLOT = { frame: 'item_frame', banner: 'item_banner', title: 'item_title', victory: 'item_victory' };
  let ledger = [];
  let gallery = [];
  const dayStr = d => new Date(Date.now() + d * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  let quiz = [
    { id: 'q1', day: dayStr(0), question: 'Dans Wii Sports Resort, comment s\'appelle l\'île où se déroulent les sports ?', choices: ['Isle Delfino', 'L\'île Wuhu', 'L\'île Pikmin', 'Koholint'], reward: 10, key: { answer: 1, explanation: 'L\'île Wuhu apparaît dans Wii Fit, Wii Sports Resort et Pilotwings Resort.' } },
    { id: 'qb1', day: null, question: 'Quelle console est sortie en 2006 ?', choices: ['GameCube', 'Wii', 'Wii U'], reward: 10, key: { answer: 1, explanation: null } },
    { id: 'q2', day: dayStr(1), question: 'Quel est le vrai nom de Toad ?', choices: ['Toad', 'Kinopio', 'Toadsworth'], reward: 15, key: { answer: 0 } },
  ];
  let quizAns = [];
  let teams = [];
  const duels = [
    { id: 'd1', challenger: 'u1', opponent: 'u0', game: 'Mario Kart 8', winner: 'u0', done_at: new Date(Date.now() - 864e5).toISOString() },
    { id: 'd2', challenger: 'u0', opponent: 'u2', game: null, winner: 'u2', done_at: new Date(Date.now() - 2 * 864e5).toISOString() },
  ];
  const ago = m => new Date(Date.now() - m * 6e4).toISOString();
  const dn = (...ids) => Object.fromEntries(ids.map(i => ['D-' + i, { n: members[+i.slice(1)].username, a: members[+i.slice(1)].avatar_url }]));
  const live = [
    { id: 'dl1', challenger: 'u2', opponent: 'u0', challenger_d: 'D-u2', opponent_d: 'D-u0', game: 'Mario Kart 8 Deluxe', status: 'pending', created_at: ago(12), names: dn('u2', 'u0') },
    { id: 'dl2', challenger: 'u0', opponent: 'u3', challenger_d: 'D-u0', opponent_d: 'D-u3', game: 'Smash Bros. Ultimate', status: 'accepted', accepted_at: ago(30), created_at: ago(40), names: dn('u0', 'u3') },
    { id: 'dl3', challenger: 'u4', opponent: 'u0', challenger_d: 'D-u4', opponent_d: 'D-u0', game: 'Ping-pong (en vrai)', status: 'claimed', claimed_by_d: 'D-u4', winner_d: 'D-u4', accepted_at: ago(90), created_at: ago(100), names: dn('u4', 'u0') },
    { id: 'dl4', challenger: 'u0', opponent: 'u1', challenger_d: 'D-u0', opponent_d: 'D-u1', game: 'Splatoon 3', status: 'done', winner_d: 'D-u0', reward_w: 10, reward_l: 3, done_at: ago(600), created_at: ago(700), names: dn('u0', 'u1') },
  ];
  const parisDayDemo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const btAns = new Map();
  let demoRoom = null; const roomSubs = new Set(); const roomPing = () => roomSubs.forEach(f => f());
  const demoRound = () => { const r = demoRoom; r.round_started_at = new Date(Date.now() + 3000).toISOString(); r.round_closed = false; r.round_winner = null; roomPing();
    const i = r.idx; setTimeout(() => { if (r.idx !== i || r.round_closed) return; r.tries.push({ idx: i, user_id: 'u4', correct: false }); roomPing(); }, 5500);
    setTimeout(() => { if (r.idx !== i || r.round_closed) return; if (i % 2) { r.tries.push({ idx: i, user_id: 'u2', correct: true }); if (!r.round_winner) { r.players.find(p => p.user_id === 'u2').score++; r.round_winner = 'u2'; } roomPing(); } }, 7000); };
  const btTracks = [
    { id: 'bt1', day: parisDayDemo(), youtube_id: 'aaaaaaaaaaa', start_s: 12, duration_s: 20, reward: 15, choices: ['Super Mario Galaxy', 'Super Mario 64', 'Super Mario Sunshine', 'Super Mario Odyssey'],
      key: { answer: 0, title: 'Gusty Garden Galaxy · Super Mario Galaxy', explanation: 'Composée par Mahito Yokota, c\'est l\'un des thèmes les plus célèbres de la série.' } },
    ...['Zelda: Ocarina of Time', 'Mario Kart 8', 'Animal Crossing', 'Kirby', 'Pokémon Rouge', 'Wii Sports', 'Splatoon', 'Metroid Prime', 'Smash Bros.', 'Donkey Kong Country', 'Wii Sports Resort']
      .map((g, i) => ({ id: 'bb' + i, day: null, youtube_id: 'bbbbbbbbbb' + (i % 10), start_s: 5, duration_s: 15, reward: 0,
        choices: [g, 'Super Mario Sunshine', 'Pikmin', 'F-Zero'], key: { answer: 0, title: 'Thème principal · ' + g, explanation: null } })),
  ];
  let reactions = [['u1', '🔥'], ['u2', '🔥'], ['u3', '😂'], ['u4', '🔥'], ['u5', '😱']].map(([user_id, emoji]) => ({ tournament_id: 't2', match_id: 'W1-0', user_id, emoji }));
  const demoImg = (h, e) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="hsl(${h},70%,60%)"/><text x="200" y="175" font-size="90" text-anchor="middle">${e}</text></svg>`);
  let photos = [['🎳', 200, 'La finale de bowling !', ['u1', 'u2', 'u3']], ['🍕', 30, 'Pause pizza', ['u2']], ['🏆', 50, 'Les champions', ['u1', 'u2', 'u3', 'u4', 'u5']], ['🎮', 260, null, []], ['🎾', 120, 'Match serré', ['u4']]]
    .map(([e, h, caption, likes], i) => ({ id: 'ph' + i, competition_id: 'c1', user_id: 'u' + (i + 1), path: 'x', url: demoImg(h, e), caption, created_at: new Date(Date.now() - i * 3e6).toISOString(), likes: likes.map(user_id => ({ user_id })) }));
  let compRegs = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'].map((user_id, i) => ({ competition_id: 'c1', user_id, joined_at: '2026-11-1' + i }));
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
    competitions: [{ id: 'c1', name: 'Wuhu Contest 3', description: 'La grande journée de compétition de l\'île : 4 tournois !', image_url: null, starts_at: '2026-12-06T14:00:00Z', created_at: '2026-11-16', party_images: [{ url: demoImg(40, '🍄'), size: 'm' }, { url: demoImg(200, '⭐'), size: 'l' }, { url: demoImg(120, '🎮'), size: 's' }] }],
  };
  db.tournaments.forEach(t => { t.competition_id = 'c1'; });
  db.competitions.push({ id: 'c0', name: 'Wuhu Contest 2', description: null, image_url: null, starts_at: '2026-10-04T14:00:00Z', created_at: '2026-09-20' });
  db.tournaments.push({ id: 't8', name: 'Bowling', game: 'Wii Sports', format: 'single', status: 'done', bracket: null, winner_id: 'u1', created_at: '2026-10-04', competition_id: 'c0' },
    { id: 't9', name: 'Tennis', game: 'Wii Sports', format: 'single', status: 'done', bracket: null, winner_id: 'u2', created_at: '2026-10-04', competition_id: 'c0' });
  [['u1', 't8', 60], ['u1', 't9', 20], ['u2', 't9', 60], ['u2', 't8', 10], ['u3', 't8', 25], ['u0', 't9', 30]].forEach(([u, t, n]) => addL(u, 0, n, 'Démo', t));
  db.tournaments.push({ id: 't3', name: 'Mario Kart – Coupe Champignon', game: 'Mario Kart Wii', description: null, format: 'single', team_size: 2, status: 'open', max_players: null, starts_at: null, bracket: null, winner_id: null, created_at: '2026-11-12', competition_id: null });
  ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].forEach((u, i) => db.participants.push({ tournament_id: 't3', user_id: u, joined_at: '2026-11-0' + i }));
  db.tournaments.push({ id: 't4', name: 'Mario Party – Soirée étoiles', game: 'Mario Party 9', description: 'Chacun pour soi : les 2 premiers de chaque partie passent.', format: 'ffa4', team_size: 1, status: 'open', max_players: null, starts_at: null, bracket: null, winner_id: null, created_at: '2026-11-13', competition_id: null });
  ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].forEach((u, i) => db.participants.push({ tournament_id: 't4', user_id: u, joined_at: '2026-11-0' + i }));
  teams.push({ id: 'tmA', tournament_id: 't3', name: 'Les Mii Furieux', members: ['u0', 'u1'], created_at: '1' }, { id: 'tmB', tournament_id: 't3', name: 'Équipe Banane', members: ['u2', 'u3'], created_at: '2' }, { id: 'tmC', tournament_id: 't3', name: 'Turbo Champis', members: ['u4', 'u5'], created_at: '3' });
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
    async listTeams(tid) { return clone(teams.filter(x => x.tournament_id === tid)); },
    async createTeam(tid, name, members) { teams.push({ id: 'tm' + Date.now() + Math.floor(Math.random() * 1e4), tournament_id: tid, name, members, created_at: new Date().toISOString() }); },
    async deleteTeam(id) { teams = teams.filter(x => x.id !== id); },
    async renameTeam(id, name) {
      const x = teams.find(y => y.id === id); if (x) x.name = name;
      const t = db.tournaments.find(y => y.bracket?.teams?.[id]); if (t) t.bracket.teams[id].name = name;
    },
    async listReactions(tid) { return clone(reactions.filter(r => r.tournament_id === tid)); },
    async listDuels(uid) { return clone(duels.filter(d => !uid || d.challenger === uid || d.opponent === uid)); },
    async myDuels() { return { me: 'D-u0', duels: clone(live) }; },
    async createDuel(opp, game) {
      const o = prof(opp); if (!o || o.is_guest) throw new Error('Ce membre ne peut pas être défié');
      if (live.some(d => ['pending', 'accepted', 'claimed'].includes(d.status) && [d.challenger, d.opponent].includes(opp))) throw new Error('Vous avez déjà un défi en cours tous les deux : terminez-le d\'abord !');
      const d = { id: 'dl' + Date.now(), challenger: 'u0', opponent: opp, challenger_d: 'D-u0', opponent_d: 'D-' + opp, game: game || null, status: 'pending', created_at: new Date().toISOString(),
        names: { 'D-u0': { n: prof('u0').username, a: prof('u0').avatar_url }, ['D-' + opp]: { n: o.username, a: o.avatar_url } } };
      live.unshift(d); return clone(d);
    },
    async duelAct(id, action, w) {
      const d = live.find(x => x.id === id); const me = 'D-u0';
      if (action === 'acc') Object.assign(d, { status: 'accepted', accepted_at: new Date().toISOString() });
      else if (action === 'dec') d.status = 'declined';
      else if (action === 'can') d.status = 'cancelled';
      else if (action === 'win') Object.assign(d, w === me ? { status: 'claimed', claimed_by_d: me, winner_d: w } : { status: 'done', winner_d: w, done_at: new Date().toISOString(), reward_w: 10, reward_l: 3 });
      else if (action === 'ok') Object.assign(d, { status: 'done', done_at: new Date().toISOString(), reward_w: 10, reward_l: 3 });
      else if (action === 'no') Object.assign(d, { status: 'accepted', claimed_by_d: null, winner_d: null });
      return { status: d.status, reward: d.status === 'done' ? { win: 10, lose: 3, note: null } : null };
    },
    async react(tid, mid, uid, emoji, on) {
      reactions = reactions.filter(r => !(r.tournament_id === tid && r.match_id === mid && r.user_id === uid && r.emoji === emoji));
      if (on) reactions.push({ tournament_id: tid, match_id: mid, user_id: uid, emoji });
    },
    async quizByDay(day) { const q = quiz.find(x => x.day === day); return q ? { ...clone(q), key: undefined } : null; },
    async myQuizAnswer(qid, uid) { return clone(quizAns.find(a => a.question_id === qid && a.user_id === uid) || null); },
    async quizAnswer(qid, choice) {
      const q = quiz.find(x => x.id === qid); const ok2 = choice === q.key.answer;
      quizAns.push({ question_id: qid, user_id: me.id, choice, correct: ok2 });
      if (ok2) addL(me.id, q.reward, 0, 'Quiz du jour : bonne réponse');
      return { correct: ok2, answer: q.key.answer, explanation: q.key.explanation || null, reward: ok2 ? q.reward : 0, total: 7, good: 4 };
    },
    async quizResult(qid) { const q = quiz.find(x => x.id === qid); return { answer: q.key.answer, explanation: q.key.explanation || null, total: 7, good: 4 }; },
    async btToday() { const t = btTracks.find(x => x.day === parisDayDemo()); return t ? clone(t) : null; },
    async btPool() { return clone(btTracks.filter(t => !t.day)); },
    async btAnswer(id, choice) {
      const t = btTracks.find(x => x.id === id); if (btAns.has(id)) throw new Error('Tu as déjà répondu aujourd\'hui');
      const ok = choice === t.key.answer; btAns.set(id, choice);
      return { correct: ok, answer: t.key.answer, title: t.key.title, explanation: t.key.explanation, reward: ok ? t.reward : 0, good: ok ? 4 : 3, total: 6 };
    },
    async btResult(id) { if (!btAns.has(id)) return null; const t = btTracks.find(x => x.id === id), c = btAns.get(id);
      return { choice: c, correct: c === t.key.answer, answer: t.key.answer, title: t.key.title, explanation: t.key.explanation, reward: t.reward, good: 4, total: 6 }; },
    async btCheck(run, id, choice) { const t = btTracks.find(x => x.id === id); return { correct: choice === t.key.answer, answer: t.key.answer, title: t.key.title, explanation: t.key.explanation }; },
    async btFinish() { return { score: 7, total: 10, record: true, previous: 5 }; },
    async btBest() { return [{ user_id: 'u2', best: 9, total: 10 }, { user_id: 'u0', best: 7, total: 10 }, { user_id: 'u4', best: 6, total: 10 }]; },
    async btList() { return clone(btTracks); },
    async btSave(t) { const row = { id: t.id || 'bt' + Date.now(), day: t.day || null, youtube_id: t.youtube_id, start_s: t.start_s, duration_s: t.duration_s, choices: t.choices, reward: t.reward,
      key: { answer: t.answer, title: t.title, explanation: t.explanation } }; const i = btTracks.findIndex(x => x.id === row.id); i >= 0 ? (btTracks[i] = row) : btTracks.push(row); return row.id; },
    async btDelete(id) { const i = btTracks.findIndex(x => x.id === id); if (i >= 0) btTracks.splice(i, 1); },
    // --- salon de démo : deux joueurs fictifs rejoignent et répondent tout seuls ---
    async btRoomCreate(total) { const id = 'room1'; demoRoom = { id, code: 'WUHU', host: 'u0', status: 'lobby', total, tracks: [], idx: 0, round_started_at: null, round_closed: false, round_winner: null, rewards: null,
      players: [{ user_id: 'u0', score: 0 }], tries: [] };
      setTimeout(() => { demoRoom.players.push({ user_id: 'u2', score: 0 }); roomPing(); }, 900);
      setTimeout(() => { demoRoom.players.push({ user_id: 'u4', score: 0 }); roomPing(); }, 1600); return id; },
    async btRoomJoin() { return demoRoom?.id || this.btRoomCreate(10); },
    async btRoomByCode() { return demoRoom ? { id: demoRoom.id, status: demoRoom.status } : null; },
    async btRoomLeave() { demoRoom = null; },
    async btRoomStart() { const r = demoRoom; r.tracks = btTracks.filter(t => !t.day).slice(0, Math.min(r.total, 4)).map(t => t.id); r.status = 'playing'; r.idx = 0; demoRound(); },
    async btRoomState() { const r = demoRoom; if (!r) return null; const t = r.status === 'playing' ? btTracks.find(x => x.id === r.tracks[r.idx]) : null;
      return clone({ room: { ...r, players: undefined, tries: undefined, tracks: undefined }, now: new Date().toISOString(), count: r.tracks.length,
        track: t && { id: t.id, youtube_id: t.youtube_id, start_s: t.start_s, duration_s: 8, choices: t.choices }, players: [...r.players].sort((a, b) => b.score - a.score), tries: r.tries.filter(x => x.idx === r.idx) }); },
    async btRoomAnswer(id, idx, choice) { const r = demoRoom, t = btTracks.find(x => x.id === r.tracks[idx]); if (r.round_closed) return { late: true };
      const ok = choice === t.key.answer; r.tries.push({ idx, user_id: 'u0', correct: ok }); const first = ok && !r.round_winner; if (first) { r.players.find(p => p.user_id === 'u0').score++; r.round_winner = 'u0'; } roomPing(); return { correct: ok, first, winner: r.round_winner, secs: 2.4 }; },
    async btRoomReveal(id, idx) { const r = demoRoom, t = btTracks.find(x => x.id === r.tracks[idx]); r.round_closed = true; return { answer: t.key.answer, title: t.key.title, winner: r.round_winner }; },
    async btRoomNext(id, idx) { const r = demoRoom; if (r.idx !== idx || r.status !== 'playing') return; if (r.idx + 1 < r.tracks.length) { r.idx++; demoRound(); }
      else { r.status = 'done'; r.rewards = [...r.players].sort((a, b) => b.score - a.score).slice(0, 3).map((p, i) => ({ user_id: p.user_id, rank: i + 1, rubis: [15, 8, 4][i] })); roomPing(); } },
    btRoomSubscribe(id, cb) { roomSubs.add(cb); return () => roomSubs.delete(cb); },
    async welcome() { return /bienvenue-demo/.test(location.hash) ? { new: true, rubis: 50, title: 'Petit nouveau' } : { new: false }; },
    async seasonBoard() { return [{ user_id: 'u2', points: 145 }, { user_id: 'u0', points: 120 }, { user_id: 'u4', points: 95 }, { user_id: 'u1', points: 60 }, { user_id: 'u5', points: 25 }]; },
    async seasons() { return [{ month: '2026-10-01', ranking: [{ user_id: 'u1', points: 210, rank: 1, rubis: 100 }, { user_id: 'u2', points: 180, rank: 2, rubis: 60 }, { user_id: 'u3', points: 90, rank: 3, rubis: 30 }] }]; },
    async quizBoard() { return [{ user_id: 'u2', good: 12, played: 14 }, { user_id: 'u1', good: 10, played: 15 }, { user_id: 'u0', good: 7, played: 9 }, { user_id: 'u5', good: 3, played: 8 }]; },
    async quizList() { return clone(quiz); },
    async quizSave(q) {
      const x = { id: q.id || 'q' + Date.now(), day: q.day || null, question: q.question, choices: q.choices, reward: q.reward, image_url: q.image_url, key: { answer: q.answer, explanation: q.explanation || null } };
      quiz = quiz.filter(y => y.id !== x.id); quiz.push(x); return x.id;
    },
    async quizDelete(id) { quiz = quiz.filter(q => q.id !== id); },
    async listPhotos(cid) { return clone(photos.filter(p => p.competition_id === cid)); },
    async addPhoto(cid, uid, blob, caption) {
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      const ph = { id: 'ph' + Date.now() + Math.random(), competition_id: cid, user_id: uid, path: 'x', url, caption, created_at: new Date().toISOString(), likes: [] };
      photos.unshift(ph); return clone(ph);
    },
    async deletePhoto(ph) { photos = photos.filter(p => p.id !== ph.id); },
    async likePhoto(pid, uid, on) { const p = photos.find(x => x.id === pid); p.likes = p.likes.filter(l => l.user_id !== uid); if (on) p.likes.push({ user_id: uid }); },
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
    async reportFfa(tid, mid, rank) {
      const t = db.tournaments.find(x => x.id === tid);
      t.bracket.results[mid] = { rank, by: me.id };
      const r = resolveBracket(t.bracket);
      t.status = r.champion ? 'done' : 'running'; t.winner_id = r.champion ?? null;
      notify(); return { champion: r.champion ?? null };
    },
    async reportScore(tid, mid, w, s0, s1) {
      const t = db.tournaments.find(x => x.id === tid);
      t.bracket.results[mid] = { w, s: s0 == null && s1 == null ? null : [s0 || 0, s1 || 0], by: me.id };
      const r = resolveBracket(t.bracket);
      t.status = r.champion ? 'done' : 'running';
      if (t.bracket.teams) { t.winner_id = null; t.winner_team = r.champion ?? null; } else t.winner_id = r.champion ?? null;
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
    async getDaily(uid) { return uid === me.id ? clone(daily) : null; },
    async claimDaily() {
      const today = new Date().toISOString().slice(0, 10), y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      if (daily?.last_claim === today) throw new Error("Déjà récupérée aujourd'hui, reviens demain !");
      const streak = daily?.last_claim === y ? daily.streak + 1 : 1;
      const amount = [5, 5, 10, 10, 15, 15, 30][(streak - 1) % 7];
      daily = { user_id: me.id, last_claim: today, streak, best_streak: Math.max(streak, daily?.best_streak || 0) };
      addL(me.id, amount, 0, `Récompense du jour (jour ${streak})`); return { streak, amount };
    },
    async listAchievements() { return clone(achievements); },
    async achievementsDone(uid) { return achDone.filter(a => a[0] === uid).map(a => ({ achievement_id: a[1], done_at: new Date().toISOString() })); },
    async myStats() {
      return { login: 1, played: db.participants.filter(p => p.user_id === me.id).length, titles: 0, mwins: 2,
        chests: ledger.filter(l => l.user_id === me.id && l.reason.startsWith('Ouverture')).length,
        collection: owned.filter(o => o[0] === me.id).length + ownedItems.filter(o => o[0] === me.id).length,
        collection_total: items.length + colors.length, streak: daily?.best_streak || 0 };
    },
    async claimAchievement(id) {
      const a = achievements.find(x => x.id === id); achDone.push([me.id, id]);
      addL(me.id, a.reward, 0, 'Succès : ' + a.name); return { reward: a.reward };
    },
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
    presence(uid, cb) { setTimeout(() => cb([uid, 'u1', 'u2', 'u4', 'u6']), 300); return () => {}; },
  };
}

export const api = DEMO ? demoApi() : await supabaseApi();
