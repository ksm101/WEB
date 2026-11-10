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
// sign in and create one character of the given class
const named = async (port, name, cls) => { const c = client(port), first = await c.ready; c.send({ t: 'char-new', name, cls: cls || 'dps' }); await c.wait('me', m => m !== first); return c; };
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));
const boot = async o => { const s = start(Object.assign({ port: 0, speed: 12, lobbyWait: 600, debug: true, soloMin: .2, eventPeriod: 1e13, eventDur: 0, backupEvery: 300, lootWait: 1500 }, o)); await new Promise(r => s.server.on('listening', r)); return s; };

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
    if (id !== 'prologue') assert.ok(Sim.FIELD.npcs.some(n => n.id === sc.at), `${id}: nobody at the camp hands this in`);
    for (const [who, text] of sc.lines) { assert.ok(who === 'n' || Story.CAST[who], `${id}: unknown speaker ${who}`); assert.ok(text.length > 0 && text.length <= 48, `${id}: line too long (${text.length})`); }
  }
  for (const n of Sim.FIELD.npcs) { assert.ok(Story.CAST[n.id] && Story.IDLE[n.id].length >= 2, n.id); for (const t of Story.IDLE[n.id]) assert.ok(t.length <= 48, t); }
  ok('story: a scene for the prologue and for every main quest, each handed in by someone at the camp, short lines');

  // levels: experience curve, level cap, creatures that follow the player inside a range, shrinking experience from weak ones
  assert.ok(Sim.xpNeed(1) < Sim.xpNeed(2) && Sim.xpNeed(10) < Sim.xpNeed(20)); assert.strictEqual(Sim.xpNeed(Sim.MAX_LEVEL), 0);
  { const pr = Sim.fixProfile(Sim.newProfile()); assert.strictEqual(Sim.addXp(pr, Sim.xpNeed(1) + Sim.xpNeed(2) + 5).ups, 2); assert.strictEqual(pr.cl, 3); assert.strictEqual(pr.xp, 5);
    pr.cl = Sim.MAX_LEVEL; pr.xp = 0; assert.strictEqual(Sim.addXp(pr, 1e6).ups, 0); assert.strictEqual(pr.cl, Sim.MAX_LEVEL); }
  for (const pk of Sim.FIELD.packs) { assert.ok(pk.min >= 1 && pk.max >= pk.min && pk.max < Sim.MAX_LEVEL); assert.strictEqual(Sim.mobLevel(pk, 1), pk.min); assert.strictEqual(Sim.mobLevel(pk, pk.max - 1 < pk.min ? pk.min : pk.max - 1), Math.max(pk.min, pk.max - 1)); assert.strictEqual(Sim.mobLevel(pk, 30), pk.max, 'a creature never goes above its cap'); }
  assert.ok(Sim.xpForKill('crab', 6, 6) > Sim.xpForKill('crab', 6, 10)); assert.ok(Sim.xpForKill('crab', 6, 10) > Sim.xpForKill('crab', 6, 20)); assert.ok(Sim.xpForKill('crab', 6, 20) >= 1);
  { const Gf = Sim.createField({ lvl: 1, player: { cls: 'dps', name: 'x', pow: 1, id: 'me', lvl: 1 } }), e0 = Gf.enemies.find(e => e.pk === 0), hp1 = e0.maxHp;
    Sim.setLevel(Gf.actors[0], 4, Sim.lvF(4)); Sim.step(Gf, 1 / 30); assert.strictEqual(e0.lvl, 4); assert.ok(e0.maxHp > hp1, 'creatures grow with you');
    Sim.setLevel(Gf.actors[0], 25, Sim.lvF(25)); Sim.step(Gf, 1 / 30); assert.strictEqual(e0.lvl, Sim.FIELD.packs[0].max, 'and stop at their cap'); }
  ok('levels: curve and cap, creatures scale with the player inside a range, weak creatures give little experience');

  // accounts
  const A = await named(port, '小明', 'dps'), B = await named(port, '<b>壞</b>名字超級長', 'heal');
  assert.match(A.me.id, /^[a-f0-9]{16}$/); assert.notStrictEqual(A.me.id, B.me.id);
  { const { q, loadout, talents, eq, bag, ...rest } = A.me.profile; assert.deepStrictEqual(loadout, {}); assert.deepStrictEqual(talents, {}); assert.deepStrictEqual(bag, []); assert.deepStrictEqual(eq.w, { n: '', q: 0 }); assert.deepStrictEqual(rest, { name: '小明', cls: 'dps', lvl: 1, cl: 1, xp: 0, gear: { w: 10, a: 10, t: 10 }, best: {}, runs: 0, coin: 0, inv: { scrap: 0, salt: 0, shard: 0, herb: 0, potion: 0 } }); assert.strictEqual(q.main, 0); }
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
  srv.store.get(A.me.id).chars[0].inv.potion = 2;
  A.join('dps', 'test'); let lb = await A.wait('lobby', m => m.code === 'TEST');
  assert.strictEqual(lb.you, 2); assert.strictEqual(lb.left, -1);
  B.join('heal', 'TEST'); lb = await A.wait('lobby', m => m.slots[1].name); assert.strictEqual(lb.slots[1].name, 'b壞/b名字超級');
  const X = await named(port, '路人', 'heal'); X.join('heal', 'TEST'); assert.match((await X.wait('err')).msg, /位置滿了/);
  A.send({ t: 'ready' }); await sleep(150); assert.ok(!A.last.start, 'must not start until everyone is ready');
  B.send({ t: 'ready' });
  const [sa, sb] = await Promise.all([A.wait('start'), B.wait('start')]);
  assert.strictEqual(sa.you, 2); assert.strictEqual(sb.you, 1); assert.deepStrictEqual(sa.roster.map(r => r.human), [false, true, true, false]);
  assert.deepStrictEqual(sa.roster.map(r => r.potions), [0, 0, 1, 0], 'one potion per run, only for the player who owns some');
  assert.deepStrictEqual(sa.roster.map(r => r.lvl), [1, 1, 1, 1], 'everyone in the roster carries a level for their nameplate');
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
  assert.strictEqual(endA.profile.runs, 1); assert.deepStrictEqual(endA.loot, [], 'a group gets no gear straight away'); assert.strictEqual(endA.profile.lvl, endA.onTime ? 2 : 1);
  assert.ok(endA.xp >= 150 && endA.profile.cl >= 2, 'a clear gives experience'); assert.ok(endA.coin >= 30 && endA.profile.coin === endA.coin, 'and coin');
  assert.ok(endA.mats.scrap >= 3 && endA.mats.salt >= 1); assert.strictEqual(endA.profile.inv.scrap, endA.mats.scrap); assert.strictEqual(endA.profile.inv.potion, 1, 'the potion that was drunk is gone');
  assert.deepStrictEqual(endA.mates.map(m => m.name), ['b壞/b名字超級']); assert.strictEqual(endA.mates[0].friend, false); assert.strictEqual(endA.again, 'TEST');
  assert.ok(JSON.stringify(A.last.s).length < 4000);
  ok(`run finished: rewards and level are decided by the server (level ${endA.profile.lvl}), teammates are listed`);

  // the group's gear: a pile, divided by rolling
  { const pl = endA.pile; assert.ok(pl && pl.mode === 'roll' && pl.items.length >= 2 && pl.items.length <= 5, 'two people share at least the two pieces from the boss');
    assert.deepStrictEqual(pl.members.map(x => x.name), ['b壞/b名字超級', '小明']); assert.strictEqual(pl.you, 1); assert.strictEqual(endB.pile.you, 0); assert.strictEqual(endB.pile.id, pl.id);
    for (const it of pl.items) assert.deepStrictEqual(Sim.fixItem(it), it);
    const X2 = await named(port, '外人', 'dps'); X2.send({ t: 'roll', L: pl.id, i: 0, k: 'need' });           // not in the group: ignored
    A.send({ t: 'roll', L: pl.id, i: 0, k: 'need' }); A.send({ t: 'roll', L: pl.id, i: 0, k: 'pass' }); A.send({ t: 'roll', L: pl.id, i: 9, k: 'need' }); await sleep(120); assert.ok(!A.last.loot, 'nothing is decided until everyone has answered');
    B2.send({ t: 'roll', L: pl.id, i: 0, k: 'greed' });
    const [la, lb2] = await Promise.all([A.wait('loot', m => m.i === 0), B2.wait('loot', m => m.i === 0)]);
    assert.strictEqual(la.win, 1, 'need beats greed'); assert.strictEqual(la.rolls.length, 2); assert.ok(la.rolls.every(x => x[2] >= 1 && x[2] <= 100)); assert.strictEqual(lb2.give, undefined); assert.strictEqual(lb2.profile, undefined);
    assert.strictEqual(la.give.up, true); assert.strictEqual(la.profile.gear[pl.items[0].s], pl.items[0].il, 'the winner wears it'); assert.strictEqual(la.profile.eq[pl.items[0].s].n, pl.items[0].n);
    for (let i = 1; i < pl.items.length; i++) { A.send({ t: 'roll', L: pl.id, i, k: 'pass' }); B2.send({ t: 'roll', L: pl.id, i, k: i === 1 ? 'pass' : 'greed' }); }
    const l1 = await A.wait('loot', m => m.i === 1); assert.strictEqual(l1.win, -1, 'everyone passed: nobody takes it');
    if (pl.items.length > 2) assert.strictEqual((await B2.wait('loot', m => m.i === 2)).win, 0);
    await sleep(100); assert.strictEqual(srv.loots.size, 0, 'the pile is gone once every piece is decided'); X2.ws.close();
  }
  ok('group loot: the drops form a pile, need beats greed, a pass takes nothing, outsiders cannot roll');

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
  Object.assign(srv.store.get(A.me.id).chars[0].inv, { scrap: 40, salt: 10, shard: 4, herb: 5 });
  const lvlA = cr.profile.lvl, armor = cr.profile.gear.a < 10 + lvlA * 4 + 3;
  A.send({ t: 'craft', id: 'forge-a' }); cr = await A.wait('crafted');
  if (armor) { assert.strictEqual(cr.ok, true); assert.strictEqual(cr.profile.gear.a, 10 + lvlA * 4 + 3); assert.strictEqual(cr.profile.inv.scrap, 28); assert.strictEqual(cr.profile.inv.salt, 7); }
  A.send({ t: 'craft', id: 'temper-a' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, true); assert.strictEqual(cr.profile.inv.shard, 2);
  A.send({ t: 'craft', id: 'potion' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, true); assert.strictEqual(cr.profile.inv.potion, 2); assert.strictEqual(cr.profile.inv.herb, 3, 'the potion uses the field herb');
  A.send({ t: 'craft', id: '__proto__' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, false);
  A.send({ t: 'craft', id: 'nope' }); cr = await A.wait('crafted'); assert.strictEqual(cr.ok, false);
  ok('crafting spends materials on the server, refuses when short, and rejects unknown recipes');

  // quests: progress is counted by the server, rewards are handed out by the server
  const q0 = endA.profile.q; assert.strictEqual(q0.main, 0); assert.strictEqual(q0.mp, 1, 'the first main quest counts the clear');
  assert.strictEqual(q0.week.p['w-runs'], 1); assert.strictEqual(q0.side['s-party'], 1, 'clearing with another player counts'); assert.strictEqual(q0.side['s-level'], endA.profile.cl, 'the level quest follows the character');
  A.send({ t: 'claim', id: 'kick' }); let cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false, 'only the current main quest can be claimed');
  const scrap0 = cl.profile.inv.scrap;
  const lv0 = cl.profile.cl * 1e6 + cl.profile.xp;
  A.send({ t: 'claim', id: 'bell' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, true); assert.strictEqual(cl.profile.inv.scrap, scrap0 + 6); assert.strictEqual(cl.profile.q.main, 1);
  assert.ok(cl.profile.cl * 1e6 + cl.profile.xp > lv0, 'quests give experience'); assert.match(cl.msg, /經驗 \+120/);
  A.send({ t: 'claim', id: 'bell' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false, 'no double claim');
  A.send({ t: 'claim', id: 'w-runs' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false); assert.match(cl.msg, /還沒完成/);
  const pot0 = cl.profile.inv.potion;
  A.send({ t: 'claim', id: 's-party' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, true); assert.strictEqual(cl.profile.inv.potion, pot0 + 1);
  A.send({ t: 'claim', id: 's-party' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false);
  A.send({ t: 'claim', id: 's-friend' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, true, 'becoming mutual friends completed the friend quest');
  B2.send({ t: 'claim', id: 's-friend' }); assert.strictEqual((await B2.wait('claimed')).ok, true, 'and for the other side too');
  A.send({ t: 'claim', id: 'constructor' }); cl = await A.wait('claimed'); assert.strictEqual(cl.ok, false);
  ok('quests: the server counts progress, only finished quests pay out, and only once');

  // field ledger: the device says what happened, the server decides what it was worth and how fast it may happen
  A.send({ t: 'fg', id: 1 }); let fy = await A.wait('fy'); assert.strictEqual(fy.ok, false, 'no field session yet');
  A.send({ t: 'field0' }); const herb0 = fy.profile.inv.herb;
  A.send({ t: 'fg', id: 1 }); fy = await A.wait('fy'); assert.strictEqual(fy.ok, true); assert.ok(fy.mats.herb >= 1); assert.strictEqual(fy.profile.inv.herb, herb0 + fy.mats.herb); assert.strictEqual(fy.profile.q.side['s-gather'], 1); assert.strictEqual(fy.xp, 5);
  A.send({ t: 'fg', id: 1 }); fy = await A.wait('fy'); assert.strictEqual(fy.ok, false, 'the same node has not regrown');
  A.send({ t: 'fg', id: 7 }); fy = await A.wait('fy'); assert.strictEqual(fy.ok, false, 'two gathers cannot be faster than the gathering time');
  A.send({ t: 'fg', id: 999 }); fy = await A.wait('fy'); assert.strictEqual(fy.ok, false);
  A.send({ t: 'fk', kind: 'crab', pk: 3 }); assert.strictEqual((await A.wait('fy')).ok, false, 'pack 3 is not crabs'); A.send({ t: 'fk', kind: 'crab' }); assert.strictEqual((await A.wait('fy')).ok, false, 'a kill must name its pack');
  let paid = 0, kx = 0; for (let i = 0; i < 9; i++) { A.send({ t: 'fk', kind: 'crab', pk: 0 }); const y = await A.wait('fy'); if (y.ok) { paid++; kx = y.xp; } }
  assert.ok(kx >= 10 && kx <= 20, 'kill experience is worked out by the server: ' + kx);
  assert.strictEqual(paid, 6, 'kills are paid at a limited rate');
  for (const kind of ['boss', 'grunt', '__proto__', 'constructor', 7]) { A.send({ t: 'fk', kind, pk: 0 }); assert.strictEqual((await A.wait('fy')).ok, false, String(kind)); }
  assert.strictEqual(A.last.fy.profile.q.side['s-hunt'], 6);
  ok('field: gathers and kills are rewarded by the server, within regrow time and a kill rate, for field creatures only');

  // solo claims
  A.send({ t: 'solo1', win: true, time: 150 }); assert.strictEqual((await A.wait('solo')).ok, false, 'a claim without a started run is refused');
  A.send({ t: 'solo0', lvl: 40 }); A.send({ t: 'solo1', win: true, time: 150 }); assert.strictEqual((await A.wait('solo')).ok, false, 'a run cannot take longer than the real time that passed');
  const runsBefore = A.last.solo.profile.runs;
  A.send({ t: 'solo0', lvl: 40 }); await sleep(450); A.send({ t: 'solo1', win: true, time: .4 });
  const solo = await A.wait('solo'); assert.strictEqual(solo.ok, true); assert.strictEqual(solo.profile.runs, runsBefore + 1);
  assert.ok(solo.loot.length >= 1 && solo.loot[0].it.il <= 10 + solo.profile.lvl * 4 + 10, 'the requested level is capped at the account\'s own level'); assert.strictEqual(solo.pile, undefined);
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
  const A4 = client(port, { id: credA.id, token: credA.token, bk: tampered }); await A4.ready; assert.strictEqual(A4.me.profile, null, 'an edited backup is rejected');
  // a save from before characters existed turns into one character
  { const leg = require('../store.js').createStore(null, 'test-secret'), old = { id: credA.id, name: '舊檔', lvl: 4, cl: 6, xp: 10, gear: { w: 30, a: 20, t: 10 }, inv: { scrap: 3 }, friends: {} };
    A4.ws.close(); await sleep(50); await srv.close(); srv = await boot({ dataDir: null, secret: 'test-secret' }); port = srv.server.address().port;
    const L = client(port, { id: credA.id, token: credA.token, bk: leg.pack(old) }); await L.ready; assert.strictEqual(L.me.chars.length, 1); assert.strictEqual(L.me.profile.cl, 6); assert.strictEqual(L.me.profile.gear.w, 30); assert.strictEqual(L.me.profile.name, '舊檔'); L.ws.close(); }
  ok('accounts survive a restart on disk; with the disk gone they come back from the signed device backup; an edited backup is rejected');

  // characters: several per account, each with its own class and progress
  const K = client(port); const k0 = await K.ready; assert.deepStrictEqual(k0.chars, []); assert.strictEqual(k0.profile, null, 'a new account has no character');
  K.join('dps'); assert.match((await K.wait('err')).msg, /先創建一個角色/); K.send({ t: 'craft', id: 'potion' }); assert.match((await K.wait('err', m => m !== K.last.err || true)).msg, /先創建/);
  for (const bad of [{ name: '', cls: 'dps' }, { name: '   ', cls: 'dps' }, { name: '阿一', cls: 'mage' }, { name: 7, cls: 'dps' }]) { K.send(Object.assign({ t: 'char-new' }, bad)); await K.wait('note'); }
  const mk = async (name, cls) => { const prev = K.last.me; K.send({ t: 'char-new', name, cls }); return K.wait('me', m => m !== prev); };
  let km = await mk('阿盾', 'tank'); assert.deepStrictEqual(km.chars.map(c => c.cls), ['tank']); assert.strictEqual(km.cur, 0); assert.strictEqual(km.profile.cls, 'tank');
  km = await mk('阿潮', 'heal'); km = await mk('阿矢', 'dps'); km = await mk('第四', 'dps'); assert.strictEqual(km.chars.length, 4); assert.strictEqual(km.cur, 3);
  K.send({ t: 'char-new', name: '第五', cls: 'dps' }); assert.match((await K.wait('note', m => /最多/.test(m.msg))).msg, /最多只能有 4 個角色/);
  srv.store.get(K.me.id).chars[1].cl = 7; let prev = K.last.me;
  K.send({ t: 'char-pick', i: 1 }); km = await K.wait('me', m => m !== prev); assert.strictEqual(km.profile.name, '阿潮'); assert.strictEqual(km.profile.cl, 7); assert.strictEqual(km.chars[0].cl, 1, 'progress is per character');
  K.join('tank', 'CHARS'); let kl = await K.wait('lobby', m => m.code === 'CHARS'); assert.strictEqual(kl.you, 1, 'the seat follows the character\'s class, not what the client asked for');
  K.send({ t: 'char-pick', i: 0 }); assert.match((await K.wait('note', m => /先離開/.test(m.msg))).msg, /先離開房間或副本/); K.send({ t: 'leave' });
  for (const i of [-1, 9, 1.5, '0']) { K.send({ t: 'char-pick', i }); await K.wait('note', m => /沒有這個角色/.test(m.msg)); }
  prev = K.last.me; K.send({ t: 'char-del', i: 0 }); km = await K.wait('me', m => m !== prev); assert.deepStrictEqual(km.chars.map(c => c.name), ['阿潮', '阿矢', '第四']); assert.strictEqual(km.cur, 0, 'the character in use is still the same one');
  assert.strictEqual(km.profile.name, '阿潮'); K.ws.close();
  ok('characters: up to four per account, each with its own class and progress; no switching while seated');

  // a party's field: one shared map on the server, walk in and out by code, personal gathering, shared kill credit
  const P1 = await named(port, '甲', 'dps'), P2 = await named(port, '乙', 'tank');
  P1.send({ t: 'join', field: true, room: 'camp' }); const f1 = await P1.wait('start'); assert.strictEqual(f1.field, true); assert.strictEqual(f1.code, 'CAMP'); assert.strictEqual(f1.you, 0); assert.strictEqual(f1.roster.length, 1);
  const alone = await P1.wait('s'); const mobHp = alone.e.find(e => true)[5];
  P2.send({ t: 'join', field: true, room: 'CAMP' }); const f2 = await P2.wait('start'); assert.strictEqual(f2.you, 1); assert.deepStrictEqual(f2.roster.map(r => r && r.name), ['甲', '乙']);
  const ro = await P1.wait('roster', m => m.roster.length === 2); assert.strictEqual(ro.roster[1].cls, 'tank', 'any classes can share a field');
  const two = await P1.wait('s', m => m.a.length === 2 && m.e.some(e => e[5] > mobHp)); assert.ok(two, 'creatures get tougher when a second person arrives');
  P1.send({ t: 'm', x: 1, y: 0 }); await sleep(300); P1.send({ t: 'm', x: 0, y: 0 }); const seen = await P2.wait('s', m => m.a[0][0] > alone.a[0][0] + 15); assert.ok(seen, 'each sees the other move');
  // both stand on the same gathering spot: each gets their own
  const node = Sim.FIELD.nodes[11]; for (const c of [P1, P2]) c.send({ t: 'dbg', k: 'tp', x: node.x + 6, y: node.y + (c === P1 ? 4 : 14) });
  const [g1, g2] = await Promise.all([P1.wait('fy', m => m.ok, 8000), P2.wait('fy', m => m.ok, 8000)]); assert.strictEqual(g1.mats.salt, 1); assert.strictEqual(g2.mats.salt, 1); assert.strictEqual(g1.xp, 5);
  const used = await P1.wait('s', m => (m.nd[11] & 3) === 3); assert.strictEqual(used.nd[11] & 12, 0, 'the spot is only used up for the two who took it');
  // one of them kills a creature while the other stands near: both are paid
  const pk0 = Sim.FIELD.packs[0]; P1.send({ t: 'dbg', k: 'weak' }); const x1 = g1.profile.xp + g1.profile.cl * 1e6, x2 = g2.profile.xp + g2.profile.cl * 1e6;
  P1.send({ t: 'dbg', k: 'tp', x: pk0.x, y: pk0.y + 50 }); P2.send({ t: 'dbg', k: 'tp', x: pk0.x + 60, y: pk0.y + 120 });
  const [k1, k2] = await Promise.all([P1.wait('fy', m => m.ok && m.xp > 5, 20000), P2.wait('fy', m => m.ok && m.xp > 5, 20000)]);
  assert.ok(k1.profile.xp + k1.profile.cl * 1e6 > x1 && k2.profile.xp + k2.profile.cl * 1e6 > x2, 'both got experience for the kill'); assert.ok(k1.profile.q.side['s-hunt'] >= 1 && k2.profile.q.side['s-hunt'] >= 1);
  // friends can be invited into the field; a third and fourth fit, a fifth does not
  const P3 = await named(port, '丙', 'heal'), P4 = await named(port, '丁', 'dps'), P5 = await named(port, '戊', 'dps');
  P3.send({ t: 'join', field: true, room: 'camp' }); await P3.wait('start'); P4.send({ t: 'join', field: true, room: 'camp' }); assert.strictEqual((await P4.wait('start')).you, 3);
  P5.send({ t: 'join', field: true, room: 'camp' }); assert.match((await P5.wait('err')).msg, /隊伍滿了/);
  // leaving frees the seat for the next person, and the others are told
  P2.send({ t: 'leave' }); const gone = await P1.wait('roster', m => m.roster[1] === null); assert.ok(gone); await P1.wait('s', m => m.a[1][12] === 1);
  P5.send({ t: 'join', field: true, room: 'camp' }); assert.strictEqual((await P5.wait('start')).you, 1, 'the newcomer takes the empty seat');
  // the tower gate: someone opens a dungeon room with the party's code and the others are called
  P1.join('dps', 'CAMP'); const call = await P3.wait('invited', m => m.gate); assert.strictEqual(call.code, 'CAMP'); assert.strictEqual(call.from.name, '甲'); await P1.wait('lobby', m => m.code === 'CAMP'); P1.send({ t: 'leave' });
  // a field with nobody in it is cleaned up; a blank code gets a fresh private field
  P1.send({ t: 'join', field: true }); const solo1 = await P1.wait('start', m => m.field && m.code !== 'CAMP'); assert.match(solo1.code, /^[0-9A-F]{4}$/); assert.strictEqual(solo1.roster.length, 1);
  for (const c of [P1, P2, P3, P4, P5]) c.ws.close();
  ok('party field: shared map by code, drop in and out, personal gathering, kill credit for everyone near, four at most');

  // the tide surge: a public event. This server has it switched off (dur 0); a second one has it always open.
  const Q0 = await named(port, '沒潮', 'dps'); assert.strictEqual(Q0.me.ev.dur, 0); Q0.send({ t: 'join', event: true, x: 450, y: 800 }); assert.match((await Q0.wait('event-no')).msg, /已經退了/); Q0.ws.close();
  const es = await boot({ dataDir: null, secret: 'ev', eventPeriod: 1e13, eventDur: 1e13 }), ep = es.server.address().port, spot = Sim.FIELD.events[0];
  const E1 = await named(ep, '浪一', 'dps'), E2 = await named(ep, '浪二', 'tank'); assert.ok(E1.me.ev.dur > 0 && E1.me.ev.period > 0);
  E1.send({ t: 'join', event: true, x: spot.x - 30, y: spot.y + 60 }); const ev1 = await E1.wait('start'); assert.strictEqual(ev1.event, true); assert.strictEqual(ev1.you, 0);
  const at1 = await E1.wait('s'); assert.ok(Math.abs(at1.a[0][0] - (spot.x - 30)) < 4 && Math.abs(at1.a[0][1] - (spot.y + 60)) < 4, 'you appear where you walked in, not at the camp');
  E2.send({ t: 'join', event: true, x: 9e9, y: -9e9 }); const ev2 = await E2.wait('start'); assert.strictEqual(ev2.you, 1); assert.deepStrictEqual(ev2.roster.map(r => r.name), ['浪一', '浪二'], 'strangers land in the same surge');
  const at2 = await E2.wait('s', m => m.a.length === 2); assert.ok(Math.hypot(at2.a[1][0] - spot.x, at2.a[1][1] - spot.y) < 420, 'a wild position is pulled back near the surge');
  const w0 = await E1.wait('s', m => m.evs && m.evs[0] === 0 && m.e.some(e => e[1] === 'crab')); assert.ok(w0, 'the first wave comes ashore');
  const weak = setInterval(() => E1.send({ t: 'dbg', k: 'weak' }), 150);
  const [d1, d2] = await Promise.all([E1.wait('event-end', null, 60000), E2.wait('event-end', null, 60000)]); clearInterval(weak);
  assert.strictEqual(d1.win, true); assert.ok(d1.xp >= 150 && d1.mats.shard === 1); assert.deepStrictEqual(d1.mates, ['浪二']); assert.deepStrictEqual(d2.mates, ['浪一']);
  assert.strictEqual(d1.profile.q.week.p['w-surge'], 1); assert.ok(d2.profile.inv.herb >= 2);
  E1.send({ t: 'social' }); assert.strictEqual((await E1.wait('social')).recent[0].name, '浪二', 'people met in a surge can be befriended afterwards');
  E2.send({ t: 'join', event: true, x: spot.x, y: spot.y }); assert.match((await E2.wait('event-no')).msg, /已經結束/);
  for (const c of [E1, E2]) c.ws.close(); await sleep(100); await es.close();
  // a surge that runs out of time fails and pays nothing
  const et = await boot({ dataDir: null, secret: 'ev2', eventPeriod: 1e13, eventDur: 1e13 }), E3 = await named(et.server.address().port, '浪三', 'dps');
  E3.send({ t: 'join', event: true, x: spot.x, y: spot.y + 60 }); await E3.wait('start'); E3.send({ t: 'dbg', k: 'evtime' });
  const lost = await E3.wait('event-end'); assert.strictEqual(lost.win, false); assert.strictEqual(lost.xp, 0); assert.strictEqual(lost.profile.inv.shard, 0); E3.ws.close(); await sleep(100); await et.close();
  ok('tide surge: opens on a schedule, strangers share one field, joining keeps your place, win pays everyone present, timeout pays nothing');

  // coin, the merchant and talents: all kept and checked by the server
  const M = await named(port, '買家', 'dps'); const mc = srv.store.get(M.me.id).chars[0]; mc.coin = 200; mc.cl = 8; mc.inv.scrap = 10;
  const act = async o => { const prev = M.last.ack; M.send(o); return M.wait('ack', m => m !== prev); };
  let ak = await act({ t: 'shop', op: 'buy', key: 'potion', n: 2 }); assert.strictEqual(ak.ok, true); assert.strictEqual(ak.profile.coin, 80); assert.strictEqual(ak.profile.inv.potion, 2);
  ak = await act({ t: 'shop', op: 'buy', key: 'potion', n: 2 }); assert.strictEqual(ak.ok, false, 'not enough coin'); assert.strictEqual(ak.profile.coin, 80);
  for (const bad of [{ key: 'shard', n: 1 }, { key: 'potion', n: -1 }, { key: 'potion', n: 1e9 }, { key: 'constructor', n: 1 }, { key: 'herb', n: '1' }]) assert.strictEqual((await act(Object.assign({ t: 'shop', op: 'buy' }, bad))).ok, false, JSON.stringify(bad));
  ak = await act({ t: 'shop', op: 'sell', key: 'scrap', n: 10 }); assert.strictEqual(ak.ok, true); assert.strictEqual(ak.profile.coin, 100); assert.strictEqual(ak.profile.inv.scrap, 0);
  ak = await act({ t: 'shop', op: 'sell', key: 'scrap', n: 1 }); assert.strictEqual(ak.ok, false, 'nothing left to sell');
  ak = await act({ t: 'talent', id: 'd-cdr' }); assert.strictEqual(ak.ok, false, 'a deeper row needs points spent first');
  ak = await act({ t: 'talent', id: 't-hp' }); assert.strictEqual(ak.ok, false, 'another class\'s talent');
  for (let i = 0; i < 3; i++) ak = await act({ t: 'talent', id: 'd-hp' }); assert.strictEqual(ak.profile.talents['d-hp'], 3); ak = await act({ t: 'talent', id: 'd-hp' }); assert.strictEqual(ak.ok, false);
  for (let i = 0; i < 2; i++) ak = await act({ t: 'talent', id: 'd-speed' }); for (let i = 0; i < 2; i++) ak = await act({ t: 'talent', id: 'd-blast' }); assert.strictEqual(ak.ok, true);
  ak = await act({ t: 'talent', id: 'd-dmg' }); assert.strictEqual(ak.ok, false, 'seven points at level 8, all spent');
  M.join('dps', 'TAL'); await M.wait('lobby', m => m.code === 'TAL'); M.send({ t: 'ready' }); const ts = await M.wait('start');
  assert.strictEqual(ts.roster[2].maxHp, Math.round(950 * Sim.lvF(8) * 1.15), 'talents change the character that enters the run'); assert.strictEqual(ts.roster[2].spd, 1.1); assert.strictEqual(ts.roster[0].spd, 1, 'bots have no talents');
  const th = await M.wait('s', m => m.st === 'run' && m.e.some(e => Array.isArray(e[15]) && e[14] >= 0)); const e0 = th.e.find(e => Array.isArray(e[15]) && e[14] >= 0);      // once a creature has picked someone assert.strictEqual(e0[15].length, 4); assert.ok(e0[14] >= 0 && e0[14] < 4 && Math.max(...e0[15]) === 100, 'snapshots say who each creature is on and how the seats rank');
  M.send({ t: 'leave' }); ak = await act({ t: 'talent-reset' }); assert.strictEqual(ak.ok, true); assert.strictEqual(ak.profile.coin, 70); assert.deepStrictEqual(ak.profile.talents, {});
  const bkm = await M.wait('bk', null, 3000); assert.ok(bkm.bk.length > 100, 'the backup follows a little later instead of riding on every reply'); M.ws.close();
  ok('coin, merchant and talents: prices and limits enforced, rows and points enforced, talents shape the run, threat is reported');

  // skill loadouts and aimed casts
  const T = await named(port, '換技', 'tank'); let lr;
  T.send({ t: 'loadout', cls: 'tank', skills: ['taunt', 'charge', 'bash', 'tankUlt'] }); lr = await T.wait('loadout'); assert.strictEqual(lr.ok, false, 'a level 1 account cannot equip a level 3 skill');
  srv.store.get(T.me.id).chars[0].cl = 5;
  for (const bad of [['taunt', 'taunt', 'bash', 'tankUlt'], ['taunt', 'blast', 'bash', 'tankUlt'], ['taunt', 'charge', 'bash', 'anchor'], ['taunt', 'charge', 'bash'], 'x', null, [1, 2, 3, 4]]) { T.send({ t: 'loadout', cls: 'tank', skills: bad }); assert.strictEqual((await T.wait('loadout')).ok, false, JSON.stringify(bad)); }
  T.send({ t: 'loadout', cls: 'tank', skills: ['taunt', 'charge', 'quake', 'tankUlt'] }); lr = await T.wait('loadout'); assert.strictEqual(lr.ok, true); assert.deepStrictEqual(lr.profile.loadout.tank, ['taunt', 'charge', 'quake', 'tankUlt']);
  T.join('tank', 'LOAD'); await T.wait('lobby', m => m.code === 'LOAD'); T.send({ t: 'ready' }); const st = await T.wait('start');
  assert.deepStrictEqual(st.roster[0].skills, ['taunt', 'charge', 'quake', 'tankUlt'], 'the run uses the account\'s loadout'); assert.deepStrictEqual(st.roster[1].skills, ['mend', 'ring', 'seal', 'healUlt'], 'bots use the starting skills');
  const t0 = await T.wait('s', m => m.st === 'run');
  T.send({ t: 'a', c: 1, aim: { k: 'd', x: 0, y: -1 } }); const t1 = await T.wait('s', m => m.a[0][8][1] > 0); assert.ok(t1.a[0][1] < t0.a[0][1] - 40, 'an aimed charge goes where it was pointed');
  for (const aim of [{ k: 'd', x: 'a', y: 1 }, { k: 'p', x: 1e9, y: 0 }, { k: 'id', id: 1.5 }, 'x', 7, { k: 'zz' }]) T.send({ t: 'a', c: 2, aim });
  const t2 = await T.wait('s', m => m.a[0][8][2] > 0); assert.ok(t2, 'a malformed aim is dropped and the skill is cast as a tap');
  T.send({ t: 'leave' }); T.ws.close();
  ok('loadouts: only unlocked, distinct skills of the class; runs use them; aimed casts are applied and bad aims are ignored');

  // gear as items, sets, and a leader who hands out the drops
  { const p = Sim.fixProfile(Sim.newProfile()), lamp = Sim.SETS.lamp.pieces;
    assert.strictEqual(Sim.giveItem(p, { s: 'w', il: 20, q: 0, n: lamp.w }).up, true); assert.strictEqual(Sim.giveItem(p, { s: 'a', il: 20, q: 0, n: lamp.a }).up, true);
    assert.strictEqual(Sim.modsFor(p, 'dps').speed, 1.05, 'two pieces of a set give its first bonus'); assert.strictEqual(Sim.modsFor(p, 'dps').dmg, 1);
    const g = Sim.giveItem(p, { s: 'w', il: 30, q: 0, n: '拆船鉤' }); assert.strictEqual(g.up, false, 'a better plain piece does not break a set by itself'); assert.strictEqual(p.bag.length, 1); assert.strictEqual(p.gear.w, 20);
    Sim.giveItem(p, { s: 't', il: 12, q: 1, n: lamp.t }); assert.ok(Math.abs(Sim.modsFor(p, 'dps').dmg - 1.08) < 1e-9, 'three pieces give both'); assert.strictEqual(Sim.setList(p).find(x => x.id === 'lamp').have, 3);
    assert.strictEqual(Sim.equipItem(p, 0).ok, true); assert.strictEqual(p.gear.w, 30); assert.strictEqual(p.bag[0].n, lamp.w, 'the piece taken off goes to the bag'); assert.strictEqual(Sim.modsFor(p, 'dps').dmg, 1);
    const coin0 = p.coin; for (let i = 0; i < Sim.BAG_CAP + 3; i++) Sim.giveItem(p, { s: 'a', il: 11, q: 0, n: '鹽殼護肩' }); assert.strictEqual(p.bag.length, Sim.BAG_CAP); assert.ok(p.coin > coin0, 'what does not fit is sold');
    p.bag.push({ s: 'w', il: 999, q: 9, n: 'hack' }, { s: 'a', il: 50, q: 1, n: ['鹽殼護肩'] }, null); p.eq.w = { n: 'constructor', q: 5 }; Sim.fixProfile(p); assert.strictEqual(p.bag.length, Sim.BAG_CAP); assert.deepStrictEqual(p.eq.w, { n: '', q: 0 });
    let drops = 0; for (let i = 0; i < 4000; i++) { const q = Sim.fixProfile(Sim.newProfile()); q.cl = 8; if (Sim.fieldGain(q, 'kill', 'crab', 0).item) drops++; } assert.ok(drops > 100 && drops < 320, `field creatures drop gear now and then (${drops}/4000)`);
  }
  const P = await named(port, '隊長', 'tank'), Q = await named(port, '隊員', 'dps');
  srv.store.get(Q.me.id).chars[0].bag = [{ s: 'w', il: 40, q: 2, n: '潮鳴之舌' }, { s: 'a', il: 12, q: 0, n: '鹽殼護肩' }];
  Q.send({ t: 'item', op: 'equip', i: 0 }); let ia = await Q.wait('ack', m => m.what === 'item'); assert.strictEqual(ia.ok, true); assert.strictEqual(ia.profile.gear.w, 40); assert.strictEqual(ia.profile.eq.w.n, '潮鳴之舌'); assert.strictEqual(ia.profile.bag.length, 1);
  Q.send({ t: 'item', op: 'sell', i: 0 }); ia = await Q.wait('ack', m => m.what === 'item' && m.profile.bag.length === 0); assert.strictEqual(ia.profile.coin, Sim.itemPrice({ il: 12, q: 0 }));
  Q.send({ t: 'item', op: 'sell', i: 0 }); ia = await Q.wait('ack', m => m.what === 'item' && !m.ok); assert.strictEqual(ia.ok, false);
  P.join('tank', 'LEAD'); let ll = await P.wait('lobby', m => m.code === 'LEAD'); assert.strictEqual(ll.leader, 0); assert.strictEqual(ll.mode, 'roll');
  Q.join('dps', 'LEAD'); await Q.wait('lobby', m => m.code === 'LEAD'); Q.send({ t: 'lootmode', mode: 'leader' }); await sleep(100); assert.strictEqual(P.last.lobby.mode, 'roll', 'only the leader chooses how gear is divided');
  P.send({ t: 'lootmode', mode: 'leader' }); ll = await Q.wait('lobby', m => m.mode === 'leader'); assert.strictEqual(ll.leader, 0);
  P.send({ t: 'ready' }); Q.send({ t: 'ready' }); await Promise.all([P.wait('start'), Q.wait('start')]); await P.wait('s', m => m.st === 'run'); P.send({ t: 'dbg', k: 'skip' });
  const tk2 = setInterval(() => { P.send({ t: 'a', c: 0 }); Q.send({ t: 'a', c: 0 }); }, 100);
  const [endP, endQ] = await Promise.all([P.wait('end', null, 60000), Q.wait('end', null, 60000)]); clearInterval(tk2);
  assert.strictEqual(endP.win, true); assert.strictEqual(endP.pile.mode, 'leader'); assert.strictEqual(endP.pile.leader, 0); assert.strictEqual(endQ.pile.you, 1);
  Q.send({ t: 'assign', L: endP.pile.id, i: 0, to: 1 }); Q.send({ t: 'roll', L: endP.pile.id, i: 0, k: 'need' }); await sleep(120); assert.ok(!Q.last.loot, 'only the leader hands gear out, and nobody rolls');
  P.send({ t: 'assign', L: endP.pile.id, i: 0, to: 1 }); const lq = await Q.wait('loot', m => m.i === 0); assert.strictEqual(lq.win, 1); assert.ok(lq.give && lq.profile, 'the one who was given the piece gets it');
  assert.ok(lq.profile.bag.concat(Sim.SLOTS.map(k => Sim.wornItem(lq.profile, k))).some(it => it.n === endP.pile.items[0].n && it.il === endP.pile.items[0].il));
  const l2 = await P.wait('loot', m => m.i === 1, 4000); assert.ok(l2.win === 0 || l2.win === 1, 'what the leader leaves undecided is rolled for when the time runs out'); assert.strictEqual(l2.rolls.length, 2);
  await sleep(100); assert.strictEqual(srv.loots.size, 0); P.ws.close(); Q.ws.close();
  ok('gear: sets, bag and selling follow the rules; a leader can hand out the drops, and leftovers are rolled for');

  // public matchmaking
  const D = await named(port, 'D', 'tank'), E = await named(port, 'E', 'dps'), F = await named(port, 'F', 'tank');
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
