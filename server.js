const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.SKL_DATA_DIR || path.join(ROOT, '.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

if (!USE_SUPABASE) fs.mkdirSync(DATA_DIR, { recursive: true });

const makeId = prefix => prefix + '_' + crypto.randomBytes(7).toString('hex');
const now = () => new Date().toISOString();
const minutesFromNow = min => new Date(Date.now() + min * 60000).toISOString();

const emptyDb = () => ({
  users: [], sessions: [], clubs: [], players: [], leagues: [], members: [],
  invitations: [], fixtures: [], matches: [], events: [], friends: [],
  notifications: [], transactions: [], training: []
});

let db = emptyDb();
const normalizeDb = value => {
  const out = value && typeof value === 'object' ? value : emptyDb();
  for (const k of Object.keys(emptyDb())) if (!Array.isArray(out[k])) out[k] = [];
  return out;
};

async function supabaseRequest(pathname, options = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + pathname, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: 'Bearer ' + SUPABASE_SECRET_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + text);
  return text ? JSON.parse(text) : null;
}

async function loadDb() {
  if (!USE_SUPABASE) {
    try { db = normalizeDb(fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : emptyDb()); }
    catch { db = emptyDb(); }
    return;
  }
  const rows = await supabaseRequest('skl_state?id=eq.1&select=state');
  if (rows.length) {
    db = normalizeDb(rows[0].state);
    return;
  }
  db = emptyDb();
  await supabaseRequest('skl_state', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ id: 1, state: db })
  });
}

let saveChain = Promise.resolve();
const save = () => {
  if (!USE_SUPABASE) {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
    return Promise.resolve();
  }
  const snapshot = JSON.parse(JSON.stringify(db));
  saveChain = saveChain.then(() => supabaseRequest('skl_state?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, state: snapshot, updated_at: new Date().toISOString() })
  })).catch(err => console.error('[SKL27] Supabase save failed:', err.message));
  return saveChain;
};

const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
};

const readBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      reject(Object.assign(new Error('payload too large'), { status: 413 }));
      req.destroy();
    }
  });
  req.on('end', () => {
    try { resolve(body ? JSON.parse(body) : {}); }
    catch { reject(Object.assign(new Error('invalid_json'), { status: 400 })); }
  });
});

const users = id => db.users.find(x => x.id === id);
const club = id => db.clubs.find(x => x.id === id);
const player = id => db.players.find(x => x.id === id);
const league = id => db.leagues.find(x => x.id === id);
const memberForUser = (leagueId, userId) => db.members.find(x => x.leagueId === leagueId && x.userId === userId);
const leagueMembers = leagueId => db.members.filter(x => x.leagueId === leagueId);

const publicUser = u => u && ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  clubId: u.clubId || null,
  avatar: u.avatar || '',
  createdAt: u.createdAt
});

const auth = req => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = db.sessions.find(s => s.token === token && Date.parse(s.expiresAt) > Date.now());
  return session ? users(session.userId) : null;
};

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const notify = (userId, type, title, message, meta = {}) => {
  if (!userId) return;
  db.notifications.unshift({
    id: makeId('note'), userId, type, title, message, meta, read: false, createdAt: now()
  });
};

const positions = ['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD', 'DEF'];
const firstNames = ['Omar','Youssef','Adam','Karim','Ziad','Mina','Ali','Hassan','Nour','Seif','Malek','Tarek','Amr','Fares','Khaled','Mahmoud','Ibrahim','Mostafa','Rami','Sami'];
const lastNames = ['Hassan','Khalil','Saber','Nabil','Fathy','Adel','Samir','Farouk','Salem','Mansour','Younes','Hegazy','Mostafa','Gaber','Said','Ashraf'];

function randomName() {
  return firstNames[Math.floor(Math.random() * firstNames.length)] + ' ' +
    lastNames[Math.floor(Math.random() * lastNames.length)];
}

