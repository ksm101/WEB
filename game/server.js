/* Embertide multiplayer server.
 * Serves the client page and runs every dungeon on the server: clients send only their inputs
 * and receive snapshots. Empty seats, and seats whose player dropped, are played by bots. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Sim = require('./sim.js');

const TICK = 1 / 30;            // simulation step
const SNAP_EVERY = 2;           // snapshot every 2 steps = 15 per second
const MAX_ROOMS = 200;
const SEATS = Sim.ROSTER;       // tank, heal, dps, dps
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/sim.js': ['sim.js', 'text/javascript; charset=utf-8']
};

const clampInt = (v, a, b) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a; };
const cleanName = s => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, 8) : '') || '旅人';
const cleanCode = s => typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
const cleanPid = s => typeof s === 'string' && /^[a-z0-9]{8,40}$/i.test(s) ? s : '';

function start(opts) {
  opts = opts || {};
  const speed = opts.speed || 1;                       // tests fast-forward the simulation
  const lobbyWait = opts.lobbyWait != null ? opts.lobbyWait : 8000;
  const rooms = new Map();                             // key -> room
  const seats = new Map();                             // pid -> { room, idx } while a run is going
  let publicN = 0;

  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/health') {
      let players = 0; for (const r of rooms.values()) players += r.slots.filter(s => s && s.ws).length;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ embertide: 1, rooms: rooms.size, players }));
    }
    const f = FILES[url];
    if (!f || req.method !== 'GET') { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    fs.readFile(path.join(__dirname, f[0]), (err, buf) => {
      if (err) { res.writeHead(500); return res.end('error'); }
      res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' }); res.end(buf);
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

  const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const humans = room => room.slots.filter(Boolean);

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
    const room = info.room, slot = room.slots[info.idx]; info.room = null;
    if (!slot || slot.ws !== ws) return;
    if (room.state === 'lobby') { room.slots[info.idx] = null; if (!humans(room).length) room.emptySince = Date.now(); lobbyInfo(room); }
    else { slot.ws = null; if (room.G) room.G.actors[info.idx].human = false; }   // a bot plays this seat until they come back
  }
  function leave(ws) {      // leaving on purpose: no seat is held for a return
    const info = ws.info; if (info && info.room && info.room.state === 'run') seats.delete(info.pid);
    unseat(ws);
  }

  function onJoin(ws, m) {
    const pid = cleanPid(m.pid); if (!pid) return send(ws, { t: 'err', msg: '連線資料不完整，重新整理頁面再試一次。' });
    const held = seats.get(pid);
    if (held && held.room.state === 'run' && rooms.get(held.room.key) === held.room) {   // returning to a run in progress
      const room = held.room, slot = room.slots[held.idx];
      if (ws.info && ws.info.room === room) return sendStart(room, held.idx);
      if (slot.ws && slot.ws !== ws) { slot.ws.info.room = null; slot.ws.close(); }
      leave(ws); slot.ws = ws; ws.info = { pid, room, idx: held.idx }; room.G.actors[held.idx].human = true; room.goneSince = 0;
      return sendStart(room, held.idx);
    }
    leave(ws);
    const cls = SEATS.includes(m.cls) ? m.cls : 'dps';
    const lvl = clampInt(m.lvl, 1, 50), ilvl = clampInt(m.ilvl, 10, 10 + lvl * 4 + 8);
    const code = cleanCode(m.room); let room = null, idx = -1;
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
    for (const r of rooms.values()) r.slots.forEach(s => { if (s && s.pid === pid && s.ws && s.ws !== ws && r.state === 'lobby') { const old = s.ws; unseat(old); old.close(); } });
    room.slots[idx] = { pid, name: cleanName(m.name), cls, lvl, pow: 1 + (ilvl - 10) * .02, ws, ready: false };
    ws.info = { pid, room, idx };
    const now = Date.now();
    room.deadline = room.deadline ? Math.max(room.deadline, now + Math.min(3000, lobbyWait)) : now + lobbyWait;
    lobbyInfo(room);
  }
  function sendStart(room, only) {
    const G = room.G;
    room.slots.forEach((s, i) => {
      if (!s || (only != null && only !== i)) return;
      send(s.ws, { t: 'start', you: i, lvl: G.lvl, roster: G.actors.map(a => ({ cls: a.cls, name: a.name, human: a.human, maxHp: a.maxHp })) });
    });
  }
  function startRoom(room) {
    const hs = humans(room);
    const lvl = Math.min.apply(null, hs.map(s => s.lvl));
    room.G = Sim.createRun({ lvl, grace: 12, players: room.slots.filter(Boolean).map(s => ({ cls: s.cls, name: s.name, pow: s.pow, id: s.pid })) });
    // seats and actors share the same order, so slot i drives actor i
    room.slots.forEach((s, i) => { if (s) { if (room.G.actors[i].pid !== s.pid) throw new Error('seat mismatch'); seats.set(s.pid, { room, idx: i }); } });
    room.state = 'run'; room.acc = 0; room.n = 0; room.clock = 0; room.goneSince = 0; room.last = Date.now();
    sendStart(room);
  }
  function endRoom(room) {
    for (const s of humans(room)) { seats.delete(s.pid); if (s.ws && s.ws.info) s.ws.info.room = null; }
    room.G = null;
    if (room.pub) rooms.delete(room.key);
    else { room.state = 'lobby'; room.slots = [null, null, null, null]; room.deadline = 0; room.emptySince = Date.now(); }
  }
  function broadcast(room, extra) {
    const G = room.G, snap = Sim.snapshot(G);
    snap.t = 's'; snap.c = Math.round(room.clock * 1000); snap.ev = G.events; G.events = [];
    const msg = JSON.stringify(snap);
    for (const s of room.slots) if (s && s.ws && s.ws.readyState === 1) { s.ws.send(msg); if (extra) s.ws.send(extra); }
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
      if (!room.slots.some(s => s && s.ws)) { if (!room.goneSince) room.goneSince = now; if (now - room.goneSince > 20000) { endRoom(room); rooms.delete(room.key); continue; } }
      room.acc += Math.min(.25, (now - room.last) / 1000) * speed; room.last = now;
      let sent = false;
      while (room.acc >= TICK && G.state !== 'over') {
        room.acc -= TICK; Sim.step(G, TICK); room.n++; room.clock += TICK / speed;
        if (room.n % (SNAP_EVERY * speed) === 0 && !sent) { broadcast(room); sent = true; }
      }
      if (G.state === 'over') {
        const r = G.result;
        broadcast(room, JSON.stringify({ t: 'end', win: r.win, onTime: r.onTime, time: Math.round(r.t * 10) / 10, lvl: G.lvl,
          stats: G.actors.map(a => ({ dmg: Math.round(a.stats.dmg), heal: Math.round(a.stats.heal), kicks: a.stats.kicks, hits: a.stats.hits })) }));
        endRoom(room);
      }
    }
  }

  wss.on('connection', ws => {
    ws.info = null; ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') return onJoin(ws, m);
      if (m.t === 'p') return send(ws, { t: 'p', c: +m.c || 0 });
      const info = ws.info; if (!info || !info.room) return;
      const room = info.room;
      if (m.t === 'leave') return leave(ws);
      if (m.t === 'ready') { if (room.state === 'lobby') { room.slots[info.idx].ready = true; lobbyInfo(room); } return; }
      if (room.state !== 'run' || !room.G) return;
      const a = room.G.actors[info.idx], inp = a.input;
      if (m.t === 'm') { const x = Number(m.x), y = Number(m.y); inp.mx = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0; inp.my = Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0; }
      else if (m.t === 'a') {
        if (Number.isInteger(m.c) && m.c >= 0 && m.c < 4) inp.cast[m.c] = true;
        else if (Number.isInteger(m.h) && m.h >= 0 && m.h < 4) inp.heal = m.h;
        else if (Number.isInteger(m.g) && m.g > 0) inp.tg = m.g;
      } else if (m.t === 'dbg' && opts.debug) {     // test hook, never enabled in production
        const G = room.G;
        if (m.k === 'skip') { G.wave = Math.max(G.wave, Sim.WAVES.length - 2); for (const e of G.enemies) e.hp = 1; }
        if (m.k === 'win' && G.boss) G.boss.hp = 1;
      }
    });
    ws.on('close', () => unseat(ws));
    ws.on('error', () => {});
  });

  const loop = setInterval(tick, 1000 / 30);
  const beat = setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);
  server.listen(opts.port != null ? opts.port : (process.env.PORT || 8080), '0.0.0.0');
  return { server, rooms, seats, close: () => new Promise(res => { clearInterval(loop); clearInterval(beat); for (const ws of wss.clients) ws.terminate(); wss.close(() => server.close(res)); }) };
}

if (require.main === module) {
  const s = start();
  s.server.on('listening', () => console.log('Embertide server listening on port ' + s.server.address().port));
}
module.exports = { start };
