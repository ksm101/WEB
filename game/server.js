/* Embertide multiplayer server.
 * Serves the client page, keeps every account (level, gear, friends), and runs each dungeon on the
 * server: clients send only their inputs and receive snapshots. Empty seats, and seats whose player
 * dropped, are played by bots. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Sim = require('./sim.js');
const { createStore } = require('./store.js');

const TICK = 1 / 30;            // simulation step
const SNAP_EVERY = 2;           // snapshot every 2 steps = 15 per second
const MAX_ROOMS = 200, MAX_FRIENDS = 50;
const NEEDS_CHAR = ['join', 'name', 'loadout', 'claim', 'craft', 'solo0', 'solo1', 'field0', 'fg', 'fk'];
const SEATS = Sim.ROSTER;       // tank, heal, dps, dps
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/sim.js': ['sim.js', 'text/javascript; charset=utf-8'],
  '/story.js': ['story.js', 'text/javascript; charset=utf-8']
};

const clampInt = (v, a, b) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a; };
const cleanName = s => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, 8) : '') || '旅人';
const cleanCode = s => typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
const cleanId = s => typeof s === 'string' && /^[a-f0-9]{16}$/.test(s) ? s : '';
/* An account holds up to MAX_CHARS characters. Everything a player progresses (class, level, gear, bag, quests,
 * skills) belongs to a character; friends belong to the account. rec.name mirrors the name of the character in use. */
const MAX_CHARS = 4;
const pc = r => r.chars[r.cur] || null;        // the character this account is playing
const charProfile = c => ({ name: c.name, cls: c.cls, lvl: c.lvl, cl: c.cl, xp: c.xp, gear: c.gear, best: c.best, runs: c.runs, inv: c.inv, q: c.q, loadout: c.loadout });
const profileOf = r => { const c = pc(r); return c ? charProfile(c) : null; };
const rosterOf = r => r.chars.map(c => ({ name: c.name, cls: c.cls, cl: c.cl, lvl: c.lvl, ilvl: Sim.ilvlOf(c.gear) }));
const charName = s => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, 8) : '';
const newChar = (name, cls) => Sim.fixProfile(Object.assign({ name, cls, made: Date.now() }, Sim.newProfile()));

function freshRecord(id) { return { id, name: '旅人', friends: {}, ignored: [], recent: [], created: Date.now(), chars: [], cur: -1 }; }
/* Rebuild a character from a backup or an older file, keeping only fields of the expected shape. */
function normChar(b) {
  const g = b.gear || {}, v = b.inv || {};
  const c = { name: cleanName(b.name), cls: SEATS.includes(b.cls) ? b.cls : 'dps', made: clampInt(b.made, 0, 9e15), lvl: clampInt(b.lvl, 1, 50), cl: clampInt(b.cl, 1, Sim.MAX_LEVEL), xp: clampInt(b.xp, 0, 1e9),
    gear: { w: clampInt(g.w, 10, 999), a: clampInt(g.a, 10, 999), t: clampInt(g.t, 10, 999) }, best: {}, runs: clampInt(b.runs, 0, 1e9),
    inv: { scrap: clampInt(v.scrap, 0, 9999), salt: clampInt(v.salt, 0, 9999), shard: clampInt(v.shard, 0, 9999), herb: clampInt(v.herb, 0, 9999), potion: clampInt(v.potion, 0, Sim.POTION_CAP) }, q: b.q, loadout: b.loadout };
  if (b.best && typeof b.best === 'object') for (const k of Object.keys(b.best).slice(0, 60)) { const n = Number(b.best[k]); if (/^\d+$/.test(k) && Number.isFinite(n)) c.best[k] = n; }
  return Sim.fixProfile(c);
}
function normalize(b) {
  const rec = { id: b.id, name: cleanName(b.name), friends: {}, ignored: [], recent: [], created: clampInt(b.created, 0, 9e15), chars: [], cur: -1 };
  const src = Array.isArray(b.chars) ? b.chars : b.gear ? [b] : [];        // a record from before characters existed becomes one character
  for (const c of src.slice(0, MAX_CHARS)) if (c && typeof c === 'object') rec.chars.push(normChar(c));
  if (rec.chars.length) { rec.cur = clampInt(b.cur, 0, rec.chars.length - 1); rec.name = pc(rec).name; }
  if (b.friends && typeof b.friends === 'object') for (const k of Object.keys(b.friends).slice(0, MAX_FRIENDS)) if (cleanId(k)) rec.friends[k] = cleanName(b.friends[k]);
  if (Array.isArray(b.ignored)) rec.ignored = b.ignored.filter(cleanId).slice(0, 50);
  if (Array.isArray(b.recent)) rec.recent = b.recent.filter(r => r && cleanId(r.id)).slice(0, 10).map(r => ({ id: r.id, name: cleanName(r.name), cls: SEATS.includes(r.cls) ? r.cls : 'dps', at: clampInt(r.at, 0, 9e15) }));
  return rec;
}

