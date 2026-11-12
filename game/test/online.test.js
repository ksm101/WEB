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
const boot = async o => { const s = start(Object.assign({ port: 0, speed: 12, lobbyWait: 600, debug: true, soloMin: .2, eventPeriod: 1e13, eventDur: 0, backupEvery: 300, lootWait: 1500, auctionSweep: 150, towerLevel: 1 }, o)); await new Promise(r => s.server.on('listening', r)); return s; };

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

  // the numbers as data: export, change, clamp, ignore rubbish, put back
  { const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x), base = Sim.exportData();
    Sim.applyData(base); assert.strictEqual(canon(Sim.exportData()), canon(base), 'applying what was exported changes nothing');
    for (const junk of [null, 7, 'x', [], { tune: 'x', skills: { blast: 5 }, enemies: [], field: { packs: 'no', nodes: [1, null] }, sets: 3, talents: { dps: 'x' }, shop: { buy: [] }, quests: { main: [{}] }, waves: [[]] }]) Sim.applyData(junk);
    assert.strictEqual(canon(Sim.exportData()), canon(base), 'rubbish is ignored');
    Sim.applyData({ tune: { towerLevel: 5, bagCap: 9999, nope: 1 }, skills: { blast: { cd: 2, mul: 9, name: '<b>大爆</b>', aim: 'self', fn: 'x' } }, enemies: { crab: { hp: 777, xp: 50 } }, drop: { field: 2 }, classes: { dps: { hp: -5 } },
      shop: { buy: { potion: 10, gold: 5 } }, recipes: [{ id: 'potion', cost: { herb: 1 } }, { id: 'nope', cost: { herb: 1 } }], quests: { main: [{ id: 'bell', need: 2, reward: { coin: 99, hack: 5 } }] },
      plain: { w: ['新劍', '新劍', ''] }, sets: { moon: { name: '月潮', pieces: { w: '月刃', a: '月衣', t: '月環' }, two: ['dmg', .1, '傷害 +10%'], three: ['hp', .2, '生命 +20%'] }, bad: { name: 'x', pieces: { w: '新劍', a: 'a', t: 'b' }, two: ['dmg', .1], three: ['hp', .1] } },
      talents: { dps: [{ id: 'd-x', row: 0, max: 5, name: '新招', eff: ['dmg', .1], desc: '傷害' }, { id: 'bad id', row: 0, max: 1, name: 'x', eff: ['dmg', .1] }, { id: 'd-y', row: 0, max: 1, name: 'y', eff: ['cd:mend', -.1] }] },
      waves: [[['grunt', 1]], [['grunt', 1]], [['dragon', 3], ['caster', 2]], [['boss', 1]]],
      field: { gate: { x: 300, y: 200 }, packs: [{ kind: 'crab', x: 100, y: 100, n: 2, min: 9, max: 3 }, { kind: 'dragon', x: 1, y: 1, n: 1, min: 1, max: 1 }], nodes: [{ id: 1, type: 'herb', x: 50, y: 60 }, { id: 1, type: 'salt', x: 70, y: 80 }, { id: 2, type: 'gold', x: 1, y: 1 }], npcs: [{ id: 'kol', x: 400, y: 1300 }], rocks: [] } });
    assert.strictEqual(Sim.TOWER_LEVEL, 5); assert.strictEqual(Sim.BAG_CAP, 40, 'a number outside its bounds is pulled back in'); assert.strictEqual(Sim.TUNE.nope, undefined);
    assert.strictEqual(Sim.SKILLS.blast.cd, 2); assert.strictEqual(Sim.SKILLS.blast.mul, 9); assert.strictEqual(Sim.SKILLS.blast.name, 'b大爆/b'); assert.strictEqual(Sim.SKILLS.blast.aim, 'enemy', 'how a skill works is not data'); assert.strictEqual(Sim.SKILLS.blast.fn, undefined);
    assert.strictEqual(Sim.ENEMY.crab.hp, 777); assert.strictEqual(Sim.xpForKill('crab', 1, 1), 50); assert.strictEqual(Sim.DROP.field, 1); assert.strictEqual(Sim.CLASSES.dps.hp, 1);
    assert.deepStrictEqual(Sim.SHOP.buy, { potion: 10 }); assert.deepStrictEqual(Sim.RECIPES.find(r => r.id === 'potion').cost, { herb: 1 });
    { const p = Sim.fixProfile(Sim.newProfile()); assert.strictEqual(Sim.questList(p, 0, true).items[0].need, 2); assert.match(Sim.questList(p, 0, true).items[0].reward, /鐘幣 \+99/); assert.doesNotMatch(Sim.questList(p, 0, true).items[0].reward, /hack/); }
    assert.deepStrictEqual(Sim.PLAIN.w, ['新劍']); assert.deepStrictEqual(Object.keys(Sim.SETS), ['moon'], 'a set whose piece shares a name with something else is refused');
    assert.deepStrictEqual(Sim.fixItem({ s: 'w', il: 20, q: 0, n: '月刃' }), { s: 'w', il: 20, q: 0, n: '月刃' }); assert.strictEqual(Sim.fixItem({ s: 'w', il: 20, q: 0, n: '鏽潮錨刃' }), null, 'a name that was removed is no longer an item');
    { const p = Sim.fixProfile(Sim.newProfile()); Sim.giveItem(p, { s: 'w', il: 20, q: 0, n: '月刃' }); Sim.giveItem(p, { s: 'a', il: 20, q: 0, n: '月衣' }); assert.ok(Math.abs(Sim.modsFor(p, 'dps').dmg - 1.1) < 1e-9, 'a new set gives its bonus'); }
    assert.deepStrictEqual(Sim.TALENTS.dps.map(t => t.id), ['d-x'], 'talents with a bad id or another class\'s skill are dropped'); assert.strictEqual(Sim.modsOf({ 'd-x': 5 }, 'dps').dmg, 1.5);
    assert.deepStrictEqual(Sim.WAVES[2], [['caster', 2]]); assert.deepStrictEqual(Sim.FIELD.gate, Object.assign({}, Sim.FIELD.gate, { x: 300, y: 200 }));
    assert.deepStrictEqual(Sim.FIELD.packs, [{ kind: 'crab', x: 100, y: 100, n: 2, min: 3, max: 9 }]); assert.deepStrictEqual(Sim.FIELD.nodes, [{ id: 1, type: 'herb', x: 50, y: 60 }]); assert.deepStrictEqual(Sim.FIELD.rocks, []);
    assert.strictEqual(Sim.FIELD.npcs.find(n => n.id === 'kol').x, 400);
    { const G = Sim.createField({ lvl: 1, player: { cls: 'dps', name: 'x', pow: 1, id: 'a', lvl: 1 } }); assert.strictEqual(G.enemies.length, 2); assert.strictEqual(G.enemies[0].maxHp, Math.round(777 * Sim.lvF(3))); for (let i = 0; i < 60; i++) Sim.step(G, 1 / 30); }
    { const G = Sim.createRun({ lvl: 1, players: [{ cls: 'dps', name: 'x', pow: 1, id: 'a', lvl: 1 }] }); while (G.state !== 'run') Sim.step(G, 1 / 30); assert.deepStrictEqual(G.enemies.map(e => e.kind), ['grunt'], 'the tower spawns what the data says'); for (let i = 0; i < 300; i++) Sim.step(G, 1 / 30); }
    Sim.applyData(base); assert.strictEqual(canon(Sim.exportData()), canon(base), 'and the defaults can be put back');
    ok('data: every editable number exports and applies; bounds, kinds and names are enforced; the game runs on the changed tables');
  }

  // accounts
  const A = await named(port, '小明', 'dps'), B = await named(port, '<b>壞</b>名字超級長', 'heal');
  assert.match(A.me.id, /^[a-f0-9]{16}$/); assert.notStrictEqual(A.me.id, B.me.id);
  { const { q, loadout, talents, eq, bag, dl, ...rest } = A.me.profile; assert.deepStrictEqual(dl, {}); assert.deepStrictEqual(loadout, {}); assert.deepStrictEqual(talents, {}); assert.deepStrictEqual(bag, []); assert.deepStrictEqual(eq.w, { n: '', q: 0 }); assert.deepStrictEqual(rest, { name: '小明', cls: 'dps', lvl: 1, cl: 1, xp: 0, gear: { w: 10, a: 10, t: 10 }, best: {}, runs: 0, coin: 0, inv: { scrap: 0, salt: 0, shard: 0, herb: 0, potion: 0 } }); assert.strictEqual(q.main, 0); }
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

  // a cleared tower stays up: you can still walk, the clock has stopped, and the room's code is already free
  { const w0 = await A.wait('s', m => m.st === 'won'), x1 = w0.a[2][0]; A.send({ t: 'm', x: x1 > 180 ? -1 : 1, y: 0 });
    const w1 = await A.wait('s', m => m.st === 'won' && Math.abs(m.a[2][0] - x1) > 25, 4000); assert.strictEqual(w1.tm, w0.tm, 'the clock has stopped'); assert.ok(w1.a.every(a => a[4] === 1), 'everyone is back on their feet'); A.send({ t: 'm', x: 0, y: 0 });
    assert.strictEqual(srv.rooms.get('p:TEST').state, 'lobby', 'the code is free for another group'); assert.ok(!srv.seats.has(A.me.id), 'nobody is held to a cleared tower');
    const won = [...srv.rooms.values()].filter(r => r.won); assert.strictEqual(won.length, 1);
    A.send({ t: 'leave' }); await sleep(120); assert.strictEqual([...srv.rooms.values()].filter(r => r.won).length, 1, 'it stays while someone is still inside');
    B2.send({ t: 'leave' }); await sleep(150); assert.strictEqual([...srv.rooms.values()].filter(r => r.won).length, 0, 'and closes when the last one has left');
  }
  ok('after the win the tower stays up for walking out, the timer stops, and the room code is reusable at once');

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

  // mail between friends, and the auction house
  { const M1 = await named(port, '寄信人', 'dps'), M2 = await named(port, '收信人', 'heal'), c1 = srv.store.get(M1.me.id).chars[0], c2 = srv.store.get(M2.me.id).chars[0];
    const act = async (c, o, what) => { const before = c.last.ack; c.send(o); return c.wait('ack', m => m !== before && m.what === what); };
    Object.assign(c1, { coin: 200 }); c1.inv.scrap = 10; c1.bag = [{ s: 'w', il: 30, q: 1, n: '霧燈之芯' }];
    let r = await act(M1, { t: 'mail-send', to: M2.me.id, text: 'hi' }, 'mail'); assert.strictEqual(r.ok, false, 'letters only go to friends'); assert.match(r.msg, /好友/);
    M1.send({ t: 'friend', id: M2.me.id }); await M1.wait('social'); M2.send({ t: 'friend', id: M1.me.id }); await M2.wait('social', m => m.friends.some(f => f.mutual));
    r = await act(M1, { t: 'mail-send', to: M2.me.id, text: '' }, 'mail'); assert.strictEqual(r.ok, false, 'an empty letter is refused');
    r = await act(M1, { t: 'mail-send', to: M2.me.id, text: 'x', coin: 999 }, 'mail'); assert.strictEqual(r.ok, false); assert.match(r.msg, /鐘幣不夠/);
    r = await act(M1, { t: 'mail-send', to: M2.me.id, text: 'x', key: 'scrap', qty: 99 }, 'mail'); assert.strictEqual(r.ok, false);
    r = await act(M1, { t: 'mail-send', to: M2.me.id, text: 'x', item: 5 }, 'mail'); assert.strictEqual(r.ok, false);
    r = await act(M1, { t: 'mail-send', to: M2.me.id, text: '<b>給你</b>' + '長'.repeat(200), coin: 50, key: 'scrap', qty: 4, item: 0 }, 'mail');
    assert.strictEqual(r.ok, true); assert.strictEqual(r.profile.coin, 145, 'coins sent plus postage leave the sender'); assert.strictEqual(r.profile.inv.scrap, 6); assert.strictEqual(r.profile.bag.length, 0);
    let box = await M2.wait('mail', m => m.list.length === 1); const L = box.list[0];
    assert.strictEqual(L.from, '寄信人'); assert.ok(!/[<>]/.test(L.text) && L.text.length <= 80); assert.strictEqual(L.read, 0); assert.deepStrictEqual([L.coin, L.key, L.qty, L.item.n], [50, 'scrap', 4, '霧燈之芯']);
    M2.send({ t: 'mail-del', id: L.id }); await M2.wait('note', m => /先領出來/.test(m.msg));
    r = await act(M2, { t: 'mail-take', id: L.id }, 'mail'); assert.strictEqual(r.ok, true); assert.strictEqual(r.profile.coin, 50); assert.strictEqual(r.profile.inv.scrap, 4); assert.strictEqual(r.profile.bag[0].n, '霧燈之芯');
    r = await act(M2, { t: 'mail-take', id: L.id }, 'mail'); assert.strictEqual(r.profile.coin, 50, 'a letter pays out once');
    M2.send({ t: 'mail-del', id: L.id }); box = await M2.wait('mail', m => m.list.length === 0);
    ok('mail: friends only, postage and attachments leave the sender, the letter pays out once, text is cleaned');

    r = await act(M2, { t: 'ah', op: 'sell', item: 0, price: 0 }, 'ah'); assert.strictEqual(r.ok, false); r = await act(M2, { t: 'ah', op: 'sell', item: 3, price: 10 }, 'ah'); assert.strictEqual(r.ok, false);
    r = await act(M2, { t: 'ah', op: 'sell', item: 0, price: 120 }, 'ah'); assert.strictEqual(r.ok, true); assert.strictEqual(r.profile.bag.length, 0, 'listed goods leave the bag');
    let ah = await M2.wait('ah', m => m.list.length === 1); const lid = ah.list[0].id; assert.strictEqual(ah.list[0].mine, true); assert.strictEqual(ah.list[0].item.n, '霧燈之芯'); assert.strictEqual(ah.list[0].name, '收信人');
    r = await act(M2, { t: 'ah', op: 'buy', id: lid }, 'ah'); assert.strictEqual(r.ok, false, 'you cannot buy your own listing');
    M1.send({ t: 'ah', op: 'list' }); ah = await M1.wait('ah', m => m.list.length === 1); assert.strictEqual(ah.list[0].mine, false);
    M1.send({ t: 'ah', op: 'cancel', id: lid }); await sleep(80); assert.strictEqual(srv.market.size, 1, 'only the seller can take a listing down');
    r = await act(M1, { t: 'ah', op: 'buy', id: lid }, 'ah'); assert.strictEqual(r.ok, true); assert.strictEqual(r.profile.coin, 25); assert.strictEqual(r.profile.bag[0].n, '霧燈之芯'); assert.strictEqual(srv.market.size, 0);
    r = await act(M1, { t: 'ah', op: 'buy', id: lid }, 'ah'); assert.strictEqual(r.ok, false, 'a thing sells once');
    box = await M2.wait('mail', m => m.list.length === 1 && m.list[0].sys === 1); assert.strictEqual(box.list[0].coin, 114, 'the seller is paid by mail, less 5%');
    r = await act(M2, { t: 'mail-take', id: box.list[0].id }, 'mail'); assert.strictEqual(r.profile.coin, 164);
    r = await act(M1, { t: 'ah', op: 'sell', key: 'scrap', qty: 4, price: 9 }, 'ah'); assert.strictEqual(r.ok, true); assert.strictEqual(r.profile.inv.scrap, 2);
    ah = await M1.wait('ah', m => m.list.length === 1 && m.list[0].key === 'scrap'); r = await act(M1, { t: 'ah', op: 'cancel', id: ah.list[0].id }, 'ah'); assert.strictEqual(r.ok, true);
    box = await M1.wait('mail', m => m.list.some(x => x.key === 'scrap' && x.qty === 4)); r = await act(M1, { t: 'mail-take', id: box.list[0].id }, 'mail'); assert.strictEqual(r.profile.inv.scrap, 6, 'a cancelled listing comes back by mail');
    r = await act(M1, { t: 'ah', op: 'sell', key: 'scrap', qty: 2, price: 5 }, 'ah'); for (const v of srv.market.values()) v.l.ends = 1;
    box = await M1.wait('mail', m => m.list.some(x => x.key === 'scrap' && x.qty === 2 && /沒有賣出/.test(x.text)), 3000); assert.strictEqual(srv.market.size, 0, 'an unsold listing expires and comes back');
    const bk = srv.store.pack(srv.store.get(M1.me.id)); assert.ok(bk.length < 48000);
    M1.ws.close(); M2.ws.close();
    ok('auction house: listing takes the goods, buying pays the seller by mail less the cut, cancel and expiry return them');
  }

  // the tower opens at a level
  { const s2 = await boot({ dataDir: null, towerLevel: 3 }), p2 = s2.server.address().port, N = await named(p2, '新手', 'dps');
    N.join('dps', 'LOW'); assert.match((await N.wait('err')).msg, /Lv\.3/); assert.ok(!s2.rooms.has('p:LOW'));
    N.send({ t: 'solo0', lvl: 1 }); await sleep(250); N.send({ t: 'solo1', win: true, time: .2 }); assert.strictEqual((await N.wait('solo')).ok, false, 'no solo claims below the level either');
    s2.store.get(N.me.id).chars[0].cl = 3; N.join('dps', 'LOW'); assert.strictEqual((await N.wait('lobby', m => m.code === 'LOW')).you, 2);
    N.ws.close(); await sleep(50); await s2.close();
    ok('the tower is closed below its level, for groups and for solo claims, and opens at it');
  }

  // more than one map and more than one dungeon: made as data, played through the server
  { const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x), base = Sim.exportData(), d = Sim.exportData();
    d.enemies.kraken = { base: 'boss', name: '深海巨妖', hp: 5000, moves: [{ t: 'nova', name: '水爆', first: 3, every: 8, cast: 1.5, dmg: 200, r: 110 }, { t: 'adds', at: .5, n: 9, kind: 'boss', say: '<b>來' }, { t: 'fly' }, { t: 'cone', first: 1 }] };
    d.enemies.shark = { base: 'crab', name: '礁鯊', hp: 500, xp: 30 }; d.enemies['Bad Id'] = { base: 'crab' }; d.enemies.ghost = { base: 'dragon' };
    d.dungeons.deep = { name: '深淵', min: 2, waves: [[['grunt', 1], ['shark', 2]], [['kraken', 1]], []] };
    d.maps.reef = { name: '礁岸', w: 800, h: 700, spawn: { x: 400, y: 620 }, gate: null, packs: [{ kind: 'shark', x: 300, y: 300, n: 2, min: 4, max: 8 }, { kind: 'grunt', x: 100, y: 100, n: 1, min: 1, max: 1 }],
      nodes: [{ id: 1, type: 'salt', x: 100, y: 100 }], rocks: [], walls: [{ x: 400, y: 450, w: 300, h: 40, type: 'wall' }, { x: 100, y: 500, w: 80, h: 80, type: 'lava' }], exits: [{ x: 400, y: 670, to: 'shore' }, { x: 50, y: 50, to: 'nowhere' }, { x: 60, y: 60, to: 'reef' }] };
    d.maps.shore.exits = [{ x: 120, y: 1400, to: 'reef', tx: 400, ty: 620 }];
    Sim.applyData(d);
    assert.deepStrictEqual(Sim.ENEMY.kraken.moves.map(m => m.t), ['nova', 'adds'], 'unknown and incomplete moves are dropped'); assert.strictEqual(Sim.ENEMY.kraken.moves[1].n, 4); assert.strictEqual(Sim.ENEMY.kraken.moves[1].kind, 'grunt', 'a boss cannot call another boss'); assert.strictEqual(Sim.ENEMY.kraken.moves[1].say, 'b來');
    assert.ok(Sim.ENEMY.kraken.boss && Sim.ENEMY.shark.aggro === Sim.ENEMY.crab.aggro && !Sim.ENEMY['Bad Id'] && !Sim.ENEMY.ghost, 'a new kind takes its behaviour from its base'); assert.deepStrictEqual(Sim.TOWER_KINDS, ['grunt', 'caster', 'boss', 'kraken']);
    assert.deepStrictEqual(Sim.DUNGEONS.deep, { name: '深淵', min: 2, time: 180, type: 'waves', waves: [[['grunt', 1]], [['kraken', 1]]] }, 'a field creature cannot be put in a dungeon wave');
    assert.deepStrictEqual(Sim.MAPS.reef.packs.map(p => p.kind), ['shark']); assert.deepStrictEqual(Sim.MAPS.reef.walls.length, 1); assert.deepStrictEqual(Sim.MAPS.reef.exits, [{ to: 'shore', x: 400, y: 670, tx: Sim.FIELD.spawn[0], ty: Sim.FIELD.spawn[1] }], 'an exit must lead to another map that exists'); assert.strictEqual(Sim.MAPS.reef.gate, null);
    { const G = Sim.createField({ map: 'reef', lvl: 1, player: { cls: 'tank', name: 'x', pow: 1, id: 'a', lvl: 5 } }), me = G.actors[0]; assert.deepStrictEqual(G.enemies.map(e => e.name + e.lvl), ['礁鯊5', '礁鯊5']);
      me.x = 400; me.y = 520; me.input.my = -1; for (let i = 0; i < 90; i++) Sim.step(G, 1 / 30); assert.ok(me.y > 470 + me.r - 1, `a wall stops you (${me.y})`); }
    { const G = Sim.createRun({ dungeon: 'deep', lvl: 1, players: [{ cls: 'dps', name: 'x', pow: 1, id: 'a', lvl: 1 }] }); let novas = 0, n = 0; while (!G.result && n++ < 20000) { Sim.step(G, 1 / 30); if (G.boss && G.zones.some(z => z.type === 'circle' && z.r === 110)) novas++; }
      assert.ok(G.result && G.D.name === '深淵' && novas > 0, 'a made-up boss uses its moves and the run ends'); }
    // a dungeon laid out by hand: creatures wait, patrol and come in groups; chests, a rare, events; won when the boss falls
    d.dungeons.cave = { type: 'layout', name: '鹽洞', min: 1, time: 240, map: { w: 600, h: 900, spawn: { x: 300, y: 840 }, rocks: [], walls: [{ x: 300, y: 650, w: 300, h: 30, type: 'wall' }],
      mobs: [{ kind: 'grunt', x: 300, y: 520, n: 2, roam: 60 }, { kind: 'caster', x: 480, y: 420, n: 1, px: 380, py: 420 }, { kind: 'grunt', x: 100, y: 300, n: 1, rare: true }, { kind: 'boss', x: 300, y: 150, n: 1 }, { kind: 'shark', x: 50, y: 50 }, { kind: 'grunt', x: 500, y: 100, n: 1, chance: .05 }],
      chests: [{ x: 520, y: 760, chance: 1 }], events: [{ type: 'ambush', x: 300, y: 330, r: 60, kind: 'boss', n: 2, text: '<埋伏>' }, { type: 'heal', x: 80, y: 800, r: 50 }, { type: 'say', x: 300, y: 780, r: 80, text: '洞裡很暗' }, { type: 'fly', x: 1, y: 1 }] } };
    Sim.applyData(d);
    { const D = Sim.DUNGEONS.cave; assert.deepStrictEqual(D.map.mobs.map(m => m.kind), ['grunt', 'caster', 'grunt', 'boss', 'grunt'], 'only tower creatures can be placed in a dungeon'); assert.deepStrictEqual(D.map.events.map(e => e.type), ['ambush', 'heal', 'say']); assert.strictEqual(D.map.events[0].kind, 'grunt'); assert.strictEqual(D.map.events[0].text, '埋伏'); assert.strictEqual(D.F.w, 600);
      const G = Sim.createRun({ dungeon: 'cave', lvl: 1, players: [{ cls: 'heal', name: 'x', pow: 1, id: 'a', lvl: 1 }] }), me = G.actors.find(a => a.human), run = n => { for (let i = 0; i < n; i++) Sim.step(G, 1 / 30); }, weak = () => { for (const e of G.enemies) if (e.engaged) e.hp = Math.min(e.hp, 30); };
      assert.ok(G.layout && G.limit === 240 && G.bossN === 1 && G.chests.length === 1 && G.enemies.some(e => e.rare && e.maxHp === Math.round(1000 * 2.5)));
      assert.deepStrictEqual(D.map.mobs[1].path, [{ x: 380, y: 420 }], 'an older far end becomes a one-point route'); const pat = G.enemies.find(e => e.wp), px0 = pat.x; run(200); assert.strictEqual(G.enemies.filter(e => e.engaged).length, 0, 'nothing fights until someone comes near'); assert.ok(Math.abs(pat.x - px0) > 20, 'a patrol walks'); assert.strictEqual(G.trigs[2].done, true, 'walking into an event sets it off');
      me.x = 520; me.y = 790; run(20); assert.strictEqual(G.chests[0].open, true); assert.strictEqual(G.drops, 1, 'a chest is one more piece of gear');
      me.x = 300; me.y = 610; me.hp = 50; me.input.cast[0] = true; run(60); assert.deepStrictEqual(G.enemies.filter(e => e.engaged).map(e => e.kind).sort(), ['grunt', 'grunt'], 'coming near pulls the whole group and nothing else, even when you heal');
      assert.ok(G.actors.filter(a => !a.human).every(a => Math.hypot(a.x - me.x, a.y - me.y) < 240), 'the AI teammates catch up past a wall');
      let n = 0; while (G.enemies.some(e => e.engaged) && n++ < 4000) { weak(); run(1); } me.hp = 20; run(300); assert.ok(me.hp > me.maxHp * .5, 'between fights you get your breath back');
      const dr0 = G.drops; me.x = 100; me.y = 370; n = 0; run(30); while (G.enemies.some(e => e.engaged) && n++ < 4000) { weak(); run(1); } assert.strictEqual(G.drops, dr0 + 1, 'a rare creature always leaves something'); assert.strictEqual(G.state, 'run', 'and the dungeon is not over while its boss stands');
      me.x = 300; me.y = 300; run(30); assert.ok(G.trigs[0].done && G.boss && G.boss.engaged && G.enemies.filter(e => e.grp === 1000).length === 2, 'an ambush springs, and the boss is announced when it joins');
      n = 0; while (!G.result && n++ < 8000) { weak(); run(1); } assert.ok(G.result && G.result.win && G.state === 'won' && G.portal && Math.abs(G.portal.y - 150) < 260, 'the boss falling wins it and opens the way out there');
      { const d2 = Sim.exportData(); d2.dungeons.cave.map.mobs = [{ kind: 'grunt', x: 100, y: 100, n: 1, loop: true, path: [{ x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }, 'x', { x: 9e9, y: 1 }, { x: 150, y: 150 }, { x: 160, y: 160 }, { x: 170, y: 170 }, { x: 180, y: 180 }] }, { kind: 'grunt', x: 400, y: 100, n: 1, path: [{ x: 500, y: 100 }, { x: 500, y: 200 }] }, { kind: 'boss', x: 300, y: 600 }]; Sim.applyData(d2);
        assert.strictEqual(Sim.DUNGEONS.cave.map.mobs[0].path.length, 6, 'a route has at most six points, and only real ones'); const R = Sim.createRun({ dungeon: 'cave', lvl: 1, players: [{ cls: 'dps', name: 'x', pow: 1, id: 'a', lvl: 1 }] }), ring = R.enemies[0], back = R.enemies[1], seenR = new Set(), seenB = [];
        for (let i = 0; i < 4200; i++) { Sim.step(R, 1 / 30); seenR.add(ring.wi); if (seenB[seenB.length - 1] !== back.wi) seenB.push(back.wi); }
        assert.strictEqual(seenR.size, 7, 'a ring visits every point and its start'); assert.ok(seenB.join('').includes('1210121'), `there-and-back turns round at both ends (${seenB.join('')})`); assert.strictEqual(R.enemies.filter(e => e.engaged).length, 0); Sim.applyData(d); }      // and the cave is put back as it was for what follows
      const snap = Sim.snapshot(G); assert.deepStrictEqual(snap.ch, [[520, 760, 1]]); assert.strictEqual(snap.tg & 5, 5); assert.ok(Array.isArray(snap.pt)); }
    const U = await named(port, '探險', 'dps'), cu = srv.store.get(U.me.id).chars[0];
    U.send({ t: 'join', d: 'cave', room: 'CAVE' }); await U.wait('lobby', m => m.code === 'CAVE' && m.d === 'cave'); U.send({ t: 'ready' }); const stC = await U.wait('start', m => !m.field && m.d === 'cave');
    const sC = await U.wait('s', m => m.st === 'run' && m.e.length >= 4 && Array.isArray(m.ch)); assert.ok(sC.e.every(e => e[12] === 0), 'the server runs a laid-out dungeon the same way'); assert.ok(sC.a[stC.you][1] > 700, 'the party starts at its entrance'); U.send({ t: 'leave' }); await sleep(60);
    U.send({ t: 'join', d: 'deep', room: 'DEEP' }); let lbU = await U.wait('lobby', m => m.code === 'DEEP'); assert.strictEqual(lbU.d, 'deep'); assert.strictEqual(lbU.dname, '深淵'); U.send({ t: 'ready' });
    const stU = await U.wait('start', m => !m.field && m.d === 'deep'); assert.strictEqual(stU.d, 'deep'); await U.wait('s', m => m.st === 'run' && !m.ch); U.send({ t: 'dbg', k: 'skip' }); const tkU = setInterval(() => { U.send({ t: 'a', c: 0 }); U.send({ t: 'dbg', k: 'weak' }); }, 100);
    const endU = await U.wait('end', null, 60000); clearInterval(tkU); assert.strictEqual(endU.win, true); assert.strictEqual(endU.d, 'deep'); assert.strictEqual(endU.profile.lvl, 1, 'another dungeon does not move your tower floor'); assert.strictEqual(endU.profile.dl.deep, endU.onTime ? 2 : undefined); U.send({ t: 'leave' });
    U.send({ t: 'join', field: true, room: 'MAPS', map: 'reef' }); const fU = await U.wait('start', m => m.field); assert.strictEqual(fU.map, 'reef'); assert.ok(srv.rooms.has('f:MAPS@reef') && srv.rooms.get('f:MAPS@reef').G.map === 'reef');
    const V2 = await named(port, '同伴', 'tank'); V2.send({ t: 'join', field: true, room: 'MAPS' }); assert.strictEqual((await V2.wait('start', m => m.field)).map, 'shore'); assert.strictEqual(Sim.present(srv.rooms.get('f:MAPS@reef').G).length, 1, 'people of one party on different maps are in different fields');
    cu.cl = 5; const xp0 = cu.xp; U.send({ t: 'dbg', k: 'tp', x: 300, y: 330 }); U.send({ t: 'dbg', k: 'weak' }); const ivU = setInterval(() => U.send({ t: 'dbg', k: 'weak' }), 150); await U.wait('fy', m => m.xp > 0, 15000); clearInterval(ivU); assert.ok(cu.xp > xp0 || cu.cl > 5, 'kills on another map pay by that map\'s packs');
    U.ws.close(); V2.ws.close(); await sleep(60);
    // out in the field: a creature with a name of its own on a patrol route, and a quest that asks for it
    { const d3 = Sim.exportData(); d3.maps.shore.packs.push({ kind: 'crab', x: 450, y: 1000, n: 1, min: 1, max: 5, name: '<信使>', respawn: 60, loop: true, path: [{ x: 560, y: 1000 }, { x: 560, y: 900 }] });
      d3.quests.side.push({ id: 'k1', title: '攔下信使', goal: '擊倒在路上的信使', need: 2, reward: { coin: 60, xp: 200, hack: 1 }, kill: '信使' }, { id: 'bad id', kill: 'x' }, { id: 'k2', title: '沒有目標' });
      Sim.applyData(d3); const pk = Sim.FIELD.packs.length - 1, def = Sim.FIELD.packs[pk];
      assert.deepStrictEqual([def.name, def.respawn, def.path.length, def.loop], ['信使', 60, 2, true]); assert.strictEqual(Sim.FIELD.packs[0].name, undefined, 'a pack without a name or a route stays as plain as before'); assert.strictEqual(Sim.packTag('shore', pk), '信使'); assert.strictEqual(Sim.packTag('shore', 0), '');
      const G = Sim.createField({ lvl: 1, player: { cls: 'dps', name: 'x', pow: 1, id: 'a', lvl: 1 } }), e = G.enemies.find(x => x.named), x0 = e.x, seen = new Set(); assert.strictEqual(e.name, '信使');
      for (let i = 0; i < 1500; i++) { Sim.step(G, 1 / 30); seen.add(e.wi); } assert.ok(seen.size === 3 && !e.engaged && Math.hypot(e.x - x0, e.y - 1000) > 1, 'it walks its route while nobody bothers it'); assert.strictEqual(Sim.snapshot(G).e.find(q => q[0] === e.id)[17], pk);
      G.actors[0].x = e.x + 30; G.actors[0].y = e.y; for (let i = 0; i < 20; i++) Sim.step(G, 1 / 30); assert.ok(e.engaged && Math.hypot(e.home.x - e.x, e.home.y - e.y) < 60, 'and comes back to where it was pulled from, not to its first spot');
      const p = Sim.fixProfile(Sim.newProfile()), item = () => Sim.questList(p, 0, true).items.find(x => x.id === 'k1'); assert.ok(item() && item().need === 2 && !Sim.questList(p, 0, true).items.some(x => x.id === 'k2' || x.id === 'bad id'), 'a kill quest needs a proper id and a target');
      Sim.questEvent(p, { type: 'kill', tag: '' }, 0); Sim.questEvent(p, { type: 'kill', tag: '別人' }, 0); assert.strictEqual(item().have, 0); Sim.questEvent(p, { type: 'kill', tag: '信使' }, 0); assert.strictEqual(item().have, 1); Sim.questEvent(p, { type: 'kill', tag: '信使' }, 0);
      assert.strictEqual(item().ready, true); const cl = Sim.questClaim(p, 'k1', 0); assert.ok(cl.ok && p.coin === 60 && !/hack/.test(cl.msg), 'only the named creature counts, and the reward is what was set');
      const Z = await named(port, '追信使', 'dps'); Z.send({ t: 'field0' }); Z.send({ t: 'fk', kind: 'crab', pk }); const fz = await Z.wait('fy', m => m.ok); assert.strictEqual(fz.profile.q.side.k1, 1, 'the server counts it too'); Z.send({ t: 'fk', kind: 'crab', pk: 0 }); assert.strictEqual((await Z.wait('fy', m => m.ok && m !== fz)).profile.q.side.k1, 1); Z.ws.close(); }
    Sim.applyData(base); assert.strictEqual(canon(Sim.exportData()), canon(base), 'and all of it can be taken away again'); assert.ok(!Sim.MAPS.reef && !Sim.DUNGEONS.deep && !Sim.ENEMY.kraken);
    { const p = Sim.fixProfile(Object.assign(Sim.newProfile(), { dl: { deep: 4 } })); assert.deepStrictEqual(p.dl, {}, 'progress in a dungeon that no longer exists is dropped'); }
    ok('worlds: new creature kinds, boss moves, dungeons and maps are data; the server runs them, keeps floors per dungeon and a field per map');
  }

  // waiting for a tower group does not take you out of the field
  { const W1 = await named(port, '等塔甲', 'tank'), W2 = await named(port, '等塔乙', 'dps');
    W1.send({ t: 'join', field: true, room: 'WAIT' }); await W1.wait('start', m => m.field); W2.send({ t: 'join', field: true, room: 'WAIT' }); await W2.wait('start', m => m.field);
    const fr = srv.rooms.get('f:WAIT'); assert.strictEqual(Sim.present(fr.G).length, 2);
    W1.join('tank', 'WAIT'); const lb1 = await W1.wait('lobby', m => m.code === 'WAIT'); assert.strictEqual(lb1.slots[0].name, '等塔甲');
    assert.strictEqual(Sim.present(fr.G).length, 2, 'still standing in the field while waiting'); const n0 = W1.snaps; await sleep(200); assert.ok(W1.snaps > n0, 'and the field keeps coming');
    assert.strictEqual((await W2.wait('invited', m => m.gate)).code, 'WAIT', 'the party is told someone is waiting at the gate');
    W1.send({ t: 'unqueue' }); await sleep(100); assert.ok(!srv.rooms.get('p:WAIT').slots[0], 'unqueue leaves the group'); assert.strictEqual(Sim.present(fr.G).length, 2, 'and not the field');
    W1.send({ t: 'ready' }); await sleep(80); W1.join('tank', 'WAIT'); await W1.wait('lobby', m => m.code === 'WAIT' && m.slots[0].name); W2.join('dps', 'WAIT'); await W2.wait('lobby', m => m.code === 'WAIT');
    W1.send({ t: 'ready' }); W2.send({ t: 'ready' }); const [g1, g2] = await Promise.all([W1.wait('start', m => !m.field), W2.wait('start', m => !m.field)]);
    assert.deepStrictEqual(g1.roster.map(r => r.human), [true, false, true, false]); assert.strictEqual(g2.you, 2); assert.strictEqual(Sim.present(fr.G).length, 0, 'entering the tower takes the group out of the field');
    W1.ws.close(); W2.ws.close();
    ok('group finder: you wait in the field, can stop waiting without leaving it, and the start takes everyone into the tower');
  }

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