const REAL_PLAYERS = [
{name:'Lionel Messi',position:'FWD',nationality:'Argentina',age:39,foot:'Left',overall:91,pace:85,shooting:95,passing:96,dribbling:97,defending:38,physical:65,imageUrl:'https://commons.wikimedia.org/wiki/Special:FilePath/Lionel_messi.jpg?width=500'},
{name:'Cristiano Ronaldo',position:'FWD',nationality:'Portugal',age:41,foot:'Right',overall:88,pace:82,shooting:94,passing:81,dribbling:85,defending:35,physical:77,imageUrl:'https://commons.wikimedia.org/wiki/Special:FilePath/CRonaldo.jpg?width=500'},
{name:'Kylian Mbappe',position:'FWD',nationality:'France',age:27,foot:'Right',overall:92,pace:97,shooting:91,passing:84,dribbling:93,defending:39,physical:80},
{name:'Erling Haaland',position:'FWD',nationality:'Norway',age:26,foot:'Left',overall:91,pace:88,shooting:96,passing:79,dribbling:85,defending:45,physical:93},
{name:'Mohamed Salah',position:'FWD',nationality:'Egypt',age:34,foot:'Left',overall:88,pace:89,shooting:90,passing:83,dribbling:90,defending:45,physical:72},
{name:'Vinicius Junior',position:'FWD',nationality:'Brazil',age:26,foot:'Right',overall:90,pace:95,shooting:86,passing:82,dribbling:95,defending:32,physical:75},
{name:'Jude Bellingham',position:'MID',nationality:'England',age:23,foot:'Right',overall:90,pace:80,shooting:84,passing:88,dribbling:89,defending:78,physical:84},
{name:'Kevin De Bruyne',position:'MID',nationality:'Belgium',age:35,foot:'Right',overall:87,pace:72,shooting:87,passing:95,dribbling:86,defending:55,physical:78},
{name:'Rodri',position:'MID',nationality:'Spain',age:30,foot:'Right',overall:89,pace:65,shooting:79,passing:94,dribbling:85,defending:89,physical:87},
{name:'Pedri',position:'MID',nationality:'Spain',age:23,foot:'Right',overall:88,pace:77,shooting:69,passing:93,dribbling:91,defending:62,physical:65},
{name:'Virgil van Dijk',position:'DEF',nationality:'Netherlands',age:35,foot:'Right',overall:88,pace:79,shooting:60,passing:80,dribbling:72,defending:94,physical:91},
{name:'Achraf Hakimi',position:'DEF',nationality:'Morocco',age:27,foot:'Right',overall:87,pace:95,shooting:72,passing:82,dribbling:85,defending:78,physical:83},
{name:'William Saliba',position:'DEF',nationality:'France',age:25,foot:'Right',overall:87,pace:82,shooting:35,passing:78,dribbling:68,defending:91,physical:88},
{name:'Antonio Rudiger',position:'DEF',nationality:'Germany',age:33,foot:'Right',overall:85,pace:83,shooting:40,passing:75,dribbling:63,defending:88,physical:94},
{name:'Alisson Becker',position:'GK',nationality:'Brazil',age:33,foot:'Right',overall:89,pace:55,shooting:30,passing:85,dribbling:40,defending:30,physical:82},
{name:'Thibaut Courtois',position:'GK',nationality:'Belgium',age:34,foot:'Left',overall:89,pace:48,shooting:25,passing:82,dribbling:35,defending:28,physical:80}
];

function newPlayer(clubId, position, bot = false) {
  const candidates = REAL_PLAYERS.filter(x => x.position === position);
  const base = candidates[Math.floor(Math.random() * candidates.length)] || {name:randomName(),position,overall:72,pace:70,shooting:65,passing:65,dribbling:65,defending:65,physical:65,nationality:'International',age:24,foot:'Right'};
  const p = {
    id: makeId('pl'), clubId, name: base.name, position: base.position, nationality: base.nationality,
    age: base.age, preferredFoot: base.foot, overall: base.overall,
    pace: base.pace, shooting: base.shooting, passing: base.passing, dribbling: base.dribbling,
    defending: base.defending, physical: base.physical, imageUrl: base.imageUrl || '',
    fitness: 85 + Math.floor(Math.random() * 16), form: 65 + Math.floor(Math.random() * 26), fatigue: 0,
    marketValue: 300000 + base.overall * 18000, wage: 1800 + base.overall * 35,
    contractMonths: 12 + Math.floor(Math.random() * 25), listed: bot && Math.random() < 0.6
  };
  db.players.push(p);
  return p;
}

function newClub(name, bot = false) {
  const c = {
    id: makeId('club'),
    name: String(name).trim().slice(0, 40) || 'New Club',
    crest: String(name).trim().split(/\s+/).map(x => x[0]).join('').slice(0, 3).toUpperCase() || 'FC',
    bot,
    budget: 1500000,
    wageBudget: 120000,
    formation: '2-1-1',
    tactics: { mentality: 'Balanced', pressing: 50, passing: 50, line: 50 },
    matchPlan: null,
    playerIds: [],
    createdAt: now()
  };
  db.clubs.push(c);
  positions.forEach(pos => {
    const p = newPlayer(c.id, pos, bot);
    c.playerIds.push(p.id);
  });
  return c;
}

function clubPlayers(c) {
  return db.players.filter(p => p.clubId === c.id);
}

const FORMATIONS = {
  '2-1-1': { GK: 1, DEF: 2, MID: 1, FWD: 1 },
  '1-2-1': { GK: 1, DEF: 1, MID: 2, FWD: 1 },
  '2-2-0': { GK: 1, DEF: 2, MID: 2, FWD: 0 },
  '1-1-2': { GK: 1, DEF: 1, MID: 1, FWD: 2 }
};

function defaultXI(c) {
  const ps = clubPlayers(c).sort((a, b) => b.overall - a.overall);
  const out = [];
  const take = pos => ps.find(p => p.position === pos && !out.includes(p));
  const gk = take('GK');
  if (gk) out.push(gk);
  const counts = FORMATIONS[c.formation] || FORMATIONS['2-1-1'];
  for (const pos of ['DEF', 'MID', 'FWD']) {
    for (let i = 0; i < counts[pos]; i++) {
      const p = take(pos);
      if (p) out.push(p);
    }
  }
  for (const p of ps) if (out.length < 5 && !out.includes(p)) out.push(p);
  return out.slice(0, 5);
}

