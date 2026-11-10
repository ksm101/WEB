/* End-to-end test of the multiplayer server with scripted clients. Run with: npm test */
'use strict';
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { start } = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(port, pid) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, pid, msgs: [], last: {}, snaps: 0, waiters: [] };
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString()); c.last[m.t] = m; if (m.t === 's') c.snaps++; else c.msgs.push(m);
    c.waiters = c.waiters.filter(w => { if (w.t === m.t && (!w.f || w.f(m))) { w.res(m); return false; } return true; });
  });
  c.open = new Promise(res => ws.on('open', res));
  c.send = o => ws.send(JSON.stringify(o));
  c.wait = (t, f, ms) => new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timed out waiting for "${t}" (${pid})`)), ms || 5000);
    c.waiters.push({ t, f, res: m => { clearTimeout(to); res(m); } });
  });
  c.join = (cls, room, extra) => c.send(Object.assign({ t: 'join', pid, name: pid.slice(0, 6), cls, lvl: 1, ilvl: 10, room: room || '' }, extra));
  return c;
}
const get = (port, path) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b, type: r.headers['content-type'] })); }).on('error', rej));

(async () => {
  const srv = start({ port: 0, speed: 12, lobbyWait: 600, debug: true });
  await new Promise(r => srv.server.on('listening', r));
  const port = srv.server.address().port;
  let step = 0; const ok = msg => console.log(`ok ${++step} - ${msg}`);

  // static files and health
  const h = await get(port, '/health'); assert.strictEqual(JSON.parse(h.body).embertide, 1);
  assert.match((await get(port, '/')).body, /<title>燼潮/); assert.match((await get(port, '/sim.js')).body, /createRun/);
  assert.strictEqual((await get(port, '/server.js')).status, 404); assert.strictEqual((await get(port, '/../package.json')).status, 404);
  ok('serves the page, sim.js and /health, and nothing else');

  // private room: two people, started by both pressing ready
  const A = client(port, 'aaaaaaaa01'), B = client(port, 'bbbbbbbb02'); await Promise.all([A.open, B.open]);
  A.join('dps', 'test'); let lb = await A.wait('lobby');
  assert.strictEqual(lb.code, 'TEST'); assert.strictEqual(lb.you, 2); assert.strictEqual(lb.left, -1);
  B.join('heal', 'TEST', { name: '<b>壞</b>名字超級長' }); lb = await A.wait('lobby', m => m.slots[1].name);
  assert.strictEqual(lb.slots[1].name, 'b壞/b名字超級'); assert.ok(lb.slots[1].name.length <= 8 && !/[<>]/.test(lb.slots[1].name));
  ok('private room seats two players by class and cleans names');

  const X = client(port, 'xxxxxxxx09'); await X.open; X.join('heal', 'TEST');
  assert.match((await X.wait('err')).msg, /位置滿了/);
  ok('a taken class seat is refused with a reason');

  A.send({ t: 'ready' }); await sleep(150); assert.ok(!A.last.start, 'must not start until everyone is ready');
  B.send({ t: 'ready' });
  const [sa, sb] = await Promise.all([A.wait('start'), B.wait('start')]);
  assert.strictEqual(sa.you, 2); assert.strictEqual(sb.you, 1);
  assert.deepStrictEqual(sa.roster.map(r => r.human), [false, true, true, false]);
  ok('run starts when all present players are ready; bots fill the other two seats');

  X.join('tank', 'TEST'); assert.match((await X.wait('err', m => /正在打副本/.test(m.msg))).msg, /正在打副本/);
  ok('joining a room mid-run is refused');

  // movement is applied by the server
  const s0 = await A.wait('s', m => m.st === 'run'); const x0 = s0.a[2][0];
  A.send({ t: 'm', x: -1, y: 0 }); await sleep(250); A.send({ t: 'm', x: 0, y: 0 });
  const s1 = await A.wait('s'); assert.ok(s1.a[2][0] < x0 - 20, `player should have moved left (${x0} -> ${s1.a[2][0]})`);
  A.send({ t: 'm', x: 'NaN', y: 9e9 }); A.send({ t: 'a', c: 99 }); A.send({ t: 'a', h: -3 }); A.ws.send('not json'); A.ws.send('null');
  const s2 = await A.wait('s', m => m.a[2][1] > s1.a[2][1] + 5); assert.ok(s2, 'an oversized axis value is clamped to full speed, not rejected');
  A.send({ t: 'm', x: 0, y: 0 });
  ok('server moves the player from inputs and ignores malformed input');

  // drop and return: a bot holds the seat
  B.ws.close(); const gone = await A.wait('s', m => !(m.a[1][6] & 16)); assert.ok(gone);
  const B2 = client(port, 'bbbbbbbb02'); await B2.open; B2.join('tank', '');
  const back = await B2.wait('start'); assert.strictEqual(back.you, 1); assert.strictEqual(back.roster[1].cls, 'heal');
  await A.wait('s', m => !!(m.a[1][6] & 16));
  ok('a dropped player is replaced by a bot and gets the same seat back on return');

  // play to the end
  A.send({ t: 'dbg', k: 'skip' });
  const tick = setInterval(() => { A.send({ t: 'a', c: 0 }); B2.send({ t: 'a', c: 0 }); }, 100);
  const end = await A.wait('end', null, 60000); clearInterval(tick);
  assert.strictEqual(typeof end.win, 'boolean'); assert.strictEqual(end.stats.length, 4); assert.ok(end.stats[2].dmg > 0, 'player A dealt damage');
  assert.ok(A.snaps > 20); assert.ok(JSON.stringify(A.last.s).length < 4000, 'snapshot stays small');
  ok(`run finished (win=${end.win}, ${end.time}s of dungeon time, ${A.snaps} snapshots, last snapshot ${JSON.stringify(A.last.s).length} bytes)`);

  A.join('tank', 'TEST'); lb = await A.wait('lobby', m => m.you === 0); assert.strictEqual(lb.slots.filter(s => s.name).length, 1);
  A.send({ t: 'leave' });
  ok('the private room is reusable after the run');

  // public matchmaking: strangers land in one room and it starts on a timer
  const D = client(port, 'dddddddd04'), E = client(port, 'eeeeeeee05'), F = client(port, 'ffffffff06'); await Promise.all([D.open, E.open, F.open]);
  D.join('tank'); await D.wait('lobby'); E.join('dps'); F.join('tank');
  const [sd, se, sf] = await Promise.all([D.wait('start'), E.wait('start'), F.wait('start')]);
  assert.deepStrictEqual(sd.roster.map(r => r.human), [true, false, true, false]); assert.strictEqual(se.you, 2);
  assert.deepStrictEqual(sf.roster.map(r => r.human), [true, false, false, false]);
  ok('quick match groups different classes, splits a duplicate class into a new room, and starts on the timer');

  for (const c of [A, B2, X, D, E, F]) c.ws.close();
  await sleep(200); await srv.close();
  console.log('all passed');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