function start(opts) {
  opts = opts || {};
  const speed = opts.speed || 1;                       // tests fast-forward the simulation
  const lobbyWait = opts.lobbyWait != null ? opts.lobbyWait : 8000;
  const soloMin = opts.soloMin != null ? opts.soloMin : 40;   // fastest solo clear the server will believe, in seconds
  const store = createStore(opts.dataDir !== undefined ? opts.dataDir : (process.env.DATA_DIR || path.join(__dirname, 'data')), opts.secret);
  const rooms = new Map();                             // key -> room
  const seats = new Map();                             // account id -> { room, idx } while a run is going
  const online = new Map();                            // account id -> socket
  const wanted = new Map();                            // account id -> ids of accounts that added it as a friend
  let publicN = 0;

  const index = rec => { for (const id of Object.keys(rec.friends)) { if (!wanted.has(id)) wanted.set(id, new Set()); wanted.get(id).add(rec.id); } };
  for (const old of Array.from(store.all())) { const rec = normalize(old); store.put(rec); index(rec); }      // also brings older files up to date

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ embertide: 1, rooms: rooms.size, players: online.size }));
    }
    const f = FILES[url];
    if (!f || req.method !== 'GET') { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    fs.readFile(path.join(__dirname, f[0]), (err, buf) => {
      if (err) { res.writeHead(500); return res.end('error'); }
      res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' }); res.end(buf);
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384 });

  const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const humans = room => room.slots.filter(Boolean);
  const sendMe = (ws, extra) => { const r = ws.acc; send(ws, Object.assign({ t: 'me', id: r.id, token: store.token(r.id), bk: store.pack(r), profile: profileOf(r), chars: rosterOf(r), cur: r.cur }, extra)); };

  /* ---------- accounts ---------- */
  function onHello(ws, m) {
    if (ws.acc) return;
    let rec = null; const id = cleanId(m.id);
    if (id && store.checkToken(id, m.token)) {          // the token proves this server issued the id
      rec = store.get(id);
      if (!rec) { const b = store.unpack(m.bk); if (b && b.id === id) rec = normalize(b); }   // disk was lost: take the device's signed copy
      if (!rec) rec = freshRecord(id);
    } else rec = freshRecord(crypto.randomBytes(8).toString('hex'));
    store.put(rec); index(rec);
    const old = online.get(rec.id);
    if (old && old !== ws) { unseat(old); old.acc = null; send(old, { t: 'kicked' }); old.close(); }
    ws.acc = rec; online.set(rec.id, ws);
    const held = seats.get(rec.id), back = !!(held && held.room.state === 'run' && rooms.get(held.room.key) === held.room);
    sendMe(ws, { resume: back });
    if (back) {                                         // straight back into the run they dropped out of
      const room = held.room; room.slots[held.idx].ws = ws; ws.info = { room, idx: held.idx };
      room.G.actors[held.idx].human = true; room.goneSince = 0; sendStart(room, held.idx);
    }
  }

  /* ---------- friends ---------- */
  function stateOf(id) { const ws = online.get(id); if (!ws) return 'off'; const r = ws.info && ws.info.room; return r ? (r.kind === 'field' ? 'field' : r.state === 'run' ? 'run' : 'lobby') : 'on'; }
  function socialOf(rec) {
    const friends = Object.keys(rec.friends).map(id => {
      const o = store.get(id); if (o) rec.friends[id] = o.name;
      const mutual = !!(o && o.friends[rec.id]);
      return { id, name: rec.friends[id], mutual, state: mutual ? stateOf(id) : 'off' };   // only friends on both sides see each other online
    });
    const inbox = [];
    for (const id of (wanted.get(rec.id) || [])) { const o = store.get(id); if (o && o.friends[rec.id] && !rec.friends[id] && !rec.ignored.includes(id)) inbox.push({ id, name: o.name }); }
    const recent = rec.recent.map(r => ({ id: r.id, name: (store.get(r.id) || r).name, cls: r.cls, friend: !!rec.friends[r.id] }));
    return { t: 'social', friends, inbox, recent };
  }
  function onFriend(ws, m) {
    const rec = ws.acc, id = cleanId(m.id); if (!id || id === rec.id) return;
    if (m.on === false) { delete rec.friends[id]; const w = wanted.get(id); if (w) w.delete(rec.id); }
    else {
      const o = store.get(id), known = rec.recent.find(r => r.id === id);
      if (!o && !known) return send(ws, { t: 'note', msg: '找不到這位玩家。' });
      if (!rec.friends[id] && Object.keys(rec.friends).length >= MAX_FRIENDS) return send(ws, { t: 'note', msg: `好友名單滿了（上限 ${MAX_FRIENDS} 人）。` });
      rec.friends[id] = (o || known).name; rec.ignored = rec.ignored.filter(x => x !== id); index(rec);
      const mutual = !!(o && o.friends[rec.id]), tws = online.get(id);
      if (mutual) { for (const c of [pc(rec), pc(o)]) if (c) Sim.questEvent(c, { type: 'friend' }, Date.now()); store.put(o); if (tws) sendMe(tws); }
      if (tws) { send(tws, { t: 'note', msg: mutual ? `你和 ${rec.name} 成為好友了。` : `${rec.name} 想加你為好友。`, social: true }); send(tws, socialOf(tws.acc)); }
    }
    store.put(rec); sendMe(ws); send(ws, socialOf(rec));
  }
  function onInvite(ws, m) {
    const rec = ws.acc, id = cleanId(m.id), room = ws.info && ws.info.room, now = Date.now();
    if (!id || now - (ws.lastInvite || 0) < 1500) return; ws.lastInvite = now;
    const afield = !!room && room.kind === 'field';      // a party in the field can invite too
    if (!room || (!afield && (room.state !== 'lobby' || room.pub))) return send(ws, { t: 'note', msg: '要先開一個有房號的房間才能邀請。' });
    const o = store.get(id), mutual = !!(o && o.friends[rec.id] && rec.friends[id]), tws = online.get(id);
    if (!mutual) return send(ws, { t: 'note', msg: '對方也加你為好友之後才能邀請。' });
    if (!tws) return send(ws, { t: 'note', msg: `${o.name} 現在不在線上。` });
    if (stateOf(id) === 'run') return send(ws, { t: 'note', msg: `${o.name} 正在打副本。` });
    send(tws, { t: 'invited', from: { id: rec.id, name: rec.name }, code: room.code, field: afield });
    send(ws, { t: 'note', msg: `已邀請 ${o.name}。` });
  }

  /* ---------- rooms ---------- */
  function mkRoom(key, code, pub) {
    const room = { key, code, pub, state: 'lobby', slots: [null, null, null, null], deadline: 0, emptySince: Date.now(), G: null, acc: 0, n: 0, clock: 0, goneSince: 0 };
    rooms.set(key, room); return room;
  }
  function lobbyInfo(room) {
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      const me = room.slots[i]; if (!me) continue;
      send(me.ws, { t: 'lobby', code: room.pub ? '' : room.code, you: i,
        left: room.pub && room.deadline ? Math.max(0, Math.ceil((room.deadline - now) / 1000)) : -1,
        slots: room.slots.map((s, k) => ({ cls: SEATS[k], name: s ? s.name : '', ready: !!(s && s.ready) })) });
    }
  }
  function unseat(ws) {
    const info = ws.info; if (!info || !info.room) return;
    const room = info.room, slot = room.slots[info.idx]; ws.info = null;
    if (!slot || slot.ws !== ws) return;
    if (room.kind === 'field') { Sim.removeFieldActor(room.G, info.idx); room.slots[info.idx] = null; return fieldRoster(room); }   // walked out of the party's field
    if (room.state === 'lobby') { room.slots[info.idx] = null; if (!humans(room).length) room.emptySince = Date.now(); lobbyInfo(room); }
    else { slot.ws = null; if (room.G) room.G.actors[info.idx].human = false; }   // a bot plays this seat until they come back
  }
  function leave(ws) {      // leaving on purpose: no seat is held for a return
    const info = ws.info; if (info && info.room && info.room.state === 'run' && ws.acc) seats.delete(ws.acc.id);
    unseat(ws);
  }
  function onJoin(ws, m) {
    const rec = ws.acc, c = pc(rec);
    if (seats.has(rec.id)) return;                       // already seated in a run
    if (m.field) return onFieldJoin(ws, m);
    leave(ws);
    const cls = c.cls, code = cleanCode(m.room); let room = null, idx = -1;      // the class is the character's, whatever the client says
    const freeSeat = r => r.slots.findIndex((s, k) => !s && SEATS[k] === cls);
    if (code) {
      room = rooms.get('p:' + code);
      if (room && room.state === 'run') return send(ws, { t: 'err', msg: '這個房間正在打副本，等他們打完再進來。' });
      if (!room) { if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: '伺服器滿了，晚點再試。' }); room = mkRoom('p:' + code, code, false); }
      idx = freeSeat(room);
      if (idx < 0) return send(ws, { t: 'err', msg: `這個房間的${Sim.CLASSES[cls].name}位置滿了，換一個職業再進來。` });
    } else {
      for (const r of rooms.values()) if (r.pub && r.state === 'lobby' && freeSeat(r) >= 0) { room = r; break; }
      if (!room) { if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: '伺服器滿了，晚點再試。' }); room = mkRoom('q:' + (++publicN), '', true); }
      idx = freeSeat(room);
    }
    room.slots[idx] = { id: rec.id, ci: rec.cur, name: c.name, cls, lvl: c.lvl, cl: c.cl, pow: Sim.charPower(c), potions: c.inv.potion > 0 ? 1 : 0, skills: Sim.loadoutOf(c, cls), ws, ready: false };   // level and power come from the account, never from the client
    ws.info = { room, idx };
    const fr = code ? rooms.get('f:' + code) : null;      // the rest of the party is still out in the field: tell them where to come
    if (fr) for (const o of fr.slots) if (o && o.ws && o.ws !== ws) send(o.ws, { t: 'invited', from: { id: rec.id, name: c.name }, code, gate: true });
    const now = Date.now();
    room.deadline = room.deadline ? Math.max(room.deadline, now + Math.min(3000, lobbyWait)) : now + lobbyWait;
    lobbyInfo(room);
  }
  function sendStart(room, only) {
    const G = room.G;
    room.slots.forEach((s, i) => {
      if (!s || (only != null && only !== i)) return;
      send(s.ws, { t: 'start', you: i, lvl: G.lvl, elvl: G.elvl, roster: G.actors.map(a => ({ cls: a.cls, name: a.name, lvl: a.lvl, human: a.human, maxHp: a.maxHp, potions: a.potions, skills: a.skills.map(k => k.id) })) });
    });
  }
  function startRoom(room) {
    const lvl = Math.min.apply(null, humans(room).map(s => s.lvl));
    room.G = Sim.createRun({ lvl, grace: 12, players: humans(room).map(s => ({ cls: s.cls, name: s.name, lvl: s.cl, pow: s.pow, id: s.id, potions: s.potions, skills: s.skills })) });
    // seats and actors share the same order, so slot i drives actor i
    room.slots.forEach((s, i) => { if (s) { if (room.G.actors[i].pid !== s.id) throw new Error('seat mismatch'); seats.set(s.id, { room, idx: i }); } });
    room.state = 'run'; room.acc = 0; room.n = 0; room.clock = 0; room.goneSince = 0; room.last = Date.now();
    sendStart(room);
  }
  function endRoom(room) {
    for (const s of humans(room)) { seats.delete(s.id); if (s.ws && s.ws.info && s.ws.info.room === room) s.ws.info = null; }
    room.G = null;
    if (room.pub) rooms.delete(room.key);
    else { room.state = 'lobby'; room.slots = [null, null, null, null]; room.deadline = 0; room.emptySince = Date.now(); }
  }
  function broadcast(room) {
    const G = room.G; if (room.kind === 'field') fieldRewards(room, G.events);
    const snap = Sim.snapshot(G);
    snap.t = 's'; snap.c = Math.round(room.clock * 1000); snap.ev = G.events; G.events = [];
    const msg = JSON.stringify(snap);
    for (const s of room.slots) if (s && s.ws && s.ws.readyState === 1) s.ws.send(msg);
  }
  /* The run is over: the server rolls each player's loot, updates their account and tells them who they played with. */
  function finishRoom(room) {
    const G = room.G, r = G.result, now = Date.now(); broadcast(room);
    const hs = humans(room);
    let again = room.code;                               // a room code the same group can use to go again together
    if (room.pub) do { again = 'R' + crypto.randomBytes(2).toString('hex').toUpperCase(); } while (rooms.has('p:' + again));
    const stats = G.actors.map(a => ({ dmg: Math.round(a.stats.dmg), heal: Math.round(a.stats.heal), kicks: a.stats.kicks, hits: a.stats.hits }));
    room.slots.forEach((s, i) => {
      const rec = s && store.get(s.id), c = rec && rec.chars[s.ci]; if (!c) return;     // the character that took the seat
      const rw = Sim.applyResult(c, G.lvl, r);
      c.inv.potion = Math.max(0, c.inv.potion - G.actors[i].stats.pots);
      Sim.questEvent(c, { type: 'run', win: r.win, onTime: r.onTime, cls: s.cls, kicks: G.actors[i].stats.kicks, hits: G.actors[i].stats.hits, mates: hs.length - 1 }, now);
      for (const o of hs) if (o.id !== s.id) rec.recent = [{ id: o.id, name: o.name, cls: o.cls, at: now }].concat(rec.recent.filter(x => x.id !== o.id)).slice(0, 10);
      store.put(rec);
      send(s.ws, { t: 'end', win: r.win, onTime: r.onTime, time: Math.round(r.t * 10) / 10, lvl: G.lvl, stats, loot: rw.loot, mats: rw.mats, xp: rw.xp, again, profile: profileOf(rec), bk: store.pack(rec),
        mates: hs.filter(o => o.id !== s.id).map(o => ({ id: o.id, name: o.name, cls: o.cls, friend: !!rec.friends[o.id] })) });
    });
    endRoom(room);
  }
  /* A solo run is simulated on the player's own device. The server cannot replay it, so it only checks that
   * the claim is believable: the level is one this account has reached, and at least as much real time has
   * passed as the run says it took. */
  function onSolo(ws, m) {
    const rec = ws.acc, c = pc(rec);
    if (m.t === 'solo0') { ws.solo = { lvl: clampInt(m.lvl, 1, c.lvl), cls: c.cls, at: Date.now() }; return; }
    const s = ws.solo; ws.solo = null; const time = Number(m.time), win = m.win === true;
    const ok = !!s && Number.isFinite(time) && time > 0 && time < 3600 && (Date.now() - s.at) / 1000 >= time * .9 && (!win || time >= soloMin);
    let rw = { loot: null, mats: null, xp: 0 };
    if (s && m.pots > 0) c.inv.potion = Math.max(0, c.inv.potion - 1);   // a potion drunk in the run is gone either way
    if (ok) {     // kicks and hits are the device's own count: fine for quests, not for anything worth cheating
      rw = Sim.applyResult(c, s.lvl, { win, onTime: win && time <= Sim.TIME_LIMIT, t: time });
      Sim.questEvent(c, { type: 'run', win, onTime: win && time <= Sim.TIME_LIMIT, cls: s.cls, kicks: clampInt(m.kicks, 0, 50), hits: clampInt(m.hits, 0, 999), mates: 0 }, Date.now());
    }
    if (s) store.put(rec);
    send(ws, { t: 'solo', ok, loot: rw.loot, mats: rw.mats, xp: rw.xp, profile: profileOf(rec), bk: store.pack(rec) });
  }

  /* A party's field. It runs on the server like a dungeon, has no timer and no bots, and people can walk in and out
   * while it is going: joining needs only the party's code. */
  const fieldRosterOf = room => room.G.actors.map(a => a.out ? null : { cls: a.cls, name: a.name, lvl: a.lvl, human: true, maxHp: a.maxHp, potions: 0, skills: a.skills.map(k => k.id) });
  function fieldRoster(room) { const roster = fieldRosterOf(room); for (const s of room.slots) if (s) send(s.ws, { t: 'roster', roster }); }
  function onFieldJoin(ws, m) {
    const rec = ws.acc, c = pc(rec); leave(ws);
    let code = cleanCode(m.room); if (!code) do { code = crypto.randomBytes(2).toString('hex').toUpperCase(); } while (rooms.has('f:' + code));
    const p = { cls: c.cls, name: c.name, pow: Sim.charPower(c), id: rec.id, lvl: c.cl, skills: Sim.loadoutOf(c, c.cls) };
    let room = rooms.get('f:' + code), idx = 0;
    if (room) { idx = Sim.addFieldActor(room.G, p); if (idx < 0) return send(ws, { t: 'err', msg: '這個隊伍滿了，最多 4 個人。' }); }
    else {
      if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: '伺服器滿了，晚點再試。' });
      room = { key: 'f:' + code, code, kind: 'field', pub: false, state: 'run', slots: [], G: Sim.createField({ lvl: c.lvl, grace: 12, players: [p] }), acc: 0, n: 0, clock: 0, last: Date.now(), goneSince: 0 };
      rooms.set(room.key, room);
    }
    room.slots[idx] = { id: rec.id, ci: rec.cur, name: c.name, cls: c.cls, ws }; ws.info = { room, idx }; ws.field = null;
    send(ws, { t: 'start', field: true, code, you: idx, lvl: room.G.lvl, elvl: 1, roster: fieldRosterOf(room) });
    fieldRoster(room);
  }
  /* Pay out what the simulation says happened. A gather pays the person who gathered; a kill pays everyone who was near. */
  function fieldRewards(room, events) {
    const G = room.G, now = Date.now(); let grew = false;
    const pay = (idx, what, key, pk) => {
      const s = room.slots[idx], rec = s && store.get(s.id), c = rec && rec.chars[s.ci]; if (!c) return;
      const gain = Sim.fieldGain(c, what, key, pk); if (!gain) return;
      Sim.questEvent(c, { type: what }, now); store.put(rec);
      if (gain.ups) { Sim.setLevel(G.actors[idx], c.cl, Sim.charPower(c)); grew = true; }
      send(s.ws, { t: 'fy', ok: true, mats: gain.mats, xp: gain.xp, profile: charProfile(c), bk: store.pack(rec) });
    };
    for (const o of events) {
      if (o.k === 'gathered') { const n = Sim.FIELD.nodes.find(q => q.id === o.id); if (n) pay(o.by, 'gather', n.type); }
      else if (o.k === 'kill') for (const i of o.who) pay(i, 'kill', o.kind, o.pk);
    }
    if (grew) fieldRoster(room);
  }

  /* The field is simulated on the player's device; the server only keeps the books. It decides what a gather or
   * a kill gives, and refuses claims that come faster than the game allows: a node cannot be picked again before
   * it regrows, gathers cannot outpace the gathering time, and kills are limited to a steady rate. */
  function onField(ws, m) {
    const rec = ws.acc, c = pc(rec), now = Date.now();
    if (m.t === 'field0') { ws.field = { nodes: {}, lastG: 0, tokens: 6, at: now }; return; }
    const f = ws.field; let gain = null;
    if (f && m.t === 'fg') {
      const node = Sim.FIELD.nodes.find(n => n.id === m.id);
      if (node && now - (f.nodes[node.id] || 0) >= Sim.NODE_RESPAWN * 900 && now - f.lastG >= Sim.GATHER_TIME * 900) { f.nodes[node.id] = now; f.lastG = now; gain = Sim.fieldGain(c, 'gather', node.type); Sim.questEvent(c, { type: 'gather' }, now); }
    } else if (f && m.t === 'fk') {
      f.tokens = Math.min(6, f.tokens + (now - f.at) / 2500); f.at = now;
      // the creature's level, and so its experience, is worked out here from the account's level and the pack it names
      if (f.tokens >= 1 && typeof m.kind === 'string') { gain = Sim.fieldGain(c, 'kill', m.kind, m.pk); if (gain) { f.tokens -= 1; Sim.questEvent(c, { type: 'kill' }, now); } }
    }
    if (gain) store.put(rec);
    send(ws, { t: 'fy', ok: !!gain, mats: gain ? gain.mats : {}, xp: gain ? gain.xp : 0, profile: profileOf(rec), bk: store.pack(rec) });
  }

  /* Creating, choosing and deleting characters. Not while seated in a room: the seat belongs to one character. */
  function onChar(ws, m) {
    const rec = ws.acc, note = msg => send(ws, { t: 'note', msg });
    if ((ws.info && ws.info.room) || seats.has(rec.id)) return note('先離開房間或副本，才能換角色。');
    if (m.t === 'char-new') {
      const name = charName(m.name);
      if (rec.chars.length >= MAX_CHARS) return note(`最多只能有 ${MAX_CHARS} 個角色。`);
      if (!name) return note('角色要有名字。');
      if (!SEATS.includes(m.cls)) return note('沒有這個職業。');
      rec.chars.push(newChar(name, m.cls)); rec.cur = rec.chars.length - 1;
    } else {
      const i = m.i; if (!Number.isInteger(i) || i < 0 || i >= rec.chars.length) return note('沒有這個角色。');
      if (m.t === 'char-pick') rec.cur = i;
      else { rec.chars.splice(i, 1); rec.cur = rec.chars.length ? Math.min(rec.cur > i ? rec.cur - 1 : rec.cur, rec.chars.length - 1) : -1; }
    }
    ws.solo = null; ws.field = null; if (pc(rec)) rec.name = pc(rec).name;
    store.put(rec); sendMe(ws);
  }

  function tick() {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.state === 'lobby') {
        const hs = humans(room);
        if (!hs.length) { if (room.pub || now - room.emptySince > 120000) rooms.delete(room.key); continue; }
        if (hs.length === 4 || hs.every(s => s.ready) || (room.pub && now >= room.deadline)) startRoom(room);
        else if (room.pub && Math.floor((room.deadline - now) / 1000) !== room.lastLeft) { room.lastLeft = Math.floor((room.deadline - now) / 1000); lobbyInfo(room); }
        continue;
      }
      const G = room.G;
      if (room.slots.some(s => s && s.ws)) room.goneSince = 0;
      else { if (!room.goneSince) room.goneSince = now; if (now - room.goneSince > 20000) { endRoom(room); rooms.delete(room.key); continue; } }
      room.acc += Math.min(.25, (now - room.last) / 1000) * speed; room.last = now;
      let sent = false;
      while (room.acc >= TICK && G.state !== 'over') {
        room.acc -= TICK; Sim.step(G, TICK); room.n++; room.clock += TICK / speed;
        if (room.n % (SNAP_EVERY * speed) === 0 && !sent) { broadcast(room); sent = true; }
      }
      if (G.state === 'over') finishRoom(room);
    }
  }

  wss.on('connection', ws => {
    ws.acc = null; ws.info = null; ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'p') return send(ws, { t: 'p', c: +m.c || 0 });
      if (m.t === 'hello') return onHello(ws, m);
      if (!ws.acc) return;                               // everything else needs an account
      if (m.t === 'char-new' || m.t === 'char-pick' || m.t === 'char-del') return onChar(ws, m);
      if (NEEDS_CHAR.includes(m.t) && !pc(ws.acc)) return send(ws, { t: 'err', msg: '先創建一個角色。' });
      switch (m.t) {
        case 'join': return onJoin(ws, m);
        case 'leave': return leave(ws);
        case 'name': { const n = charName(m.name), c = pc(ws.acc); if (n && n !== c.name) { c.name = n; ws.acc.name = n; store.put(ws.acc); } return sendMe(ws); }
        case 'social': return send(ws, socialOf(ws.acc));
        case 'friend': return onFriend(ws, m);
        case 'ignore': { const id = cleanId(m.id); if (id && !ws.acc.ignored.includes(id)) { ws.acc.ignored = ws.acc.ignored.concat(id).slice(-50); store.put(ws.acc); } return send(ws, socialOf(ws.acc)); }
        case 'invite': return onInvite(ws, m);
        case 'solo0': case 'solo1': return onSolo(ws, m);
        case 'field0': case 'fg': case 'fk': return onField(ws, m);
        case 'loadout': { const r = Sim.setLoadout(pc(ws.acc), pc(ws.acc).cls, m.skills); if (r.ok) store.put(ws.acc); return send(ws, { t: 'loadout', ok: r.ok, msg: r.msg, profile: profileOf(ws.acc), bk: store.pack(ws.acc) }); }
        case 'claim': { const r = Sim.questClaim(pc(ws.acc), String(m.id), Date.now()); if (r.ok) store.put(ws.acc); return send(ws, { t: 'claimed', ok: r.ok, msg: r.msg, profile: profileOf(ws.acc), bk: store.pack(ws.acc) }); }
        case 'craft': { const r = Sim.craft(pc(ws.acc), String(m.id)); if (r.ok) { Sim.questEvent(pc(ws.acc), { type: 'craft', kind: r.kind }, Date.now()); store.put(ws.acc); } return send(ws, { t: 'crafted', ok: r.ok, msg: r.msg, profile: profileOf(ws.acc), bk: store.pack(ws.acc) }); }
      }
      const info = ws.info; if (!info || !info.room) return;
      const room = info.room;
      if (m.t === 'ready') { if (room.state === 'lobby') { room.slots[info.idx].ready = true; lobbyInfo(room); } return; }
      if (room.state !== 'run' || !room.G) return;
      const a = room.G.actors[info.idx], inp = a.input;
      if (m.t === 'm') { const x = Number(m.x), y = Number(m.y); inp.mx = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0; inp.my = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0; }
      else if (m.t === 'a') {
        if (Number.isInteger(m.c) && m.c >= 0 && m.c < 4) { inp.cast[m.c] = true; inp.aim[m.c] = Sim.cleanAim(m.aim); }   // aim is optional: a tap sends none
        else if (Number.isInteger(m.h) && m.h >= 0 && m.h < 4) inp.heal = m.h;
        else if (Number.isInteger(m.g) && m.g > 0) inp.tg = m.g;
        else if (m.p === 1) inp.pot = true;
      } else if (m.t === 'dbg' && opts.debug) {     // test hook, never enabled in production
        const G = room.G;
        if (m.k === 'skip') { G.wave = Math.max(G.wave, Sim.WAVES.length - 2); for (const e of G.enemies) e.hp = 1; }
        if (m.k === 'win' && G.boss) G.boss.hp = 1;
        if (m.k === 'hurt') a.hp = Math.round(a.maxHp * .4);
        if (m.k === 'tp' && Number.isFinite(m.x) && Number.isFinite(m.y)) { a.x = m.x; a.y = m.y; }
        if (m.k === 'weak') for (const e of G.enemies) e.hp = 1;
      }
    });
    ws.on('close', () => { unseat(ws); if (ws.acc && online.get(ws.acc.id) === ws) online.delete(ws.acc.id); });
    ws.on('error', () => {});
  });

  const loop = setInterval(tick, 1000 / 30);
  const beat = setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);
  server.listen(opts.port != null ? opts.port : (process.env.PORT || 8080), '0.0.0.0');
  const close = () => new Promise(res => { clearInterval(loop); clearInterval(beat); store.flush(); for (const ws of wss.clients) ws.terminate(); wss.close(() => server.close(res)); });
  return { server, rooms, seats, store, close };
}

if (require.main === module) {
  const s = start();
  s.server.on('listening', () => console.log(`Embertide server listening on port ${s.server.address().port}; accounts on disk: ${s.store.persistent ? 'yes' : 'no'}`));
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { s.store.flush(); process.exit(0); });
}
module.exports = { start };