function validatePlan(c, input = {}) {
  const formation = FORMATIONS[input.formation] ? input.formation : c.formation;
  const ids = Array.isArray(input.startingXI) ? input.startingXI : [];
  let ps = ids.map(player).filter(Boolean).filter(p => p.clubId === c.id);
  const wanted = FORMATIONS[formation];
  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  ps.forEach(p => counts[p.position]++);
  const exact = ids.length === 5 &&
    ps.length === 5 &&
    new Set(ids).size === 5 &&
    counts.GK === wanted.GK &&
    counts.DEF === wanted.DEF &&
    counts.MID === wanted.MID &&
    counts.FWD === wanted.FWD;
  if (!exact) {
    ps = defaultXI({ ...c, formation });
    if (ps.length !== 5) throw fail('A valid 5-player lineup is required with the selected formation.');
  }
  return {
    formation,
    startingXI: ps.map(p => p.id),
    tactics: {
      mentality: ['Defensive','Balanced','Attacking'].includes(input?.tactics?.mentality) ? input.tactics.mentality : (c.tactics?.mentality || 'Balanced'),
      pressing: Math.max(0, Math.min(100, Number(input?.tactics?.pressing ?? c.tactics?.pressing ?? 50))),
      passing: Math.max(0, Math.min(100, Number(input?.tactics?.passing ?? c.tactics?.passing ?? 50))),
      line: Math.max(0, Math.min(100, Number(input?.tactics?.line ?? c.tactics?.line ?? 50)))
    }
  };
}

function makeFixtures(l) {
  db.fixtures = db.fixtures.filter(f => f.leagueId !== l.id);
  const ids = leagueMembers(l.id).map(m => m.clubId);
  if (ids.length < 2) throw fail('Not enough teams to start the league.');
  const teams = ids.slice();
  if (teams.length % 2) teams.push(null);
  const rounds = teams.length - 1;
  const half = teams.length / 2;
  const firstLeg = [];
  const rotation = teams.slice();
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = rotation[i];
      const b = rotation[rotation.length - 1 - i];
      if (!a || !b) continue;
      const swap = (r + i) % 2 === 0;
      firstLeg.push({
        leagueId: l.id,
        matchday: r + 1,
        homeClubId: swap ? a : b,
        awayClubId: swap ? b : a
      });
    }
    rotation.splice(1, 0, rotation.pop());
  }
  const fixtures = [];
  for (const f of firstLeg) fixtures.push({ ...f, id: makeId('fix'), status: 'scheduled', homeScore: null, awayScore: null, matchId: null, deadline: minutesFromNow(30) });
  for (const f of firstLeg) {
    fixtures.push({
      ...f,
      id: makeId('fix'),
      matchday: f.matchday + rounds,
      homeClubId: f.awayClubId,
      awayClubId: f.homeClubId,
      status: 'scheduled',
      homeScore: null,
      awayScore: null,
      matchId: null,
      deadline: minutesFromNow(30)
    });
  }
  db.fixtures.push(...fixtures);
  l.currentMatchday = 1;
  l.totalMatchdays = rounds * 2;
  l.status = 'active';
}

function standings(l) {
  return leagueMembers(l.id)
    .map(m => club(m.clubId))
    .filter(Boolean)
    .map(c => {
      const fs = db.fixtures.filter(f =>
        f.leagueId === l.id && f.status === 'played' &&
        (f.homeClubId === c.id || f.awayClubId === c.id)
      );
      let wins = 0, draws = 0, gf = 0, ga = 0;
      for (const f of fs) {
        const home = f.homeClubId === c.id;
        const a = home ? f.homeScore : f.awayScore;
        const b = home ? f.awayScore : f.homeScore;
        gf += a; ga += b;
        if (a > b) wins++;
        else if (a === b) draws++;
      }
      return {
        clubId: c.id, name: c.name, crest: c.crest, played: fs.length,
        wins, draws, losses: fs.length - wins - draws,
        gf, ga, gd: gf - ga, points: wins * 3 + draws
      };
    })
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name))
    .map((x, i) => ({ rank: i + 1, ...x }));
}

function makeMatch(home, away, fixtureId, live = false) {
  const hp = validatePlan(home, { formation: home.formation, startingXI: home.matchPlan?.startingXI, tactics: home.matchPlan?.tactics });
  const ap = validatePlan(away, { formation: away.formation, startingXI: away.matchPlan?.startingXI, tactics: away.matchPlan?.tactics });
  return {
    id: makeId('match'),
    fixtureId,
    leagueId: league(db.fixtures.find(f => f.id === fixtureId)?.leagueId)?.id,
    homeClubId: home.id,
    awayClubId: away.id,
    minute: live ? 0 : 90,
    status: live ? 'live' : 'finished',
    phase: live ? 'first_half' : 'full_time',
    homeScore: 0,
    awayScore: 0,
    possession: 50,
    homePlan: hp,
    awayPlan: ap,
    homeStats: { shots: 0, onTarget: 0, saves: 0, passes: 0, tackles: 0 },
    awayStats: { shots: 0, onTarget: 0, saves: 0, passes: 0, tackles: 0 },
    playerStats: Object.fromEntries([...hp.startingXI, ...ap.startingXI].map(id => [id, { goals: 0, assists: 0, shots: 0, passes: 0, saves: 0, rating: 6.0 }])),
    startedAt: now(),
    updatedAt: now()
  };
}

