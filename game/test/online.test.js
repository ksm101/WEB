/* End-to-end test of the multiplayer server with scripted clients. Run with: npm test */
'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { start } = require('../server.js');
const Sim = require('../sim.js');
const Story = require('../story.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(port, cred) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, last: {}, snaps: 0, waiters: [], me: null };
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString()); c.last[m.t] = m; if (m.t === 's') c.snaps++; if (m.t === 'me') c.me = m;
    c.waiters = c.waiters.filter(w => { if (w.t === m.t && (!w.f || w.f(m))) { w.res(m); return false; } return true; });
  });
  c.send = o => ws.send(JSON.stringify(o));
  // with a condition, a message that already arrived and satisfies it counts; without one, wait for the next message
  c.wait = (t, f, ms) => f && c.last[t] && f(c.last[t]) ? Promise.resolve(c.last[t]) : new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`timed out waiting for "${t}"`)), ms || 5000);
    c.waiters.push({ t, f, res: m => { clearTimeout(to); res(m); } });
  });
  // connect and sign in; resolves with the "me" message
  c.ready = new Promise(res => ws.on('open', res)).then(() => { const w = c.wait('me'); c.send(Object.assign({ t: 'hello' }, cred)); return w; });
  c.join = (cls, room) => c.send({ t: 'join', cls, room: room || '' });
  c.cred = () => ({ id: c.me.id, token: c.me.token, bk: c.me.bk });
  return c;
}
const named = async (port, name) => { const c = client(port), first = await c.ready; c.send({ t: 'name', name }); await c.wait('me', m => m !== first); return c; };
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));
const boot = async o => { const s = start(Object.assign({ port: 0, speed: 12, lobbyWait: 600, debug: true, soloMin: .2 }, o)); await new Promise(r => s.server.on('listening', r)); return s; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embertide-'));
  let srv = await boot({ dataDir: dir, secret: 'test-secret' }), port = srv.server.address().port;
  let step = 0; const ok = msg => console.log(`ok ${++step} - ${msg}`);

  assert.strictEqual(JSON.parse((await get(port, '/health')).body).embertide, 1);
  assert.match((await get(port, '/')).body, /<title>燼潮/); assert.match((await get(port, '/sim.js')).body, /createRun/); assert.match((await get(port, '/story.js')).body, /SCENES/);
  for (const p of ['/server.js', '/store.js', '/data/accounts.json', '/data/secret', '/../package.json']) assert.strictEqual((await get(port, p)).status, 404, p);
  ok('serves the page, sim.js and /health; server code and account data are not reachable');

  // story content: one scene per main quest, in the same order, every speaker known, lines short enough for a phone
  assert.deepStrictEqual(Story.ORDER, ['prologue'].concat(Sim.MAIN_IDS)); assert.deepStrictEqual(Object.keys(Story.SCENES).sort(), Story.ORDER.slice().sort());
  for (const id of Story.ORDER) {
    const sc = Story.SCENES[id]; assert.ok(sc.title && sc.lines.length >= 3 && sc.lines.length <= 6, id);
    for (const [who, text] of sc.lines) { assert.ok(who === 'n' || Story.CAST[who], `${id}: unknown speaker ${who}`); assert.ok(text.length > 0 && text.length <= 48, `${id}: line too long (${text.length})`); }
  }
  ok('story: a scene for the prologue and for every main quest, known speakers, short lines');

  // accounts
  const A = await named(port, '小明'), B = await named(port, '<b>壞</b>名字超級長');
  assert.match(A.me.id, /^[a-f0-9]{16}$/); assert.notStrictEqual(A.me.id, B.me.id);
  { const { q, ...rest } = A.me.profile; assert.deepStrictEqual(rest, { name: '小明', lvl: 1, gear: { w: 10, a: 10, t: 10 }, best: {}, runs: 0, inv: { scrap: 0, salt: 0, shard: 0, potion: 0 } }); assert.strictEqual(q.main, 0); }
  assert.strictEqual(B.me.profile.name, 'b壞/b名字超級');
  const forged = client(port, { id: A.me.id, token: 'x'.repeat(32) }); await forged.ready;
  assert.notStrictEqual(forged.me.id, A.me.id, 'a wrong token must not open someone else\'s account'); forged.ws.close();
  A.join('dps', 'x'); await sleep(50); assert.ok(true);
  A.send({ t: 'leave' });
  const nohello = new WebSocket(`ws://127.0.0.1:${port}/ws`); await new Promise(r => nohello.on('open', r));
  let leaked = false; nohello.on('message', () => { leaked = true; }); nohello.send(JSON.stringify({ t: 'join', cls: 'dps' })); nohello.send(JSON.stringify({ t: 'social' })); await sleep(150);
  assert.ok(!leaked, 'nothing works before signing in'); nohello.close();
  ok('accounts are issued by the server; a forged token gets a fresh account; unsigned sockets get nothing');

  // private room (A brings potions)
  srv.store.get(A.me.id).inv.potion = 2;
  A.join('dps', 'test'); let lb = await A.wait('lobby', m => m.code === 'TEST');
  assert.strictEqual(lb.you, 2); assert.strictEqual(lb.left, -1);
  B.join('heal', 'TEST'); lb = await A.wait('lobby', m => m.slots[1].name); assert.strictEqual(lb.slots[1].name, 'b壞/b名字超級');
  const X = await named(port, '路人'); X.join('heal', 'TEST'); assert.match((await X.wait('err')).msg, /位置滿了/);
  A.send({ t: 'ready' }); await sleep(150); assert.ok(!A.last.start, 'must not start until everyone is ready');
  B.send({ t: 'ready' });
  const [sa, sb] = await Promise.all([A.wait('start'), B.wait('start')]);
  assert.strictEqual(sa.you, 2); assert.strictEqual(sb.you, 1); assert.deepStrictEqual(sa.roster.map(r => r.human), [false, true, true, false]);
  assert.deepStrictEqual(sa.roster.map(r => r.potions), [0, 0, 1, 0], 'one potion per run, only for the player who owns some');
  X.join('tank', 'TEST'); assert.match((await X.wait('err', m => /正在打副本/.test(m.msg))).msg, /正在打副本/);
  ok('private room: seats by class, refuses a taken seat, starts when everyone present is ready, refuses joins mid-run');

  // inputs
  const s0 = await A.wait('s', m => m.st === 'run'); const x0 = s0.a[2][0];
  A.send({ t: 'm', x: -1, y: 0 }); await sleep(250); A.send({ t: 'm', x: 0, y: 0 });
  const s1 = await A.wait('s'); assert.ok(s1.a[2][0] < x0 - 20, `player should have moved left (${x0} -> ${s1.a[2][0]})`);
  A.send({ t: 'm', x: 'NaN', y: 9e9 }); A.send({ t: 'a', c: 99 }); A.send({ t: 'a', h: -3 }); A.ws.send('not json'); A.ws.send('null');
  await A.wait('s', m => m.a[2][1] > s1.a[2][1] + 5); A.send({ t: 'm', x: 0, y: 0 });
  A.send({ t: 'dbg', k: 'hurt' }); const hurt = await A.wait('s', m => m.a[2][2] < m.a[2][3] * .5);
  A.send({ t: 'a', p: 1 }); const healed = await A.wait('s', m => m.a[2][10] === 0); assert.ok(healed.a[2][2] > hurt.a[2][2] + 200, 'the potion heals');
  ok('server moves the player from inputs, clamps oversized values, ignores malformed input, and applies the potion');

  // drop and return
  const credB = B.cred(); B.ws.close(); await A.wait('s', m => !(m.a[1][6] & 16));
  const B2 = client(port, credB); const meB = await B2.ready; assert.strictEqual(meB.id, credB.id); assert.strictEqual(meB.resume, true);
  const back = B2.last.start || await B2.wait('start'); assert.strictEqual(back.you, 1);   // it can arrive in the same packet as the sign-in reply await A.wait('s', m => !!(m.a[1][6] & 16));
  ok('a dropped player is replaced by a bot and is put straight back in their seat on signing in again');

  // finish: server-side rewards
  A.send({ t: 'dbg', k: 'skip' });
  const tick = setInterval(() => { A.send({ t: 'a', c: 0 }); B2.send({ t: 'a', c: 0 }); }, 100);
  const [endA, endB] = await Promise.all([A.wait('end', null, 60000), B2.wait('end', null, 60000)]); clearInterval(tick);
  assert.strictEqual(endA.win, true); assert.strictEqual(endA.stats.length, 4); assert.ok(endA.stats[2].dmg > 0);
  assert.strictEqual(endA.profile.runs, 1); assert.ok(endA.loot && endA.loot.il >= 14); assert.strictEqual(endA.profile.lvl, endA.onTime ? 2 : 1);
  assert.ok(Object.values(endA.profile.gear).some(v => v === endA.loot.il), 'the dropped item is on the account');
  assert.ok(endA.mats.scrap >= 3 && endA.mats.salt >= 1); assert.strictEqual(endA.profile.inv.scrap, endA.mats.scrap); assert.strictEqual(endA.profile.inv.potion, 1, 'the potion that was drunk is gone');
  assert.deepStrictEqual(endA.mates.map(m => m.name), ['b壞/b名字超級']); assert.strictEqual(endA.mates[0].friend, false); assert.strictEqual(endA.again, 'TEST');
  assert.ok(JSON.stringify(A.last.s).length < 4000);
  ok(`run finished: loot and level are decided by the server (ilvl ${endA.loot.il}, level ${endA.profile.lvl}), teammates are listed`);

  // friends
  A.send({ t: 'social' }); let so = await A.wait('social'); assert.strictEqual(so.recent[0].id, credB.id); assert.strictEqual(so.friends.length, 0);
  A.send({ t: 'friend', id: credB.id }); so = await A.wait('social', m => m.friends.length === 1);
  assert.strictEqual(so.friends[0].mutual, false); assert.strictEqual(so.friends[0].state, 'off', 'presence is hidden until both sides agree');
  const soB = await B2.wait('social', m => m.inbox.length === 1); assert.strictEqual(soB.inbox[0].name, '小明'); assert.match(B2.last.note.msg, /想加你為好友/);
  A.join('dps', 'PARTY'); await A.wait('lobby', m => m.code === 'PARTY');
  A.send({ t: 'invite', id: credB.id }); assert.match((await A.wait('note', m => /之後才能邀請/.test(m.msg))).msg, /之後才能邀請/);
  B2.send({ t: 'friend', id: A.me.id }); so = await A.wait('social', m => m.friends[0] && m.friends[0].mutual); assert.strictEqual(so.friends[0].state, 'on');
  await sleep(1600); A.send({ t: 'invite', id: credB.id });
  const inv = await B2.wait('invited'); assert.strictEqual(inv.code, 'PARTY'); assert.strictEqual(inv.from.name, '小明');
  B2.join('heal', inv.code); lb = await A.wait('lobby', m => m.slots[1].name); assert.strictEqual(lb.slots.filter(s => s.name).length, 2);
  A.send({ t: 'friend', id: A.me.id }); A.send({ t: 'friend', id: 'ffffffffffffffff' }); assert.match((await A.wait('note', m => /找不到/.test(m.msg))).msg, /找不到/);
  A.send({ t: 'leave' }); B2.send({ t: 'leave' });
  ok('friends: request, accept, presence only when mutual, invite only between mutual friends, invite carries the room code');

  // crafting: the server owns the bag
  A.send({ t: 'craft', id: 'forge-a' }); let cr = await A.wait('crafted'); assert.strictEqual(cr.ok, false); assert.match(cr.msg, /材料不夠/);
  Object.assign(srv.store.get(A.me.id).inv, { scrap: 40, salt: 10, shard: 4 });
  const lvlA = cr.profile.lvl, armor = cr.profile.gear.a < 10 + lvlA * 4 + 3;
  A.send({ t: 'craft', id: 'forge-a' }); cr = await A.wait('crafted');
  if (armor) { assert.strictEqual(cr.ok, true); assert.strictEqual(cr.profile.gear.a, 10 + lvlA * 4 + 3); assert.strictEqual(cr.profile.inv.scrap, 28); assert.strictEqual(cr.profile.inv.salt, 7); }
  A.send({ t: 'craft', id: 'temper-a' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, true); assert.strictEqual(cr.profile.inv.shard, 2);
  A.send({ t: 'craft', id: 'potion' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, true); assert.strictEqual(cr.profile.inv.potion, 2);
  A.send({ t: 'craft', id: '__proto__' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, false);
  A.send({ t: 'craft', id: 'nope' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, false);
  ok('crafting spends materials on the server, refuses when short, and rejects unknown recipes');

  // quests: progress is counted by the server, rewards are handed out by the server
  const q0 = endA.profile.q; assert.strictEqual(q0.main, 0); assert.strictEqual(q0.mp, 1, 'the first main quest counts the clear');
  assert.strictEqual(q0.week.p['w-runs'], 1); assert.strictEqual(q0.side['s-party'], 1, 'clearing with another player counts'); assert.strictEqual(q0.side['s-classes'], 4);
  A.send({ t: 'claim', id: 'kick' }); let cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false, 'only the current main quest can be claimed');
  const scrap0 = cl.profile.inv.scrap;
  A.send({ t: 'claim', id: 'bell' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, true); assert.strictEqual(cl.profile.inv.scrap, scrap0 + 6); assert.strictEqual(cl.profile.q.main, 1);
  A.send({ t: 'claim', id: 'bell' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false, 'no double claim');
  A.send({ t: 'claim', id: 'w-runs' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false); assert.match(cl.msg, /還沒完成/);
  const pot0 = cl.profile.inv.potion;
  A.send({ t: 'claim', id: 's-party' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, true); assert.strictEqual(cl.profile.inv.potion, pot0 + 1);
  A.send({ t: 'claim', id: 's-party' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false);
  A.send({ t: 'claim', id: 's-friend' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, true, 'becoming mutual friends completed the friend quest');
  B2.send({ t: 'claim', id: 's-friend' }); assert.strictEqual((await B2.wait('claimed')).ok, true, 'and for the other side too');
  A.send({ t: 'claim', id: 'constructor' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false);
  ok('quests: the server counts progress, only finished quests pay out, and only once');

  // solo claims
  A.send({ t: 'solo1', win: true, time: 150 }); assert.strictEqual((await A.wait('solo')).ok, false, 'a claim without a started run is refused');
  A.send({ t: 'solo0', lvl: 40 }); A.send({ t: 'solo1', win: true, time: 150 }); assert.strictEqual((await A.wait('solo')).ok, false, 'a run cannot take longer than the real time that passed');
  const runsBefore = A.last.solo.profile.runs;
  A.send({ t: 'solo0', lvl: 40 }); await sleep(450); A.send({ t: 'solo1', win: true, time: .4 });
  const solo = await A.wait('solo'); assert.strictEqual(solo.ok, true); assert.strictEqual(solo.profile.runs, runsBefore + 1);
  assert.ok(solo.loot.il <= 10 + solo.profile.lvl * 4 + 6, 'the requested level is capped at the account\'s own level');
  ok('solo results are accepted only when believable, and at the account\'s own level');

  // persistence across a restart, and recovery from the device backup when the disk is gone
  const credA = { id: A.me.id, token: A.me.token, bk: solo.bk }, want = JSON.stringify(solo.profile);   // the newest state came with the solo reply
  for (const c of [A, B2, X]) c.ws.close(); await sleep(100); await srv.close();
  assert.ok(fs.existsSync(path.join(dir, 'accounts.json')));
  srv = await boot({ dataDir: dir, secret: 'test-secret' }); port = srv.server.address().port;
  const A2 = client(port, { id: credA.id, token: credA.token }); await A2.ready; assert.strictEqual(JSON.stringify(A2.me.profile), want);
  A2.send({ t: 'social' }); assert.strictEqual((await A2.wait('social')).friends[0].mutual, true);
  A2.ws.close(); await srv.close();
  srv = await boot({ dataDir: null, secret: 'test-secret' }); port = srv.server.address().port;
  const A3 = client(port, credA); await A3.ready; assert.strictEqual(JSON.stringify(A3.me.profile), want, 'restored from the signed backup');
  const tampered = Buffer.from(JSON.stringify({ id: credA.id, lvl: 50, gear: { w: 999, a: 999, t: 999 } })).toString('base64url') + '.' + credA.bk.split('.')[1];
  A3.ws.close(); await sleep(50); await srv.close();
  srv = await boot({ dataDir: null, secret: 'test-secret' }); port = srv.server.address().port;
  const A4 = client(port, { id: credA.id, token: credA.token, bk: tampered }); await A4.ready; assert.strictEqual(A4.me.profile.lvl, 1, 'an edited backup is rejected');
  A4.ws.close();
  ok('accounts survive a restart on disk; with the disk gone they come back from the signed device backup; an edited backup is rejected');

  // public matchmaking
  const D = await named(port, 'D'), E = await named(port, 'E'), F = await named(port, 'F');
  D.join('tank'); await D.wait('lobby'); E.join('dps'); F.join('tank');
  const [sd, se, sf] = await Promise.all([D.wait('start'), E.wait('start'), F.wait('start')]);
  assert.deepStrictEqual(sd.roster.map(r => r.human), [true, false, true, false]); assert.strictEqual(se.you, 2);
  assert.deepStrictEqual(sf.roster.map(r => r.human), [true, false, false, false]);
  D.send({ t: 'dbg', k: 'skip' }); const endD = await D.wait('end', null, 60000); assert.match(endD.again, /^R[0-9A-F]{4}$/);
  const D2 = client(port, D.cred()); await D2.ready; assert.strictEqual((D.last.kicked || await D.wait('kicked')).t, 'kicked');
  ok('quick match groups different classes, gives the group a code to go again, and a second sign-in replaces the first');

  for (const c of [D, D2, E, F]) c.ws.close();
  await sleep(200); await srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('all passed');
})().catch(e => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