function addEvent(m, type, clubId, playerId, text, minute = m.minute) {
  db.events.push({
    id: makeId('evt'), matchId: m.id, type, clubId: clubId || null,
    playerId: playerId || null, minute, text, createdAt: now()
  });
}

function finishMatch(m) {
  m.status = 'finished';
  m.phase = 'full_time';
  m.minute = 90;
  const f = db.fixtures.find(x => x.id === m.fixtureId);
  if (f) {
    f.status = 'played';
    f.homeScore = m.homeScore;
    f.awayScore = m.awayScore;
  }
  for (const cid of [m.homeClubId, m.awayClubId]) {
    const c = club(cid);
    if (!c) continue;
    c.budget += 5000;
    db.transactions.push({
      id: makeId('tx'), clubId: cid, type: 'match_income',
      amount: 5000, description: 'Matchday income', matchId: m.id, createdAt: now()
    });
  }
  for (const pid of [...m.homePlan.startingXI, ...m.awayPlan.startingXI]) {
    const p = player(pid);
    if (p) {
      p.fitness = Math.max(0, p.fitness - 8);
      p.fatigue = Math.min(100, p.fatigue + 12);
      p.form = Math.max(0, Math.min(100, p.form + (Math.random() > 0.5 ? 1 : -1)));
    }
  }
  const h = club(m.homeClubId), a = club(m.awayClubId);
  addEvent(m, 'full_time', null, null, 'Full-time: ' + m.homeScore + '-' + m.awayScore);
  for (const u of db.users.filter(x => x.clubId === m.homeClubId || x.clubId === m.awayClubId)) {
    notify(u.id, 'match', 'Full time', h.name + ' ' + m.homeScore + '-' + m.awayScore + ' ' + a.name, { matchId: m.id });
  }
  m.updatedAt = now();
}

function simulateInstant(f) {
  if (f.status === 'played') return;
  const h = club(f.homeClubId), a = club(f.awayClubId);
  const m = makeMatch(h, a, f.id, false);
  const hStrength = clubPlayers(h).reduce((s, p) => s + p.overall, 0) / 8;
  const aStrength = clubPlayers(a).reduce((s, p) => s + p.overall, 0) / 8;
  const baseH = Math.max(0.35, Math.min(2.4, 1.15 + (hStrength - aStrength) / 30 + (h.tactics?.mentality === 'Attacking' ? .18 : 0)));
  const baseA = Math.max(0.35, Math.min(2.4, 1.0 + (aStrength - hStrength) / 30 + (a.tactics?.mentality === 'Attacking' ? .18 : 0)));
  const goals = lambda => Math.min(5, Math.max(0, Math.floor(Math.random() * (lambda + 1.8))));
  m.homeScore = goals(baseH);
  m.awayScore = goals(baseA);
  m.homeStats.shots = 4 + Math.floor(Math.random() * 8);
  m.awayStats.shots = 4 + Math.floor(Math.random() * 8);
  m.homeStats.onTarget = Math.min(m.homeStats.shots, Math.floor(Math.random() * 6));
  m.awayStats.onTarget = Math.min(m.awayStats.shots, Math.floor(Math.random() * 6));
  m.possession = Math.max(25, Math.min(75, Math.round(50 + (hStrength - aStrength) * 1.5)));
  db.matches.push(m);
  m.status = 'live';
  addEvent(m, 'full_time', null, null, 'Full-time: ' + m.homeScore + '-' + m.awayScore);
  finishMatch(m);
  return m;
}

function autoSimCurrentBots(l) {
  const fs = db.fixtures.filter(f => f.leagueId === l.id && f.matchday === l.currentMatchday && f.status === 'scheduled');
  for (const f of fs) {
    const h = club(f.homeClubId), a = club(f.awayClubId);
    if (h?.bot && a?.bot) simulateInstant(f);
  }
}

function maybeAdvanceLeague(l) {
  const current = db.fixtures.filter(f => f.leagueId === l.id && f.matchday === l.currentMatchday);
  if (!current.length || !current.every(f => f.status === 'played')) return;
  if (l.currentMatchday >= l.totalMatchdays) {
    l.status = 'finished';
    for (const m of leagueMembers(l.id)) {
      if (m.userId) notify(m.userId, 'league', 'Season complete', l.name + ' season ' + l.currentSeason + ' is complete.', { leagueId: l.id });
    }
    return;
  }
  l.currentMatchday++;
  for (const m of leagueMembers(l.id)) {
    if (m.userId) {
      const c = club(m.clubId);
      if (c) c.budget = Math.max(0, c.budget - Math.max(1200, Math.round(clubPlayers(c).reduce((s, p) => s + p.wage, 0) / 4)));
      notify(m.userId, 'league', 'New matchday', l.name + ' moved to matchday ' + l.currentMatchday + '.', { leagueId: l.id });
    }
  }
  autoSimCurrentBots(l);
}

function tickMatch(m) {
  if (m.status !== 'live') return;
  m.minute++;
  const h = club(m.homeClubId), a = club(m.awayClubId);
  const hp = m.homePlan.tactics, ap = m.awayPlan.tactics;
  const homePlayers = clubPlayers(h), awayPlayers = clubPlayers(a);
  const hs = homePlayers.reduce((s, p) => s + p.overall * (p.fitness / 100), 0) / Math.max(1, homePlayers.length);
  const as = awayPlayers.reduce((s, p) => s + p.overall * (p.fitness / 100), 0) / Math.max(1, awayPlayers.length);
  m.possession = Math.max(20, Math.min(80, Math.round(50 + (hp.passing - ap.passing) * .16 + (hs - as) * .7)));
  m.homeStats.passes += 2 + Math.floor(Math.random() * 5);
  m.awayStats.passes += 2 + Math.floor(Math.random() * 5);
  for (const sidePlan of [m.homePlan, m.awayPlan]) for (const pid of sidePlan.startingXI) if (m.playerStats[pid]) m.playerStats[pid].passes += 1 + Math.floor(Math.random() * 3);
  for (const side of ['home', 'away']) {
    const own = side === 'home' ? h : a;
    const opp = side === 'home' ? a : h;
    const plan = side === 'home' ? m.homePlan : m.awayPlan;
    const stats = side === 'home' ? m.homeStats : m.awayStats;
    const other = side === 'home' ? ap : hp;
    const ownStr = side === 'home' ? hs : as;
    const oppStr = side === 'home' ? as : hs;
    const mentalityBonus = plan.tactics.mentality === 'Attacking' ? .025 : plan.tactics.mentality === 'Defensive' ? -.015 : 0;
    const chance = Math.max(.018, Math.min(.15, .055 + (ownStr - oppStr) * .002 + (plan.tactics.pressing - other.pressing) * .00035 + mentalityBonus));
    if (Math.random() < chance) {
      stats.shots++;
      if (m.playerStats[shooterId]) m.playerStats[shooterId].shots++;
      const attackers = plan.startingXI.map(player).filter(p => p && p.position !== 'GK');
      const shooter = attackers[Math.floor(Math.random() * attackers.length)] || player(plan.startingXI[0]);
      const shooterId = shooter?.id;
      const gkId = (side === 'home' ? m.awayPlan.startingXI : m.homePlan.startingXI)
        .map(player).find(p => p?.position === 'GK')?.id;
      const gk = player(gkId);
      const goalChance = .24 + (shooter?.shooting || 60) / 430 - (gk?.overall || 65) / 850;
      if (Math.random() < goalChance) {
        if (side === 'home') m.homeScore++; else m.awayScore++;
        stats.onTarget++;
        if (m.playerStats[shooterId]) { m.playerStats[shooterId].goals++; m.playerStats[shooterId].rating = Math.min(10, m.playerStats[shooterId].rating + 0.9); }
        const helpers = attackers.filter(p => p.id !== shooterId);
        const helper = helpers.length && Math.random() < .72 ? helpers[Math.floor(Math.random() * helpers.length)] : null;
        if (helper && m.playerStats[helper.id]) { m.playerStats[helper.id].assists++; m.playerStats[helper.id].rating = Math.min(10, m.playerStats[helper.id].rating + 0.35); }
        addEvent(m, 'goal', own.id, shooterId, own.name + ' score — ' + (shooter?.name || 'attacker') + (helper ? ' (assist: ' + helper.name + ')' : '') + '!', m.minute);
      } else {
        if (Math.random() < .7) { stats.onTarget++; if (m.playerStats[shooterId]) m.playerStats[shooterId].rating += 0.08; }
        if (Math.random() < .45) {
          const saveStats = side === 'home' ? m.awayStats : m.homeStats;
          saveStats.saves++;
          if (gk?.id && m.playerStats[gk.id]) { m.playerStats[gk.id].saves++; m.playerStats[gk.id].rating = Math.min(10, m.playerStats[gk.id].rating + 0.12); }
          addEvent(m, 'save', opp.id, gk?.id, (gk?.name || 'Goalkeeper') + ' makes the save.', m.minute);
        } else {
          addEvent(m, 'shot', own.id, shooter?.id, (shooter?.name || own.name) + ' shoots off target.', m.minute);
        }
      }
    }
  }
  for (const p of [...m.homePlan.startingXI, ...m.awayPlan.startingXI].map(player)) {
    if (p) {
      p.fitness = Math.max(0, p.fitness - .08);
      p.fatigue = Math.min(100, p.fatigue + .13);
    }
  }
  if (m.minute === 45) { m.phase = 'halftime'; addEvent(m, 'halftime', null, null, 'Half-time.'); }
  if (m.minute === 46) { m.phase = 'second_half'; addEvent(m, 'kickoff', null, null, 'Second half begins.'); }
  if (m.minute === 90) { m.phase = 'stoppage'; addEvent(m, 'stoppage', null, null, 'Stoppage time.'); }
  if (m.minute >= 93) {
    finishMatch(m);
    const l = league(m.leagueId);
    if (l) {
      autoSimCurrentBots(l);
      maybeAdvanceLeague(l);
    }
    save();
    return;
  }
  m.updatedAt = now();
}

function startMatchLoop() {
  setInterval(() => {
    let dirty = false;
    for (const m of db.matches.filter(x => x.status === 'live')) { tickMatch(m); dirty = true; }
    if (dirty) save();
  }, 500);
}

function requireClub(u) {
  if (!u.clubId || !club(u.clubId)) throw fail('Create a club first.');
  return club(u.clubId);
}

async function api(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, service: 'SKL27', time: now() });

    if (req.method === 'POST' && p === '/api/auth/signup') {
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      if (!username || password.length < 6) throw fail('Username and password (6+ chars) are required.');
      if (db.users.some(x => x.username.toLowerCase() === username.toLowerCase())) throw fail('Username already exists.', 409);
      const salt = crypto.randomBytes(16).toString('hex');
      const u = {
        id: makeId('usr'), username,
        displayName: String(b.displayName || username).trim().slice(0, 40),
        passwordSalt: salt,
        passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
        clubId: null, createdAt: now()
      };
      db.users.push(u);
      const token = makeId('sess');
      db.sessions.push({ token, userId: u.id, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      save();
      return send(res, 201, { token, user: publicUser(u) });
    }

    if (req.method === 'POST' && p === '/api/auth/login') {
      const b = await readBody(req);
      const u = db.users.find(x => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
      if (!u) throw fail('Invalid credentials.', 401);
      const hash = crypto.scryptSync(String(b.password || ''), u.passwordSalt, 64).toString('hex');
      if (hash !== u.passwordHash) throw fail('Invalid credentials.', 401);
      const token = makeId('sess');
      db.sessions.push({ token, userId: u.id, expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      save();
      return send(res, 200, { token, user: publicUser(u) });
    }

    const u = auth(req);
    if (!u) throw fail('Unauthorized.', 401);

    if (req.method === 'GET' && p === '/api/me') {
      return send(res, 200, {
        user: publicUser(u),
        club: u.clubId ? club(u.clubId) : null,
        unreadNotifications: db.notifications.filter(n => n.userId === u.id && !n.read).length
      });
    }

    if (req.method === 'POST' && p === '/api/clubs') {
      if (u.clubId) throw fail('You already have a club.', 409);
      const b = await readBody(req);
      const name = String(b.name || (u.displayName + ' FC')).trim();
      if (name.length < 2) throw fail('Club name is too short.');
      if (db.clubs.some(c => c.name.toLowerCase() === name.toLowerCase())) throw fail('Club name already exists.', 409);
      const c = newClub(name);
      u.clubId = c.id;
      save();
      return send(res, 201, { club: c, players: clubPlayers(c) });
    }

    if (req.method === 'GET' && p === '/api/players') {
      const c = requireClub(u);
      return send(res, 200, { players: clubPlayers(c), club: c });
    }

    if (req.method === 'POST' && p === '/api/matches/plan') {
      const c = requireClub(u);
      const b = await readBody(req);
      const plan = validatePlan(c, b.plan || {});
      c.formation = plan.formation;
      c.tactics = plan.tactics;
      c.matchPlan = plan;
      save();
      return send(res, 200, { plan });
    }

    if (req.method === 'GET' && p === '/api/friends') {
      return send(res, 200, {
        friends: db.friends.filter(f => f.from === u.id || f.to === u.id).map(f => ({
          ...f,
          otherUser: publicUser(users(f.from === u.id ? f.to : f.from))
        }))
      });
    }

    if (req.method === 'POST' && p === '/api/friends/request') {
      const b = await readBody(req);
      const to = db.users.find(x => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
      if (!to) throw fail('User not found.', 404);
      if (to.id === u.id) throw fail('You cannot add yourself.');
      if (db.friends.some(f => ((f.from === u.id && f.to === to.id) || (f.from === to.id && f.to === u.id)) && f.status === 'accepted')) {
        throw fail('Already friends.', 409);
      }
      const f = { id: makeId('fr'), from: u.id, to: to.id, status: 'pending', createdAt: now() };
      db.friends.push(f);
      notify(to.id, 'friend', 'Friend request', u.displayName + ' sent you a friend request.', { friendId: f.id });
      save();
      return send(res, 201, { friend: f });
    }

    if (req.method === 'POST' && p === '/api/friends/respond') {
      const b = await readBody(req);
      const f = db.friends.find(x => x.id === b.friendId && x.to === u.id && x.status === 'pending');
      if (!f) throw fail('Friend request not found.', 404);
      f.status = b.action === 'accept' ? 'accepted' : 'rejected';
      save();
      return send(res, 200, { friend: f });
    }

    if (req.method === 'GET' && p === '/api/notifications') {
      return send(res, 200, { notifications: db.notifications.filter(n => n.userId === u.id).slice(0, 80) });
    }

    if (req.method === 'POST' && p === '/api/notifications/read') {
      const b = await readBody(req);
      db.notifications.filter(n => n.userId === u.id && (b.all || n.id === b.id)).forEach(n => n.read = true);
      save();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/leagues') {
      const c = requireClub(u);
      const b = await readBody(req);
      const name = String(b.name || 'Friends League').trim().slice(0, 40);
      const l = {
        id: makeId('lg'), name, ownerId: u.id, status: 'preseason',
        maxTeams: 18, currentMatchday: 0, totalMatchdays: 34, currentSeason: 1, createdAt: now()
      };
      db.leagues.push(l);
      db.members.push({ id: makeId('lm'), leagueId: l.id, userId: u.id, clubId: c.id, role: 'owner' });
      save();
      return send(res, 201, { league: l });
    }

    if (req.method === 'GET' && p === '/api/leagues') {
      const mine = db.members.filter(m => m.userId === u.id).map(m => league(m.leagueId)).filter(Boolean);
      const invites = db.invitations.filter(i => i.toUserId === u.id && i.status === 'pending').map(i => ({
        ...i, league: league(i.leagueId), from: publicUser(users(i.fromUserId))
      }));
      return send(res, 200, { leagues: mine, invitations: invites });
    }

    if (req.method === 'POST' && p === '/api/leagues/invite') {
      requireClub(u);
      const b = await readBody(req);
      const l = league(b.leagueId);
      const to = db.users.find(x => x.username.toLowerCase() === String(b.username || '').trim().toLowerCase());
      if (!l || l.ownerId !== u.id) throw fail('League or permission error.', 403);
      if (!to) throw fail('User not found.', 404);
      if (!to.clubId) throw fail('That player must create a club first.');
      if (memberForUser(l.id, to.id)) throw fail('That player is already in the league.');
      if (db.invitations.some(i => i.leagueId === l.id && i.toUserId === to.id && i.status === 'pending')) throw fail('Invitation already pending.', 409);
      if (leagueMembers(l.id).length >= l.maxTeams) throw fail('League is full.', 409);
      const inv = { id: makeId('inv'), leagueId: l.id, fromUserId: u.id, toUserId: to.id, status: 'pending', createdAt: now() };
      db.invitations.push(inv);
      notify(to.id, 'league', 'League invitation', u.displayName + ' invited you to ' + l.name + '.', { invitationId: inv.id, leagueId: l.id });
      save();
      return send(res, 201, { invitation: inv });
    }

    if (req.method === 'POST' && p === '/api/leagues/accept') {
      requireClub(u);
      const b = await readBody(req);
      const inv = db.invitations.find(i => i.id === b.invitationId && i.toUserId === u.id && i.status === 'pending');
      if (!inv) throw fail('League invitation not found.', 404);
      const l = league(inv.leagueId);
      if (!l || l.status !== 'preseason') throw fail('This league is no longer accepting players.');
      if (leagueMembers(l.id).length >= l.maxTeams) throw fail('League is full.', 409);
      inv.status = 'accepted';
      db.members.push({ id: makeId('lm'), leagueId: l.id, userId: u.id, clubId: u.clubId, role: 'member' });
      save();
      notify(inv.fromUserId, 'league', 'Player joined', u.displayName + ' joined ' + l.name + '.', { leagueId: l.id });
      return send(res, 200, { league: l });
    }

    if (req.method === 'POST' && p === '/api/leagues/start') {
      requireClub(u);
      const b = await readBody(req);
      const l = league(b.leagueId);
      if (!l || l.ownerId !== u.id) throw fail('League or permission error.', 403);
      if (l.status === 'active') return send(res, 200, { league: l });
      let n = leagueMembers(l.id).length;
      const botNames = ['Atlas FC','Cairo Kings','Nile United','Delta Stars','Alexandria SC','Pyramid City','Desert Lions','Red Falcons','Blue Waves','Capital FC','Royal Eagles','Port Said','Canal Athletic','Giza Sporting','Luxor FC','Aswan United','Sphinx FC'];
      while (n < Math.min(l.maxTeams, 18)) {
        const c = newClub(botNames[n - 1] || ('Bot FC ' + n), true);
        db.members.push({ id: makeId('lm'), leagueId: l.id, userId: null, clubId: c.id, role: 'bot' });
        n++;
      }
      makeFixtures(l);
      autoSimCurrentBots(l);
      save();
      return send(res, 200, { league: l });
    }

    if (req.method === 'GET' && p.startsWith('/api/leagues/')) {
      const idPart = p.split('/')[3];
      const l = league(idPart);
      if (!l || !memberForUser(l.id, u.id)) throw fail('Forbidden.', 403);
      autoSimCurrentBots(l);
      save();
      return send(res, 200, {
        league: l,
        memberCount: leagueMembers(l.id).length,
        standings: standings(l),
        fixtures: db.fixtures.filter(f => f.leagueId === l.id && f.matchday === l.currentMatchday).map(f => ({
          ...f, home: club(f.homeClubId), away: club(f.awayClubId)
        })),
        myMember: memberForUser(l.id, u.id)
      });
    }

    if (req.method === 'GET' && p === '/api/matchday') {
      const leagueId = url.searchParams.get('leagueId');
      const l = league(leagueId);
      if (!l || !memberForUser(l.id, u.id)) throw fail('Forbidden.', 403);
      autoSimCurrentBots(l);
      save();
      return send(res, 200, {
        league: l,
        standings: standings(l),
        fixtures: db.fixtures.filter(f => f.leagueId === l.id && f.matchday === l.currentMatchday).map(f => ({
          ...f, home: club(f.homeClubId), away: club(f.awayClubId)
        }))
      });
    }

    if (req.method === 'POST' && p === '/api/matches/start') {
      const c = requireClub(u);
      const b = await readBody(req);
      const f = db.fixtures.find(x => x.id === b.fixtureId);
      if (!f || (f.homeClubId !== c.id && f.awayClubId !== c.id)) throw fail('Match is not available to your club.', 403);
      if (f.status === 'played') {
        return send(res, 200, { match: db.matches.find(x => x.id === f.matchId) });
      }
      if (f.status === 'live') return send(res, 200, { match: db.matches.find(x => x.id === f.matchId) });
      const h = club(f.homeClubId), a = club(f.awayClubId);
      const m = makeMatch(h, a, f.id, true);
      db.matches.push(m);
      f.status = 'live';
      f.matchId = m.id;
      addEvent(m, 'kickoff', null, null, 'Kick-off!');
      save();
      return send(res, 201, { match: m });
    }

    if (req.method === 'GET' && p.startsWith('/api/matches/')) {
      const m = db.matches.find(x => x.id === p.split('/')[3]);
      if (!m) throw fail('Match not found.', 404);
      if (m.homeClubId !== u.clubId && m.awayClubId !== u.clubId && !club(m.homeClubId)?.bot && !club(m.awayClubId)?.bot) {
        throw fail('Forbidden.', 403);
      }
      return send(res, 200, {
        match: m,
        events: db.events.filter(e => e.matchId === m.id),
        home: club(m.homeClubId),
        away: club(m.awayClubId),
        serverTime: now()
      });
    }

    if (req.method === 'POST' && p === '/api/training') {
      const c = requireClub(u);
      const b = await readBody(req);
      const type = String(b.type || 'recovery');
      const ps = clubPlayers(c);
      if (type === 'recovery') ps.forEach(p => { p.fitness = Math.min(100, p.fitness + 14); p.fatigue = Math.max(0, p.fatigue - 18); });
      else if (type === 'physical') ps.forEach(p => { p.fitness = Math.min(100, p.fitness + 5); p.fatigue = Math.max(0, p.fatigue + 4); p.overall = Math.min(95, p.overall + .2); });
      else if (type === 'shooting') ps.forEach(p => { p.shooting = Math.min(99, p.shooting + 1); p.form = Math.min(100, p.form + 2); p.fatigue = Math.min(100, p.fatigue + 6); });
      else if (type === 'passing') ps.forEach(p => { p.passing = Math.min(99, p.passing + 1); p.form = Math.min(100, p.form + 2); p.fatigue = Math.min(100, p.fatigue + 6); });
      else if (type === 'defending') ps.forEach(p => { p.defending = Math.min(99, p.defending + 1); p.form = Math.min(100, p.form + 2); p.fatigue = Math.min(100, p.fatigue + 6); });
      else throw fail('Unknown training type.');
      db.training.push({ id: makeId('tr'), clubId: c.id, type, createdAt: now() });
      notify(u.id, 'training', 'Training complete', 'Your squad completed ' + type + ' training.', {});
      save();
      return send(res, 200, { players: ps, type });
    }

    if (req.method === 'GET' && p === '/api/market') {
      requireClub(u);
      const players = db.players.filter(p => p.listed && p.clubId !== u.clubId && club(p.clubId)?.bot)
        .sort((a, b) => a.marketValue - b.marketValue).slice(0, 40)
        .map(p => ({ ...p, seller: { id: club(p.clubId).id, name: club(p.clubId).name, crest: club(p.clubId).crest } }));
      return send(res, 200, { players });
    }

    if (req.method === 'POST' && p === '/api/transfers/buy') {
      const c = requireClub(u);
      const b = await readBody(req);
      const p = player(b.playerId);
      if (!p || !p.listed || !club(p.clubId)?.bot) throw fail('Player is no longer available.', 404);
      if (c.playerIds.length >= 12) throw fail('Squad limit is 12 players.');
      if (c.budget < p.marketValue) throw fail('Not enough budget.');
      const seller = club(p.clubId);
      c.budget -= p.marketValue;
      seller.budget += p.marketValue;
      seller.playerIds = seller.playerIds.filter(id => id !== p.id);
      c.playerIds.push(p.id);
      p.clubId = c.id;
      p.listed = false;
      db.transactions.push({
        id: makeId('tx'), clubId: c.id, type: 'transfer',
        amount: -p.marketValue, description: 'Signed ' + p.name, playerId: p.id, createdAt: now()
      });
      notify(u.id, 'transfer', 'Transfer completed', p.name + ' joined ' + c.name + '.', { playerId: p.id });
      save();
      return send(res, 200, { player: p, club: c });
    }

    if (req.method === 'GET' && p === '/api/finance') {
      const c = requireClub(u);
      return send(res, 200, {
        balance: c.budget,
        wageBudget: c.wageBudget,
        weeklyWages: clubPlayers(c).reduce((s, p) => s + p.wage, 0),
        transactions: db.transactions.filter(t => t.clubId === c.id).slice(-80).reverse()
      });
    }

    throw fail('Not found.', 404);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'server_error' });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'styles.css', 'skl27.js'].includes(file)) return send(res, 404, { error: 'not_found' });
  try {
    const content = fs.readFileSync(path.join(ROOT, file));
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch {
    send(res, 500, { error: 'asset_error' });
  }
});

async function boot() {
  try {
    await loadDb();
    startMatchLoop();
    server.listen(PORT, () => console.log('SKL27 server listening on port ' + PORT + (USE_SUPABASE ? ' with Supabase persistence' : ' with local persistence')));
  } catch (err) {
    console.error('[SKL27] Database startup failed:', err.message);
  }
}

// Vercel imports this file as a serverless function. Only start a TCP server
// when running directly with "node server.js" locally/on a traditional host.
if (require.main === module) {
  boot();
} else {
  module.exports = { api, loadDb };
}