/* Embertide simulation.
 * Runs unchanged in the browser (solo play) and in Node (the multiplayer server).
 * No DOM and no rendering: everything visual leaves as an entry in G.events. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const W = 360, H = 440, TIME_LIMIT = 180;
const TAU = Math.PI * 2, R = Math.round;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = a => Math.atan2(Math.sin(a), Math.cos(a));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* A skill's `aim` says how it is pointed: 'self' needs nothing, 'enemy' and 'ally' take a unit, 'point' a spot on the
 * ground within `range`, 'dir' a direction (`range` is then how far it reaches; `w` is the half-width of a line and
 * `half` the half-angle of a cone). A tap with no aim falls back to the current target, the nearest enemy in reach,
 * or the ally who needs it most. `lv` is the character level that unlocks the skill; `fn` names a shared handler. */
const SKILLS = {
  // 盾衛
  taunt: { seal: '嘲', name: '嘲諷擊', cd: 6, aim: 'enemy', range: 24, lv: 1, desc: '重擊目標，並強迫它攻擊你 4 秒' },
  wall: { seal: '牆', name: '盾牆', cd: 14, aim: 'self', lv: 1, desc: '4 秒內受到的傷害降低 60%' },
  bash: { seal: '斷', name: '盾擊', cd: 10, aim: 'enemy', range: 72, kick: true, fn: 'kick', lv: 1, desc: '打斷身邊敵人的金色讀條' },
  charge: { seal: '衝', name: '衝鋒', cd: 9, aim: 'dir', range: 150, w: 16, lv: 3, desc: '朝指定方向衝出去，撞到的敵人受傷並暈眩' },
  quake: { seal: '震', name: '震地', cd: 8, aim: 'dir', range: 105, half: .7, lv: 5, desc: '砸向前方的扇形範圍，命中的敵人會轉向你' },
  guard: { seal: '護', name: '援護', cd: 12, aim: 'ally', range: 230, lv: 8, desc: '替一名隊友套上護盾' },
  tankUlt: { seal: '鐵', name: '鐵潮', ult: true, aim: 'self', lv: 1, desc: '全場敵人轉向你，全隊獲得護盾' },
  anchor: { seal: '錨', name: '錨落', ult: true, aim: 'point', range: 170, rad: 80, lv: 10, desc: '把錨砸在指定位置，大範圍重傷並暈眩' },
  // 潮語者
  mend: { seal: '泉', name: '湧泉', cd: 2.2, aim: 'ally', range: 600, lv: 1, desc: '治療一名隊友；短按會補血量最低的人' },
  ring: { seal: '環', name: '潮環', cd: 9, aim: 'self', lv: 1, desc: '治療你身邊的所有隊友' },
  seal: { seal: '斷', name: '鹽封', cd: 12, aim: 'enemy', range: 240, kick: true, fn: 'kick', lv: 1, desc: '打斷敵人的金色讀條' },
  wave: { seal: '湧', name: '潮湧', cd: 7, aim: 'dir', range: 210, w: 22, lv: 3, desc: '朝指定方向推出一道潮水，傷害敵人並治療路上的隊友' },
  pool: { seal: '靜', name: '靜水', cd: 14, aim: 'point', range: 190, rad: 70, lv: 5, desc: '在指定位置留下一片水域，5 秒內持續治療站在裡面的隊友' },
  barrier: { seal: '幕', name: '潮幕', cd: 10, aim: 'ally', range: 600, lv: 8, desc: '替一名隊友套上護盾' },
  healUlt: { seal: '漲', name: '漲潮', ult: true, aim: 'self', lv: 1, desc: '全隊回復一半血量，並救起倒地的隊友' },
  surge: { seal: '逆', name: '逆潮', ult: true, aim: 'self', lv: 10, desc: '全隊獲得護盾，並在 5 秒內持續回血' },
  // 燼矢
  blast: { seal: '爆', name: '爆燃箭', cd: 4, aim: 'enemy', range: 210, lv: 1, desc: '對目標造成大量傷害' },
  roll: { seal: '滾', name: '翻滾', cd: 6, aim: 'dir', range: 104, w: 10, lv: 1, desc: '朝指定方向翻滾，翻滾中不會受傷' },
  snipe: { seal: '斷', name: '斷法箭', cd: 10, aim: 'enemy', range: 240, kick: true, fn: 'kick', lv: 1, desc: '打斷敵人的金色讀條' },
  pierce: { seal: '穿', name: '穿刺箭', cd: 6, aim: 'dir', range: 250, w: 14, lv: 3, desc: '朝指定方向射出一箭，貫穿路上所有敵人' },
  volley: { seal: '散', name: '散射', cd: 7, aim: 'dir', range: 160, half: .5, lv: 5, desc: '朝前方扇形範圍射出一排箭' },
  mark: { seal: '印', name: '獵印', cd: 14, aim: 'enemy', range: 210, lv: 8, desc: '標記一個敵人，6 秒內所有人對它的傷害提高 25%' },
  dpsUlt: { seal: '雨', name: '燼雨', ult: true, aim: 'point', range: 210, rad: 72, lv: 1, desc: '在指定位置降下 4 秒火雨' },
  sunshot: { seal: '日', name: '貫日', ult: true, aim: 'dir', range: 320, w: 30, lv: 10, desc: '朝指定方向射出一道貫穿全場的重箭' }
};
for (const id of Object.keys(SKILLS)) SKILLS[id].id = id;
/* color values are token names; the client maps them to its palette. pool = the regular skills a class can pick
 * three of, ults = the ultimates it can pick one of. `skills` is the starting loadout, which is also what bots use. */
const CLASSES = {
  tank: { name: '盾衛', role: '坦克', mark: '盾', color: 'tank', hp: 1500, atk: 30, aspd: 0.9, range: 14, speed: 92, threat: 8, ultK: 14,
    pool: ['taunt', 'wall', 'bash', 'charge', 'quake', 'guard'], ults: ['tankUlt', 'anchor'] },
  heal: { name: '潮語者', role: '治療', mark: '潮', color: 'heal', hp: 900, atk: 16, aspd: 1.0, range: 180, speed: 98, threat: 1, ultK: 8,
    pool: ['mend', 'ring', 'seal', 'wave', 'pool', 'barrier'], ults: ['healUlt', 'surge'] },
  dps: { name: '燼矢', role: '輸出', mark: '矢', color: 'ember', hp: 950, atk: 44, aspd: 0.7, range: 190, speed: 104, threat: 1, ultK: 36,
    pool: ['blast', 'roll', 'snipe', 'pierce', 'volley', 'mark'], ults: ['dpsUlt', 'sunshot'] }
};
for (const k of Object.keys(CLASSES)) { const d = CLASSES[k]; d.skills = d.pool.slice(0, 3).concat(d.ults[0]).map(id => SKILLS[id]); for (const id of d.pool.concat(d.ults)) SKILLS[id].cls = k; }
const defaultLoadout = cls => CLASSES[cls].skills.map(s => s.id);
/* three different unlocked regular skills of the class, then one unlocked ultimate */
function validLoadout(cls, ids, cl) {
  const d = CLASSES[cls];
  return !!d && Array.isArray(ids) && ids.length === 4 && ids.slice(0, 3).every((id, i) => d.pool.includes(id) && ids.indexOf(id) === i && SKILLS[id].lv <= cl) && d.ults.includes(ids[3]) && SKILLS[ids[3]].lv <= cl;
}
const skillSet = (cls, ids) => validLoadout(cls, ids, 99) ? ids.map(id => SKILLS[id]) : CLASSES[cls].skills;
const ENEMY = {
  grunt: { name: '鏽蝕水鬼', hp: 1000, dmg: 34, aspd: 1.3, range: 8, speed: 70, r: 13 },
  caster: { name: '鹽咒祭司', hp: 800, dmg: 150, aspd: 0, range: 165, speed: 60, r: 12, caster: true },
  // field creatures: tuned for one player; aggro and leash are distances
  crab: { name: '鏽灘蟹', hp: 300, dmg: 20, aspd: 1.4, range: 6, speed: 64, r: 11, aggro: 95, leash: 300 },
  acolyte: { name: '鹽咒學徒', hp: 240, dmg: 85, aspd: 0, range: 150, speed: 58, r: 11, aggro: 130, leash: 320, caster: true },
  boss: { name: '鏽潮看守者 莫葛', hp: 27000, dmg: 80, aspd: 1.5, range: 10, speed: 58, r: 28 }
};
const WAVES = [ [['grunt', 3]], [['grunt', 2], ['caster', 1]], [['grunt', 2], ['caster', 2]], [['boss', 1]] ];
const ROSTER = ['tank', 'heal', 'dps', 'dps'];
const SPOTS = [[180, H - 150], [128, H - 84], [236, H - 96], [184, H - 58]];
const BOT_NAMES = { tank: '柯爾', heal: '蜜拉', dps: ['阿燼', '小霧'] };

/* ---------- the field: 鏽灘, the shore between the camp (south) and the tower gate (north) ---------- */
const GATHER_TIME = 1.4, NODE_RESPAWN = 45, MOB_RESPAWN = 25;
const SOLO_BOOST = { tank: 1.8, heal: 3.2, dps: 1 };   // alone in the field, tanks and healers hit harder so every class can hunt
const FIELD = {
  w: 900, h: 1500,
  spawn: [450, 1398], fire: [450, 1330], safe: { x: 450, y: 1325, r: 150 },   // monsters neither enter nor attack into the camp
  gate: { x: 450, y: 120, r: 46 },
  npcs: [{ id: 'kol', x: 385, y: 1285 }, { id: 'mira', x: 512, y: 1280 }, { id: 'jin', x: 540, y: 1372 }, { id: 'wu', x: 372, y: 1378 }],
  path: [[450, 1320], [430, 1100], [520, 860], [400, 620], [470, 380], [450, 170]],
  rocks: [{ x: 250, y: 1150, r: 34 }, { x: 650, y: 1010, r: 40 }, { x: 330, y: 900, r: 30 }, { x: 690, y: 740, r: 36 }, { x: 220, y: 660, r: 38 },
    { x: 590, y: 510, r: 32 }, { x: 300, y: 390, r: 34 }, { x: 660, y: 310, r: 38 }, { x: 150, y: 930, r: 26 }, { x: 770, y: 560, r: 28 }],
  nodes: [
    { id: 1, type: 'herb', x: 180, y: 1230 }, { id: 2, type: 'herb', x: 730, y: 1190 }, { id: 3, type: 'herb', x: 130, y: 790 }, { id: 4, type: 'herb', x: 780, y: 900 },
    { id: 5, type: 'herb', x: 240, y: 520 }, { id: 6, type: 'herb', x: 710, y: 420 },
    { id: 7, type: 'wreck', x: 590, y: 1160 }, { id: 8, type: 'wreck', x: 280, y: 1010 }, { id: 9, type: 'wreck', x: 770, y: 690 }, { id: 10, type: 'wreck', x: 150, y: 560 }, { id: 11, type: 'wreck', x: 560, y: 320 },
    { id: 12, type: 'salt', x: 110, y: 1060 }, { id: 13, type: 'salt', x: 810, y: 620 }, { id: 14, type: 'salt', x: 360, y: 270 }, { id: 15, type: 'salt', x: 630, y: 180 }],
  // min/max: a creature takes the player's level, held inside this range. South is gentle, the north shore is not.
  packs: [{ kind: 'crab', x: 270, y: 1060, n: 2, min: 1, max: 6 }, { kind: 'crab', x: 660, y: 1120, n: 2, min: 1, max: 6 }, { kind: 'crab', x: 520, y: 930, n: 2, min: 2, max: 7 },
    { kind: 'acolyte', x: 220, y: 820, n: 1, min: 3, max: 9 }, { kind: 'crab', x: 710, y: 830, n: 3, min: 3, max: 8 }, { kind: 'crab', x: 330, y: 690, n: 2, min: 4, max: 9 },
    { kind: 'acolyte', x: 610, y: 610, n: 2, min: 5, max: 11 }, { kind: 'crab', x: 170, y: 440, n: 3, min: 6, max: 11 }, { kind: 'crab', x: 520, y: 440, n: 2, min: 6, max: 12 },
    { kind: 'acolyte', x: 400, y: 280, n: 2, min: 8, max: 14 }, { kind: 'crab', x: 720, y: 220, n: 2, min: 8, max: 14 }]
};
/* ---------- character level ----------
 * Level comes from experience and is separate from how deep you have gone in the tower. One factor, lvF, turns a
 * level into strength for players and creatures alike, so an even-level fight feels the same at any level and
 * gear is what puts you ahead. */
const MAX_LEVEL = 30;
const lvF = L => 1 + .06 * (Math.max(1, L) - 1);
const xpNeed = L => L >= MAX_LEVEL ? 0 : Math.round(80 + 45 * Math.pow(L - 1, 1.6));   // experience to go from L to L + 1
const recLevel = floor => Math.min(MAX_LEVEL, 1 + (floor - 1) * 2);                    // the level a tower floor is meant for
const mobLevel = (pk, cl) => clamp(cl, pk.min, pk.max);
const KILL_XP = { crab: 12, acolyte: 16 };
/* Creatures a few levels under you teach less and less; ones above you teach a little more. */
function xpForKill(kind, mobLvl, cl) {
  const d = cl - mobLvl, mul = d < 0 ? Math.min(1.3, 1 - d * .1) : d <= 2 ? 1 : d >= 7 ? .1 : 1 - (d - 2) * .2;
  return Math.round((KILL_XP[kind] || 0) * lvF(mobLvl) * mul);
}
function scaleMob(e, lvl) { const k = e.maxHp ? e.hp / e.maxHp : 1; e.lvl = lvl; e.maxHp = R(e.def.hp * lvF(lvl)); e.hp = Math.max(1, R(e.maxHp * k)); e.dmg = e.def.dmg * lvF(lvl); }
function setLevel(a, lvl, pow) { a.lvl = lvl; a.pow = pow; a.maxHp = R(a.def.hp * pow); a.hp = a.maxHp; }   // levelling up refills your health

const inCamp = p => Math.hypot(p.x - FIELD.safe.x, p.y - FIELD.safe.y) < FIELD.safe.r;
function pushOut(p) { for (const r of FIELD.rocks) { const dx = p.x - r.x, dy = p.y - r.y, d = Math.hypot(dx, dy) || .01, m = r.r + p.r; if (d < m) { p.x = r.x + dx / d * m; p.y = r.y + dy / d * m; } } }

/* ---------- events ---------- */
function ev(G, o) { G.events.push(o); }
function text(G, x, y, s, c, z, d) { ev(G, { k: 'text', x: R(x), y: R(y), s, c, z: z || 11, d: d || .8 }); }
function ring(G, x, y, a, b, c, d) { ev(G, { k: 'ring', x: R(x), y: R(y), a: R(a), b: R(b), c, d: d || .35 }); }
function beam(G, p, q, c) { ev(G, { k: 'beam', x: R(p.x), y: R(p.y), x2: R(q.x), y2: R(q.y), c }); }
function banner(G, s, ms) { ev(G, { k: 'banner', s, ms: ms || 1600 }); }
function shake(G, v) { ev(G, { k: 'shake', v }); }
function fail(G, a, s) { if (a.human) ev(G, { k: 'fail', i: a.idx, s }); return false; }

/* ---------- setup ---------- */
function mkActor(cls, name, spot, pow) {
  const d = CLASSES[cls];
  return { cls, def: d, name, x: spot[0], y: spot[1], r: 12, pow, maxHp: R(d.hp * pow), hp: R(d.hp * pow), alive: true, human: false, pid: null, idx: 0,
    target: null, atkT: rand(0, .5), cds: [0, 0, 0, 0], ult: 0, wallT: 0, shield: 0, iframe: 0, rollT: 0, rvx: 0, rvy: 0, face: -Math.PI / 2, idleT: 0, potions: 0,
    skills: d.skills, hotT: 0, hotPer: 0,
    ctrl: { mx: 0, my: 0, cast: [false, false, false, false], aim: [null, null, null, null], healOn: null, pot: false },
    input: { mx: 0, my: 0, cast: [false, false, false, false], aim: [null, null, null, null], heal: -1, tg: 0, pot: false },
    stats: { dmg: 0, heal: 0, kicks: 0, hits: 0, pots: 0 },
    ai: { react: 0, delay: rand(.3, .75), kick: new WeakMap(), wob: rand(0, TAU), gcd: rand(0, .4) } };
}
/* opts: { lvl, players: [{ cls, name, pow, id, potions, lvl, skills }], grace, auto }
 * Each player takes the first free seat of their class; every other seat is a bot. */
function createRun(opts) {
  const lvl = opts.lvl || 1, botPow = 1 + .1 * (lvl - 1);
  const G = { mode: 'dungeon', bw: W, bh: H, t: 0, lvl, elvl: recLevel(lvl), es: Math.pow(1.13, lvl - 1), state: 'countdown', cd: 3, wave: -1, gap: null, actors: [], enemies: [], zones: [], shots: [], events: [],
    boss: null, result: null, nextId: 1, grace: opts.grace || 0, auto: !!opts.auto };
  const pending = (opts.players || []).slice(); let dpsN = 0;
  ROSTER.forEach((c, i) => {
    const k = pending.findIndex(p => p.cls === c), p = k >= 0 ? pending.splice(k, 1)[0] : null;
    const a = mkActor(c, p ? p.name : (c === 'dps' ? BOT_NAMES.dps[dpsN++] : BOT_NAMES[c]), SPOTS[i], p ? p.pow : botPow);
    a.lvl = p && p.lvl > 0 ? p.lvl : G.elvl;   // a player shows their own level; a bot shows the level the floor is meant for
    a.idx = i; a.human = !!p; a.pid = p ? p.id : null; a.potions = p && p.potions > 0 ? 1 : 0; if (p && p.skills) a.skills = skillSet(c, p.skills); G.actors.push(a);   // one potion per run
  });
  return G;
}
function mkEnemy(G, kind, x, y) {
  const d = ENEMY[kind], s = G.es;
  const e = { id: G.nextId++, kind, def: d, name: d.name, lvl: G.elvl || 1, x, y, r: d.r, maxHp: R(d.hp * s), hp: R(d.hp * s), dmg: d.dmg * s, atkT: rand(.4, 1), threat: new Map(),
    fix: null, fixT: 0, target: null, cast: null, stun: 0, boss: kind === 'boss', tm: {}, alive: true, spawnT: .6, face: Math.PI / 2 };
  if (d.caster) e.tm.cast = rand(1.5, 3.5);
  if (e.boss) { e.tm = { cleave: 5, bells: 8, roar: 12, adds: false, enraged: false }; G.boss = e; }
  const tank = G.mode !== 'field' && G.actors.find(a => a.cls === 'tank'); if (tank) e.threat.set(tank, 40);
  G.enemies.push(e); return e;
}
function spawnMob(G, pk, home) {
  const def = FIELD.packs[pk], e = mkEnemy(G, def.kind, home.x + rand(-14, 14), home.y + rand(-14, 14));
  e.pk = pk; e.home = home; e.wx = e.x; e.wy = e.y; e.wt = rand(0, 3); e.engaged = false; e.ret = false; scaleMob(e, mobLevel(def, G.actors[0].lvl)); return e;
}
/* opts: { lvl (tower floor reached), player: { cls, name, pow, id, lvl (character level) } }. One player, no bots, no timer. */
function createField(opts) {
  const lvl = opts.lvl || 1, p = opts.player;
  const G = { mode: 'field', bw: FIELD.w, bh: FIELD.h, t: 0, lvl, elvl: 1, es: 1, state: 'run', cd: 0, wave: -1, gap: null, actors: [], enemies: [], zones: [], shots: [], events: [],
    boss: null, result: null, nextId: 1, grace: 0, auto: false, respawns: [], nodes: FIELD.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, ready: true, t: 0 })) };
  const a = mkActor(p.cls, p.name, FIELD.spawn, p.pow); a.lvl = p.lvl > 0 ? p.lvl : 1; if (p.skills) a.skills = skillSet(p.cls, p.skills); a.idx = 0; a.human = true; a.pid = p.id; a.calm = 0; a.downT = 0; a.gather = null; a.pick = 0; G.actors.push(a);
  FIELD.packs.forEach((pk, k) => { for (let i = 0; i < pk.n; i++) spawnMob(G, k, { x: pk.x + (i - (pk.n - 1) / 2) * 34, y: pk.y + (i % 2) * 22 }); });
  return G;
}
function nextWave(G) {
  G.wave++; const w = WAVES[G.wave]; if (!w) return;
  const list = []; for (const [k, n] of w) for (let i = 0; i < n; i++) list.push(k);
  list.forEach((k, i) => mkEnemy(G, k, W / 2 + (i - (list.length - 1) / 2) * 52, k === 'boss' ? 84 : k === 'caster' ? 58 : 76));
  if (G.boss) banner(G, '莫葛從潮門爬了出來', 2200);
}

/* ---------- combat helpers ---------- */
function inRange(a, t, extra) { return dist(a, t) <= a.def.range + a.r + t.r + (extra || 0); }
function nearest(p, list) { let b = null, bd = 1e9; for (const o of list) { if (!o.alive) continue; const d = dist(p, o); if (d < bd) { bd = d; b = o; } } return b; }
const bossMul = G => G.t > TIME_LIMIT ? 1 + (G.t - TIME_LIMIT) / 15 : 1;

function hurtActor(G, a, dmg, avoidable) {
  if (!a.alive || a.iframe > 0) return;
  if (a.wallT > 0) dmg *= .4;
  if (a.shield > 0) { const s = Math.min(a.shield, dmg); a.shield -= s; dmg -= s; }
  if (dmg <= 0) return;
  a.hp -= dmg; a.ult = Math.min(100, a.ult + dmg / a.maxHp * 40);
  if (avoidable) a.stats.hits++;
  ev(G, { k: 'hurt', i: a.idx, v: R(dmg), av: avoidable ? 1 : 0 });
  if (a.hp <= 0) { a.hp = 0; a.alive = false; a.shield = 0; ev(G, { k: 'down', i: a.idx }); }
}
function hurtEnemy(G, e, dmg, src, big, noUlt) {
  if (!e.alive || e.ret) return;                        // a creature walking back to its spot cannot be hurt
  if (G.mode === 'field') dmg *= SOLO_BOOST[src.cls] || 1;
  if (e.vulnT > 0) dmg *= 1.25;                         // marked by a hunter
  e.hp -= dmg; src.stats.dmg += dmg;
  e.threat.set(src, (e.threat.get(src) || 0) + dmg * src.def.threat);
  if (!noUlt) src.ult = Math.min(100, src.ult + dmg / (src.pow * src.def.ultK));
  ev(G, { k: 'dmg', x: R(e.x), y: R(e.y - e.r - 6), v: R(dmg), big: big ? 1 : 0, by: src.idx });
  if (e.hp <= 0) {
    e.hp = 0; e.alive = false; ring(G, e.x, e.y, e.r * .5, e.r * 2.2, e.boss ? 'brass' : 'rust', .45);
    if (G.mode === 'field') { G.respawns.push({ pk: e.pk, home: e.home, at: G.t + MOB_RESPAWN }); ev(G, { k: 'kill', kind: e.kind, pk: e.pk, by: src.idx }); }
    if (e.boss) { for (const o of G.enemies) if (o !== e && o.alive) { o.alive = false; ring(G, o.x, o.y, 6, 30, 'rust', .4); } G.zones.length = 0; shake(G, .6); }
  }
}
function healActor(G, a, amt, src) {
  if (!a.alive) return;
  const real = Math.min(amt, a.maxHp - a.hp); if (real < 1) return;
  a.hp += real; src.stats.heal += real;
  src.ult = Math.min(100, src.ult + real / (src.pow * 22));
  ev(G, { k: 'heal', i: a.idx, v: R(real), by: src.idx });
  for (const e of G.enemies) e.threat.set(src, (e.threat.get(src) || 0) + real * .2);
}
function revive(G, p) { p.alive = true; p.hp = p.maxHp * .5; text(G, p.x, p.y - 26, '救起', 'heal', 14, 1.2); ring(G, p.x, p.y, 6, 30, 'heal'); }
function shoot(G, a, t, dmg, big) { G.shots.push({ id: G.nextId++, x: a.x, y: a.y, px: a.x, py: a.y, t, dmg, src: a, spd: big ? 460 : 520, big, col: a.def.color }); }
function addZone(G, z) { z.id = G.nextId++; z.t = 0; z.ign = new Set(G.actors.filter(a => !a.human && Math.random() < .14)); G.zones.push(z); }
function inZone(z, p, m) {
  const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy);
  if (z.type === 'circle') return d <= z.r + m;
  if (d > z.len + m) return false; if (d < 10) return true;
  return Math.abs(norm(Math.atan2(dy, dx) - z.ang)) <= z.half + m / d;
}
function pointDanger(G, p, a) { for (const z of G.zones) { if (z.friendly || z.done) continue; if (z.ign.has(a)) continue; if (inZone(z, p, 14)) return true; } return false; }

/* ---------- aiming ----------
 * An aim is { k: 'id', id } (an enemy id, or -(seat + 1) for an ally), { k: 'd', x, y } (a direction) or
 * { k: 'p', x, y } (a spot). It is null for a plain tap, and each resolver then picks something sensible. */
function cleanAim(o) {
  if (!o || typeof o !== 'object') return null; const x = Number(o.x), y = Number(o.y);
  if (o.k === 'id' && Number.isInteger(o.id) && Math.abs(o.id) < 1e6) return { k: 'id', id: o.id };
  if ((o.k === 'd' || o.k === 'p') && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e5 && Math.abs(y) < 1e5) return { k: o.k, x, y };
  return null;
}
function nearestFoe(G, a, reach) { let b = null, bd = 1e9; for (const e of G.enemies) if (e.alive && !e.ret) { const d = dist(a, e) - a.r - e.r; if (d <= reach && d < bd) { bd = d; b = e; } } return b; }
/* The enemy a skill should hit: the one that was dragged onto, else the current target, else the nearest in reach.
 * Whoever it is becomes the locked target. Returns null when nothing valid is within reach. */
function aimEnemy(G, a, aim, reach) {
  const ok = e => e && e.alive && !e.ret && dist(a, e) - a.r - e.r <= reach;
  let t = aim && aim.k === 'id' && aim.id > 0 ? G.enemies.find(e => e.id === aim.id) : null;
  if (aim && aim.k === 'id' && aim.id > 0) { if (!ok(t)) return null; }
  else t = ok(a.target) ? a.target : nearestFoe(G, a, reach);
  if (!t) return null; a.target = t; a.pick = t.id; return t;
}
function aimAlly(G, a, aim, others) {
  if (aim && aim.k === 'id' && aim.id < 0) { const p = G.actors[-aim.id - 1]; if (p && p.alive) return p; }
  let t = null, br = 2; for (const p of G.actors) { if (!p.alive || (others && p === a && G.actors.length > 1)) continue; const r = p.hp / p.maxHp; if (r < br) { br = r; t = p; } }
  return t || a;
}
function aimDir(G, a, aim) {
  if (aim && aim.k === 'd') { const m = Math.hypot(aim.x, aim.y); if (m > .001) return { x: aim.x / m, y: aim.y / m }; }
  const t = a.target && a.target.alive ? a.target : nearestFoe(G, a, 320);
  if (t) { const d = dist(a, t) || 1; return { x: (t.x - a.x) / d, y: (t.y - a.y) / d }; }
  return { x: Math.cos(a.face), y: Math.sin(a.face) };
}
function aimPoint(G, a, aim, range, fallback) {
  let p = aim && aim.k === 'p' ? { x: aim.x, y: aim.y } : fallback; if (!p) return null;
  const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy); if (d > range) p = { x: a.x + dx / d * range, y: a.y + dy / d * range };
  return { x: clamp(p.x, 0, G.bw), y: clamp(p.y, 0, G.bh) };
}
function inLine(p, o, d, len, hw) { const rx = p.x - o.x, ry = p.y - o.y, f = rx * d.x + ry * d.y; return f >= -p.r && f <= len + p.r && Math.abs(rx * d.y - ry * d.x) <= hw + p.r; }
function inCone(p, o, ang, half, len) { const dx = p.x - o.x, dy = p.y - o.y, dd = Math.hypot(dx, dy); if (dd > len + p.r) return false; return dd < 12 || Math.abs(norm(Math.atan2(dy, dx) - ang)) <= half + p.r / dd; }
function lineFx(G, o, d, len, w, c) { ev(G, { k: 'line', x: R(o.x), y: R(o.y), x2: R(o.x + d.x * len), y2: R(o.y + d.y * len), w, c }); }
function coneFx(G, o, ang, half, len, c) { ev(G, { k: 'cone', x: R(o.x), y: R(o.y), a: r2(ang), h: half, l: len, c }); }
function stunFoe(G, a, e, t) {      // bosses shrug it off; a stun also breaks a gold cast
  if (e.boss) return; e.stun = Math.max(e.stun, t);
  if (e.cast && e.cast.kickable) { e.cast = null; if (e.def.caster) e.tm.cast = rand(4, 5); a.stats.kicks++; text(G, e.x, e.y - e.r - 24, '打斷', 'brass', 16, 1.1); }
}

/* ---------- skills: SK[id](G, caster, aim, skill) ---------- */
const SK = {
  taunt(G, a, aim, sk) { const t = aimEnemy(G, a, aim, sk.range); if (!t) return fail(G, a, '離目標太遠'); hurtEnemy(G, t, a.def.atk * a.pow * 2.4, a, true); t.fix = a; t.fixT = 4; ring(G, t.x, t.y, 8, 36, 'tank'); },
  wall(G, a) { a.wallT = 4; ring(G, a.x, a.y, 8, 32, 'tank'); },
  kick(G, a, aim, sk) {
    const want = aim && aim.k === 'id' ? aim.id : 0; let best = null;
    for (const e of G.enemies) {
      if (!e.alive || !e.cast || !e.cast.kickable || dist(a, e) > sk.range + e.r) continue;
      const score = (e.id === want ? 4 : 0) + (e === a.target ? 2 : 0) + e.cast.t / e.cast.dur; if (!best || score > best.s) best = { e, s: score };
    }
    if (!best) return fail(G, a, '沒有金色讀條可以打斷');
    const e = best.e; e.cast = null; e.stun = 1.2; if (e.def.caster) e.tm.cast = rand(4, 5);
    hurtEnemy(G, e, a.def.atk * a.pow, a); beam(G, a, e, 'brass'); ring(G, e.x, e.y, e.r, e.r + 22, 'brass');
    text(G, e.x, e.y - e.r - 24, '打斷', 'brass', 16, 1.1); a.stats.kicks++;
  },
  charge(G, a, aim, sk) {
    const d = aimDir(G, a, aim), o = { x: a.x, y: a.y };
    a.rvx = d.x * sk.range / .22; a.rvy = d.y * sk.range / .22; a.rollT = .22; a.iframe = Math.max(a.iframe, .25);
    for (const e of G.enemies) if (e.alive && inLine(e, o, d, sk.range, sk.w)) { hurtEnemy(G, e, a.def.atk * a.pow * 2.2, a, true); stunFoe(G, a, e, .9); }
    lineFx(G, o, d, sk.range, sk.w, 'tank');
  },
  quake(G, a, aim, sk) {
    const d = aimDir(G, a, aim), ang = Math.atan2(d.y, d.x);
    for (const e of G.enemies) if (e.alive && inCone(e, a, ang, sk.half, sk.range)) { hurtEnemy(G, e, a.def.atk * a.pow * 2.6, a, true); e.fix = a; e.fixT = 3; }
    coneFx(G, a, ang, sk.half, sk.range, 'tank'); shake(G, .2);
  },
  guard(G, a, aim) { const t = aimAlly(G, a, aim, true); t.shield = Math.max(t.shield, 360 * a.pow); if (t !== a) beam(G, a, t, 'tank'); ring(G, t.x, t.y, 8, 30, 'tank'); },
  tankUlt(G, a) { for (const e of G.enemies) { e.fix = a; e.fixT = 5; } for (const p of G.actors) if (p.alive) p.shield = Math.max(p.shield, 260 * a.pow); ring(G, a.x, a.y, 10, 170, 'tank', .55); },
  anchor(G, a, aim, sk) {
    const t = a.target && a.target.alive ? a.target : nearestFoe(G, a, sk.range), p = aimPoint(G, a, aim, sk.range, t); if (!p) return fail(G, a, '沒有目標');
    for (const e of G.enemies) if (e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= sk.rad + e.r) { hurtEnemy(G, e, a.def.atk * a.pow * 8, a, true); stunFoe(G, a, e, 1.5); }
    ring(G, p.x, p.y, 10, sk.rad, 'tank', .5); shake(G, .5);
  },
  mend(G, a, aim) {
    let t = aim && aim.k === 'id' && aim.id < 0 ? G.actors[-aim.id - 1] : null; if (t && !t.alive) t = null;
    if (!t) { let br = 1; for (const p of G.actors) { if (!p.alive) continue; const r = p.hp / p.maxHp; if (r < br) { br = r; t = p; } } }
    if (!t) return fail(G, a, '隊友都是滿血');
    healActor(G, t, 280 * a.pow, a); if (t !== a) beam(G, a, t, 'heal'); ring(G, t.x, t.y, 6, 22, 'heal');
  },
  ring(G, a) { for (const p of G.actors) if (p.alive && dist(a, p) <= 120) healActor(G, p, 170 * a.pow, a); ring(G, a.x, a.y, 10, 120, 'heal', .45); },
  wave(G, a, aim, sk) {
    const d = aimDir(G, a, aim);
    for (const e of G.enemies) if (e.alive && inLine(e, a, d, sk.range, sk.w)) hurtEnemy(G, e, a.def.atk * a.pow * 3, a, true);
    for (const p of G.actors) if (p.alive && p !== a && inLine(p, a, d, sk.range, sk.w)) healActor(G, p, 150 * a.pow, a);
    lineFx(G, a, d, sk.range, sk.w, 'heal');
  },
  pool(G, a, aim, sk) {
    const p = aimPoint(G, a, aim, sk.range, aimAlly(G, a, null, false));
    G.zones.push({ id: G.nextId++, friendly: true, heal: true, type: 'circle', x: p.x, y: p.y, r: sk.rad, t: 0, dur: 5, tick: 0, dmg: 45 * a.pow, src: a, ign: new Set() });
  },
  barrier(G, a, aim) { const t = aimAlly(G, a, aim, false); t.shield = Math.max(t.shield, 320 * a.pow); if (t !== a) beam(G, a, t, 'heal'); ring(G, t.x, t.y, 8, 30, 'heal'); },
  healUlt(G, a) { for (const p of G.actors) { if (!p.alive) revive(G, p); else healActor(G, p, p.maxHp * .5, a); } ring(G, a.x, a.y, 10, 240, 'heal', .7); },
  surge(G, a) { for (const p of G.actors) if (p.alive) { p.shield = Math.max(p.shield, 300 * a.pow); p.hotT = 5; p.hotPer = p.maxHp * .06; } ring(G, a.x, a.y, 10, 240, 'heal', .7); },
  blast(G, a, aim, sk) { const t = aimEnemy(G, a, aim, sk.range); if (!t) return fail(G, a, '離目標太遠'); shoot(G, a, t, a.def.atk * a.pow * 3.6, true); },
  roll(G, a, aim) {
    let mx = a.ctrl.mx, my = a.ctrl.my, m = Math.hypot(mx, my);
    if (aim && aim.k === 'd' && Math.hypot(aim.x, aim.y) > .001) { mx = aim.x; my = aim.y; m = Math.hypot(mx, my); }   // an aimed roll goes where you pointed
    else if (m < .2) { mx = -Math.cos(a.face); my = -Math.sin(a.face); m = 1; }
    a.rvx = mx / m * 400; a.rvy = my / m * 400; a.rollT = .26; a.iframe = .42;
  },
  pierce(G, a, aim, sk) {
    const d = aimDir(G, a, aim);
    for (const e of G.enemies) if (e.alive && inLine(e, a, d, sk.range, sk.w)) hurtEnemy(G, e, a.def.atk * a.pow * 3.2, a, true);
    lineFx(G, a, d, sk.range, sk.w, 'ember');
  },
  volley(G, a, aim, sk) {
    const d = aimDir(G, a, aim), ang = Math.atan2(d.y, d.x);
    for (const e of G.enemies) if (e.alive && inCone(e, a, ang, sk.half, sk.range)) hurtEnemy(G, e, a.def.atk * a.pow * 2.2, a, true);
    coneFx(G, a, ang, sk.half, sk.range, 'ember');
  },
  mark(G, a, aim, sk) { const t = aimEnemy(G, a, aim, sk.range); if (!t) return fail(G, a, '離目標太遠'); t.vulnT = 6; text(G, t.x, t.y - t.r - 24, '獵印', 'ember', 14, 1.1); ring(G, t.x, t.y, t.r, t.r + 20, 'ember'); },
  dpsUlt(G, a, aim, sk) {
    const t = a.target && a.target.alive ? a.target : nearestFoe(G, a, sk.range), p = aimPoint(G, a, aim, sk.range, t); if (!p) return fail(G, a, '沒有目標');
    G.zones.push({ id: G.nextId++, friendly: true, type: 'circle', x: p.x, y: p.y, r: sk.rad, t: 0, dur: 4, tick: 0, dmg: a.def.atk * a.pow * 1.6, src: a, ign: new Set() });
  },
  sunshot(G, a, aim, sk) {
    const d = aimDir(G, a, aim);
    for (const e of G.enemies) if (e.alive && inLine(e, a, d, sk.range, sk.w)) hurtEnemy(G, e, a.def.atk * a.pow * 14, a, true);
    lineFx(G, a, d, sk.range, sk.w, 'brass'); shake(G, .4);
  }
};
function tryCast(G, a, i, aim) {
  const sk = a.skills[i]; if (!a.alive || !sk) return false;
  if (sk.ult) { if (a.ult < 100) return false; } else if (a.cds[i] > 0) return false;
  if (SK[sk.fn || sk.id](G, a, aim || null, sk) === false) return false;
  if (sk.ult) a.ult = 0; else a.cds[i] = sk.cd;
  return true;
}

/* ---------- controllers: people and bots both fill the same ctrl object ---------- */
function playerThink(G, a, dt) {
  const c = a.ctrl, inp = a.input;
  c.mx = clamp(+inp.mx || 0, -1, 1); c.my = clamp(+inp.my || 0, -1, 1);
  for (let i = 0; i < 4; i++) if (inp.cast[i]) { c.cast[i] = true; c.aim[i] = inp.aim[i]; inp.cast[i] = false; inp.aim[i] = null; }
  if (inp.heal >= 0) { c.healOn = G.actors[inp.heal] || null; inp.heal = -1; }
  if (inp.pot) { c.pot = true; inp.pot = false; }
  if (inp.tg) { const e = G.enemies.find(e => e.id === inp.tg && e.alive); if (e) { a.target = e; a.pick = e.id; } inp.tg = 0; }
  if (!a.alive) return;
  if (G.mode === 'field') {      // out here you only fight what is fighting you, or what you tapped
    const t0 = a.target; if (t0 && (!t0.alive || t0.ret || (!t0.engaged && a.pick !== t0.id))) a.target = null;
    if (!a.target) { let bd = 1e9; for (const e of G.enemies) if (e.alive && e.engaged && e.threat.has(a)) { const d = dist(a, e); if (d < bd) { bd = d; a.target = e; } } }
  } else if (!a.target || !a.target.alive) a.target = nearest(a, G.enemies);
  const idle = Math.hypot(c.mx, c.my) < .05; a.idleT = idle ? a.idleT + dt : 0;
  const t = a.target;
  if (idle && a.idleT > .5 && t && !inRange(a, t, -2)) {   // step into range by yourself, but never into a red zone
    const d = dist(a, t) || 1, dx = (t.x - a.x) / d, dy = (t.y - a.y) / d;
    if (!pointDanger(G, { x: a.x + dx * 16, y: a.y + dy * 16 }, a) && !pointDanger(G, a, a)) { c.mx = dx; c.my = dy; }
  }
}
function dangerVec(G, a) {
  let vx = 0, vy = 0, found = false;
  for (const z of G.zones) {
    if (z.friendly || z.done || z.ign.has(a) || !inZone(z, a, 16)) continue;
    found = true; const dx = a.x - z.x, dy = a.y - z.y, d = Math.hypot(dx, dy) || 1;
    if (z.type === 'circle') { if (d < 3) { vx += Math.cos(a.ai.wob); vy += Math.sin(a.ai.wob); } else { vx += dx / d; vy += dy / d; } }
    else { const s = norm(Math.atan2(dy, dx) - z.ang) >= 0 ? 1 : -1; vx += Math.cos(z.ang + s * Math.PI / 2); vy += Math.sin(z.ang + s * Math.PI / 2); }
  }
  if (!found) return null;
  vx += (W / 2 - a.x) / W * .7; vy += (H / 2 - a.y) / H * .7;
  return { x: vx, y: vy };
}
function botThink(G, a, dt) {
  const c = a.ctrl; c.mx = 0; c.my = 0; if (!a.alive) return;
  const en = G.enemies; let tg = null;
  if (a.cls === 'tank') {
    let ld = 1e9; for (const e of en) if (e.alive && e.target && e.target !== a) { const d = dist(a, e); if (d < ld) { ld = d; tg = e; } }
    if (!tg) tg = (G.boss && G.boss.alive) ? G.boss : (a.target && a.target.alive ? a.target : nearest(a, en));
  } else {
    const pr = e => e.kind === 'caster' ? 0 : e.kind === 'grunt' ? 1 : 2; let bs = 1e9;
    for (const e of en) { if (!e.alive) continue; const s = pr(e) * 1e6 + e.hp; if (s < bs) { bs = s; tg = e; } }
  }
  a.target = tg;
  const dv = dangerVec(G, a); let moved = false;
  if (dv) { a.ai.react += dt; if (a.ai.react >= a.ai.delay) { c.mx = dv.x; c.my = dv.y; moved = true; const rk = a.skills.findIndex(k => k.id === 'roll'); if (rk >= 0 && a.cds[rk] <= 0 && Math.random() < dt * 2) c.cast[rk] = true; } }
  else a.ai.react = 0;
  if (!moved && tg) {
    const d = dist(a, tg) || 1, dx = (tg.x - a.x) / d, dy = (tg.y - a.y) / d;
    if (a.cls === 'tank') { if (!inRange(a, tg, -4)) { c.mx = dx; c.my = dy; } }
    else {
      const edge = d - a.r - tg.r;
      if (edge > a.def.range * .92) { c.mx = dx; c.my = dy; } else if (edge < 70) { c.mx = -dx; c.my = -dy; }
      const b = G.boss;   // stay out of the boss's front
      if (b && b.alive && b.target && b.target !== a && dist(a, b) < 150) {
        const fa = Math.atan2(b.target.y - b.y, b.target.x - b.x), da = norm(Math.atan2(a.y - b.y, a.x - b.x) - fa);
        if (Math.abs(da) < 1) { const s = da >= 0 ? 1 : -1; c.mx += Math.cos(fa + s * Math.PI / 2) * .9; c.my += Math.sin(fa + s * Math.PI / 2) * .9; }
      }
      for (const o of G.actors) if (o !== a && o.alive) { const dd = dist(a, o); if (dd < 34) { c.mx += (a.x - o.x) / (dd || 1) * .6; c.my += (a.y - o.y) / (dd || 1) * .6; } }
    }
    const m = Math.hypot(c.mx, c.my);
    if (m < .3) { c.mx = 0; c.my = 0; }
    else if (pointDanger(G, { x: a.x + c.mx / m * 18, y: a.y + c.my / m * 18 }, a)) { c.mx = 0; c.my = 0; }
  }
  botSkills(G, a, dt);
}
/* Bots know the starting skills. If a seat they take over carries other skills, they use the ones they recognise. */
function botSkills(G, a, dt) {
  const c = a.ctrl.cast, ai = a.ai, kk = a.skills.findIndex(k => k.kick), ult = a.skills[3].id;
  const use = (id, ok) => { const k = a.skills.findIndex(q => q.id === id); if (k < 0 || a.cds[k] > 0 || !ok) return false; c[k] = true; return true; };
  for (const e of G.enemies) {   // each bot only tries some interrupts, and late, so a quick player matters
    const k = e.cast; if (!k || !k.kickable) continue;
    let plan = ai.kick.get(k); if (plan === undefined) { plan = Math.random() < .34 ? rand(.45, .85) * k.dur : -1; ai.kick.set(k, plan); }
    if (kk >= 0 && plan >= 0 && k.t >= plan && a.cds[kk] <= 0) c[kk] = true;
  }
  ai.gcd -= dt; if (ai.gcd > 0) return; ai.gcd = .4;
  const t = a.target, live = G.actors.filter(p => p.alive), ratio = p => p.hp / p.maxHp;
  if (a.cls === 'tank') {
    const loose = G.enemies.filter(e => e.alive && e.target && e.target !== a).length;
    if (a.ult >= 100 && ult === 'tankUlt' && (loose >= 2 || live.reduce((s, p) => s + ratio(p), 0) / live.length < .55)) c[3] = true;
    use('taunt', t && inRange(a, t, 10) && (t.target !== a || t.boss));
    use('wall', ratio(a) < .5);
  } else if (a.cls === 'heal') {
    const low = live.filter(p => ratio(p) < .35).length, down = G.actors.length - live.length;
    if (a.ult >= 100 && ult === 'healUlt' && (down > 0 || low >= 2)) { c[3] = true; return; }
    if (use('ring', live.filter(p => ratio(p) < .7 && dist(a, p) <= 120).length >= 2)) return;
    use('mend', live.some(p => ratio(p) < .8));
  } else {
    use('blast', t && inRange(a, t, 20));
    if (t && a.ult >= 100 && ult === 'dpsUlt' && ((G.boss && G.boss.alive) || G.enemies.length >= 3)) c[3] = true;
  }
}

/* ---------- simulation ---------- */
function updActor(G, a, dt) {
  for (let i = 0; i < 4; i++) if (a.cds[i] > 0) a.cds[i] = Math.max(0, a.cds[i] - dt);
  a.wallT = Math.max(0, a.wallT - dt); a.iframe = Math.max(0, a.iframe - dt);
  if (a.hotT > 0) { a.hotT -= dt; if (a.alive && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.hotPer * dt); }
  const c = a.ctrl;
  if (!a.alive) { c.cast.fill(false); c.aim.fill(null); c.healOn = null; c.pot = false; return; }
  if (a.target && !a.target.alive) a.target = null;
  if (a.rollT > 0) { a.rollT -= dt; a.x += a.rvx * dt; a.y += a.rvy * dt; }
  else {
    let mx = c.mx, my = c.my; const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    if (m > .05) { a.x += mx * a.def.speed * dt; a.y += my * a.def.speed * dt; if (!a.target) a.face = Math.atan2(my, mx); }
  }
  a.x = clamp(a.x, a.r + 6, G.bw - a.r - 6); a.y = clamp(a.y, a.r + (G.mode === 'field' ? 6 : 36), G.bh - a.r - 8);
  if (G.mode === 'field') pushOut(a);
  if (a.target) a.face = Math.atan2(a.target.y - a.y, a.target.x - a.x);
  if (c.healOn) { const k = a.skills.findIndex(q => q.aim === 'ally'); if (k >= 0) tryCast(G, a, k, { k: 'id', id: -(c.healOn.idx + 1) }); c.healOn = null; }   // a tap on a party frame
  for (let i = 0; i < 4; i++) if (c.cast[i]) { const aim = c.aim[i]; c.cast[i] = false; c.aim[i] = null; tryCast(G, a, i, aim); }
  if (c.pot) {
    c.pot = false;
    if (a.potions <= 0) fail(G, a, '這場的藥水用過了');
    else if (a.hp >= a.maxHp) fail(G, a, '血是滿的');
    else { const real = Math.min(a.maxHp * POTION_HEAL, a.maxHp - a.hp); a.potions--; a.stats.pots++; a.hp += real; ev(G, { k: 'heal', i: a.idx, v: R(real), by: a.idx }); ring(G, a.x, a.y, 6, 30, 'heal', .4); }
  }
  a.atkT -= dt; const t = a.target;
  if (t && a.atkT <= 0 && a.rollT <= 0 && inRange(a, t)) {
    a.atkT = a.def.aspd; const dmg = a.def.atk * a.pow * rand(.9, 1.1);
    if (a.def.range < 60) { hurtEnemy(G, t, dmg, a); ring(G, t.x, t.y, 4, 14, a.def.color, .18); } else shoot(G, a, t, dmg);
  }
}
function updEnemy(G, e, dt) {
  if (e.vulnT > 0) e.vulnT -= dt;
  if (e.spawnT > 0) { e.spawnT -= dt; return; }
  if (G.mode === 'field' && !fieldMob(G, e, dt)) return;
  if (e.stun > 0) { e.stun -= dt; return; }
  if (e.cast) { e.cast.t += dt; if (e.cast.t >= e.cast.dur) { const k = e.cast; e.cast = null; if (k.done) k.done(); } return; }
  e.fixT -= dt; let tg = null;
  if (e.fixT > 0 && e.fix && e.fix.alive) tg = e.fix;
  else { let best = -1; for (const [p, v] of e.threat) if (p.alive && v > best) { best = v; tg = p; } if (!tg) tg = nearest(e, G.actors); }
  e.target = tg; if (!tg) return;
  const d = dist(e, tg) || 1, dx = (tg.x - e.x) / d, dy = (tg.y - e.y) / d; e.face = Math.atan2(dy, dx);
  if (e.def.caster) {
    const edge = d - e.r - tg.r;
    if (edge > e.def.range) { e.x += dx * e.def.speed * dt; e.y += dy * e.def.speed * dt; }
    e.tm.cast -= dt;
    if (e.tm.cast <= 0 && edge <= e.def.range + 20) {
      const v = pick(G.actors.filter(a => a.alive)); e.tm.cast = rand(4, 5.5);
      e.cast = { name: '鹽咒', t: 0, dur: 2.2, kickable: true, victim: v, done: () => { if (v.alive) { hurtActor(G, v, e.dmg, false); beam(G, e, v, 'hex'); } } };
    }
    return;
  }
  if (d > e.r + tg.r + e.def.range) { e.x += dx * e.def.speed * dt; e.y += dy * e.def.speed * dt; }
  else { e.atkT -= dt; if (e.atkT <= 0) { e.atkT = e.def.aspd / (e.tm.enraged ? 1.3 : 1); hurtActor(G, tg, e.dmg * (e.boss ? bossMul(G) : 1) * rand(.9, 1.1), false); ring(G, tg.x, tg.y, 4, 16, 'danger', .18); } }
  if (e.boss) bossBrain(G, e, dt, tg);
}
function bossBrain(G, b, dt, tg) {
  const tm = b.tm, sp = tm.enraged ? 1.3 : 1;
  tm.cleave -= dt * sp; tm.bells -= dt * sp; tm.roar -= dt * sp;
  if (!tm.adds && b.hp < b.maxHp * .5) { tm.adds = true; banner(G, '水鬼湧入！'); mkEnemy(G, 'grunt', 60, 70); mkEnemy(G, 'grunt', W - 60, 70); }
  if (!tm.enraged && b.hp < b.maxHp * .3) { tm.enraged = true; banner(G, '看守者狂怒！'); ring(G, b.x, b.y, b.r, 120, 'danger', .6); }
  if (tm.roar <= 0) {
    tm.roar = 16;
    b.cast = { name: '潮嘯', t: 0, dur: 2.8, kickable: true, done: () => { for (const a of G.actors) hurtActor(G, a, 250 * G.es * bossMul(G), false); ring(G, b.x, b.y, 20, 280, 'danger', .6); shake(G, .5); } };
    return;
  }
  if (tm.cleave <= 0) {
    tm.cleave = 7; const ang = Math.atan2(tg.y - b.y, tg.x - b.x);
    addZone(G, { type: 'cone', x: b.x, y: b.y, ang, half: .62, len: 125, dur: 1.4, dmg: 300 * G.es * bossMul(G) });
    b.cast = { name: '錨擊', t: 0, dur: 1.4, kickable: false }; return;
  }
  if (tm.bells <= 0) {
    tm.bells = 9; let pool = G.actors.filter(a => a.alive && a !== tg); if (!pool.length) pool = [tg];
    pool.sort(() => Math.random() - .5);
    for (const a of pool.slice(0, tm.enraged ? 3 : 2)) addZone(G, { type: 'circle', x: a.x, y: a.y, r: 44, dur: 1.7, dmg: 290 * G.es * bossMul(G) });
  }
}
function updWorld(G, dt) {
  const en = G.enemies;
  for (let i = 0; i < en.length; i++) for (let j = i + 1; j < en.length; j++) {
    const a = en[i], b = en[j], d = dist(a, b) || .01, ov = a.r + b.r - d; if (ov <= 0) continue;
    const ux = (a.x - b.x) / d, uy = (a.y - b.y) / d, wa = a.boss ? 0 : b.boss ? 1 : .5;
    a.x += ux * ov * wa; a.y += uy * ov * wa; b.x -= ux * ov * (1 - wa); b.y -= uy * ov * (1 - wa);
  }
  for (const e of en) { e.x = clamp(e.x, e.r, G.bw - e.r); e.y = clamp(e.y, e.r + (G.mode === 'field' ? 0 : 30), G.bh - e.r); if (G.mode === 'field') pushOut(e); }
  for (const s of G.shots) {
    const t = s.t; if (!t.alive) { s.dead = true; continue; }
    const d = dist(s, t) || 1, st = s.spd * dt; s.px = s.x; s.py = s.y;
    if (d <= st + t.r * .6) { hurtEnemy(G, t, s.dmg, s.src, s.big); if (s.big) ring(G, t.x, t.y, 6, 30, 'ember', .25); s.dead = true; }
    else { s.x += (t.x - s.x) / d * st; s.y += (t.y - s.y) / d * st; }
  }
  G.shots = G.shots.filter(s => !s.dead);
  for (const z of G.zones) {
    z.t += dt;
    if (z.friendly) { z.tick -= dt; if (z.tick <= 0) { z.tick = .5; if (z.heal) { for (const p of G.actors) if (p.alive && Math.hypot(p.x - z.x, p.y - z.y) <= z.r + p.r) healActor(G, p, z.dmg, z.src); } else for (const e of en) if (e.alive && Math.hypot(e.x - z.x, e.y - z.y) <= z.r + e.r) hurtEnemy(G, e, z.dmg, z.src, false, true); } }
    // people playing over a network see the zone a moment late, so they get a little slack
    else if (z.t >= z.dur && !z.done) { z.done = true; for (const a of G.actors) if (a.alive && inZone(z, a, a.human ? -G.grace : 0)) hurtActor(G, a, z.dmg, true); }
  }
  G.zones = G.zones.filter(z => z.t < z.dur + (z.friendly ? 0 : .25));
}
function finish(G, win) {
  if (G.state === 'over') return;
  G.state = 'over'; G.result = { win, onTime: win && G.t <= TIME_LIMIT, t: G.t };
  banner(G, win ? '莫葛沉回海底' : '全隊倒下', 1500);
}
/* ---------- field rules ---------- */
/* Returns true when the creature should fight this step; otherwise it has already wandered or walked home. */
function fieldMob(G, e, dt) {
  const home = e.home, dHome = Math.hypot(e.x - home.x, e.y - home.y);
  if (e.ret) {
    const d = dHome || 1, sp = e.def.speed * 1.6 * dt; e.x += (home.x - e.x) / d * Math.min(sp, d); e.y += (home.y - e.y) / d * Math.min(sp, d);
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * .5 * dt); if (dHome < 8) { e.ret = false; e.hp = e.maxHp; }
    return false;
  }
  if (!e.engaged) {
    const near = nearest(e, G.actors);
    if (near && !inCamp(near) && dist(e, near) < e.def.aggro + near.r) { e.engaged = true; e.threat.set(near, (e.threat.get(near) || 0) + 1); }
    else if (e.threat.size) e.engaged = true;          // somebody hit it from a distance
    else {
      e.wt -= dt; if (e.wt <= 0) { e.wt = rand(2, 5); const an = rand(0, TAU), rr = rand(0, 40); e.wx = home.x + Math.cos(an) * rr; e.wy = home.y + Math.sin(an) * rr; }
      const d = Math.hypot(e.wx - e.x, e.wy - e.y); if (d > 3) { e.x += (e.wx - e.x) / d * e.def.speed * .35 * dt; e.y += (e.wy - e.y) / d * e.def.speed * .35 * dt; e.face = Math.atan2(e.wy - e.y, e.wx - e.x); }
      return false;
    }
  }
  let foe = false; for (const p of e.threat.keys()) if (p.alive && !inCamp(p)) { foe = true; break; }
  if (dHome > e.def.leash || !foe) { e.engaged = false; e.ret = true; e.threat.clear(); e.cast = null; e.fix = null; e.target = null; return false; }   // dragged too far, or nobody left to fight
  return true;
}
function fieldActor(G, a, dt) {
  if (!a.alive) {
    a.gather = null; a.downT += dt;
    if (a.downT >= 3) { a.downT = 0; a.alive = true; a.hp = a.maxHp; a.x = FIELD.spawn[0]; a.y = FIELD.spawn[1]; a.target = null; banner(G, '你在營火邊醒來', 1800); }
    return;
  }
  const hunted = G.enemies.some(e => e.engaged && e.threat.has(a));
  a.calm = hunted ? 0 : a.calm + dt;
  if (a.calm > 3 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * .08 * dt);   // catch your breath between fights
  // gathering: stand still next to something worth picking up
  const still = Math.hypot(a.ctrl.mx, a.ctrl.my) < .05 && a.rollT <= 0; let node = null;
  if (still && !hunted) for (const n of G.nodes) if (n.ready && Math.hypot(n.x - a.x, n.y - a.y) < 38) { node = n; break; }
  if (!node) { a.gather = null; return; }
  if (!a.gather || a.gather.id !== node.id) a.gather = { id: node.id, t: 0 };
  a.gather.t += dt;
  if (a.gather.t >= GATHER_TIME) { node.ready = false; node.t = NODE_RESPAWN; a.gather = null; ev(G, { k: 'gathered', id: node.id, type: node.type, by: a.idx }); }
}
function stepField(G, dt) {
  G.t += dt;
  for (const a of G.actors) if (a.human) playerThink(G, a, dt);
  for (const a of G.actors) updActor(G, a, dt);
  for (const e of G.enemies) updEnemy(G, e, dt);
  updWorld(G, dt);
  G.enemies = G.enemies.filter(e => e.alive);
  G.respawns = G.respawns.filter(r => { if (G.t < r.at || G.actors.some(a => Math.hypot(a.x - r.home.x, a.y - r.home.y) < 170)) return true; spawnMob(G, r.pk, r.home); return false; });
  // creatures that are not in a fight follow your level, inside their pack's range
  for (const e of G.enemies) if (!e.engaged && !e.ret) { const want = mobLevel(FIELD.packs[e.pk], G.actors[0].lvl); if (e.lvl !== want) scaleMob(e, want); }
  for (const n of G.nodes) if (!n.ready) { n.t -= dt; if (n.t <= 0) n.ready = true; }
  for (const a of G.actors) fieldActor(G, a, dt);
}
/* What a gather or a kill gives. The server rolls this for online accounts. */
function fieldYield(what, key) {
  const m = {};
  if (what === 'gather') { if (key === 'herb') m.herb = 1 + (Math.random() < .35 ? 1 : 0); else if (key === 'wreck') m.scrap = 2 + Math.floor(Math.random() * 2); else if (key === 'salt') m.salt = 1; }
  else if (key === 'crab') { if (Math.random() < .6) m.scrap = 1; }
  else if (key === 'acolyte') { if (Math.random() < .5) m.salt = 1; }
  return m;
}
function grant(p, mats) { fixProfile(p); for (const k of Object.keys(mats)) if (k in MATS) p.inv[k] = Math.min(MAT_CAP, p.inv[k] + mats[k]); }
/* Everything one gather or one kill gives this profile: materials and experience. For a kill, pk says which pack the
 * creature belonged to; null when the claim does not name a real pack of that creature. */
function fieldGain(p, what, key, pk) {
  fixProfile(p); let xp = 5;
  if (what === 'kill') { const def = Number.isInteger(pk) ? FIELD.packs[pk] : null; if (!def || def.kind !== key) return null; xp = xpForKill(key, mobLevel(def, p.cl), p.cl); }
  const mats = fieldYield(what, key); grant(p, mats); const x = addXp(p, xp);
  return { mats, xp: x.xp, ups: x.ups };
}

function step(G, dt) {
  if (G.mode === 'field') return stepField(G, dt);
  if (G.state === 'countdown') { G.cd -= dt; if (G.cd <= 0) { G.cd = 0; G.state = 'run'; nextWave(G); } return; }
  if (G.state !== 'run') return;
  G.t += dt;
  for (const a of G.actors) { if (a.human && !G.auto) playerThink(G, a, dt); else botThink(G, a, dt); }
  for (const a of G.actors) updActor(G, a, dt);
  for (const e of G.enemies) updEnemy(G, e, dt);
  updWorld(G, dt);
  G.enemies = G.enemies.filter(e => e.alive);
  if (G.actors.every(a => !a.alive)) return finish(G, false);
  if (!G.enemies.length) {
    if (G.wave >= WAVES.length - 1) return finish(G, true);
    if (G.gap == null) { G.gap = 1.8; for (const a of G.actors) if (!a.alive) revive(G, a); }
    G.gap -= dt; if (G.gap <= 0) { G.gap = null; nextWave(G); }
  }
}

/* ---------- progression: the same rules on the server and in the offline client ---------- */
const LOOT = { w: ['武器', ['鏽潮錨刃', '沉鐘之舌', '霧燈長弓']], a: ['護甲', ['看守者鍊甲', '鹽殼護肩', '潮紋斗篷']], t: ['飾品', ['霧燈碎片', '潮鳴鐘錘', '生鏽的羅盤']] };
const MATS = { scrap: '鏽鐵屑', salt: '鹽晶', shard: '沉鐘碎片', herb: '潮草' };
const POTION_CAP = 5, POTION_HEAL = .35, MAT_CAP = 9999;
const ilvlOf = gear => Math.round((gear.w + gear.a + gear.t) / 3);
const powerOf = gear => 1 + (ilvlOf(gear) - 10) * .02;
const forgeIlvl = lvl => 10 + lvl * 4 + 3;      // what the forge makes at this tower level: a good drop, never the best
const gearCap = lvl => 10 + lvl * 4 + 7;        // how far tempering can push a slot at this tower level
const charPower = p => powerOf(p.gear) * lvF(p.cl);     // what a character brings to a fight: gear and level
function newProfile() { return { lvl: 1, cl: 1, xp: 0, gear: { w: 10, a: 10, t: 10 }, best: {}, runs: 0, inv: { scrap: 0, salt: 0, shard: 0, herb: 0, potion: 0 }, q: null, loadout: {} }; }
function fixProfile(p) {   // fill in anything an older save does not have
  const d = newProfile();
  for (const k of Object.keys(d)) if (p[k] == null) p[k] = d[k];
  for (const k of Object.keys(d.inv)) if (!(p.inv[k] >= 0)) p.inv[k] = 0;
  p.cl = Number.isInteger(p.cl) ? clamp(p.cl, 1, MAX_LEVEL) : 1; p.xp = p.xp >= 0 && p.cl < MAX_LEVEL ? Math.min(Math.floor(p.xp), xpNeed(p.cl)) : 0;
  fixQuests(p);
  const lo = {}, old = p.loadout && typeof p.loadout === 'object' ? p.loadout : {};      // keep only loadouts that are still allowed
  for (const k of Object.keys(CLASSES)) if (validLoadout(k, old[k], p.cl)) lo[k] = old[k].slice();
  p.loadout = lo;
  return p;
}
function addXp(p, n) {
  n = Math.max(0, Math.round(n)); let ups = 0; if (p.cl >= MAX_LEVEL || !n) return { xp: 0, ups: 0 };
  p.xp += n; while (p.cl < MAX_LEVEL && p.xp >= xpNeed(p.cl)) { p.xp -= xpNeed(p.cl); p.cl++; ups++; }
  if (p.cl >= MAX_LEVEL) p.xp = 0; return { xp: n, ups };
}
/* r: { win, onTime, t }. Updates the profile p and returns { loot, mats, xp, ups }: the item that dropped (null for a wipe)
 * and the crafting materials picked up. */
function applyResult(p, lvl, r) {
  fixProfile(p);
  const mats = r.win
    ? { scrap: 3 + Math.floor(Math.random() * 3) + Math.floor(lvl / 3), salt: 1 + (Math.random() < .5 ? 1 : 0), shard: r.onTime ? 1 : (Math.random() < .3 ? 1 : 0) }
    : { scrap: 1 + Math.floor(Math.random() * 2), salt: 0, shard: 0 };
  for (const k of Object.keys(mats)) p.inv[k] = Math.min(MAT_CAP, p.inv[k] + mats[k]);
  const x = addXp(p, r.win ? (100 + 50 * lvl) * (r.onTime ? 1.25 : 1) : 25);
  if (!r.win) return { loot: null, mats, xp: x.xp, ups: x.ups };
  p.runs++;
  const ks = ['w', 'a', 't']; let k = pick(ks);
  if (Math.random() < .5) k = ks.reduce((m, x) => p.gear[x] < p.gear[m] ? x : m, 'w');
  const il = 10 + lvl * 4 + Math.floor(Math.random() * 4) + (r.onTime ? 2 : 0), old = p.gear[k], up = il > old;
  if (up) p.gear[k] = il;
  if (!p.best[lvl] || r.t < p.best[lvl]) p.best[lvl] = Math.round(r.t * 10) / 10;
  if (r.onTime) p.lvl = Math.max(p.lvl, Math.min(50, lvl + 1));
  return { loot: { slot: LOOT[k][0], name: pick(LOOT[k][1]), il, old, up }, mats, xp: x.xp, ups: x.ups };
}

/* ---------- skill loadouts ---------- */
function loadoutOf(p, cls) { const ids = p.loadout && p.loadout[cls]; return validLoadout(cls, ids, p.cl || 1) ? ids.slice() : defaultLoadout(cls); }
function setLoadout(p, cls, ids) {
  fixProfile(p); if (!Object.prototype.hasOwnProperty.call(CLASSES, cls)) return { ok: false, msg: '沒有這個職業。' };
  if (!validLoadout(cls, ids, p.cl)) return { ok: false, msg: '這組技能不能用：要三個不重複的一般技能加一個大招，而且都已經解鎖。' };
  p.loadout[cls] = ids.slice(); return { ok: true, msg: '技能換好了。' };
}

/* ---------- crafting ---------- */
const RECIPES = [];
for (const k of ['w', 'a', 't']) RECIPES.push({ id: 'forge-' + k, kind: 'forge', slot: k, name: '鍛造' + LOOT[k][0], cost: { scrap: 12, salt: 3 } });
for (const k of ['w', 'a', 't']) RECIPES.push({ id: 'temper-' + k, kind: 'temper', slot: k, name: '淬鍊' + LOOT[k][0], cost: { shard: 2, scrap: 6 } });
RECIPES.push({ id: 'potion', kind: 'potion', name: '潮息藥水', cost: { herb: 2, salt: 1 } });   // the herb only grows in the field
/* What a recipe would do for this profile right now: { can, why, result }. */
function recipeInfo(p, rc) {
  fixProfile(p);
  let result = '', why = '';
  if (rc.kind === 'forge') { const il = forgeIlvl(p.lvl); result = `做出裝等 ${il} 的${LOOT[rc.slot][0]}`; if (p.gear[rc.slot] >= il) why = `身上的 ${p.gear[rc.slot]} 已經不比它差`; }
  else if (rc.kind === 'temper') { const cur = p.gear[rc.slot], cap = gearCap(p.lvl); result = `${LOOT[rc.slot][0]}裝等 ${cur} → ${Math.min(cap, cur + 2)}`; if (cur >= cap) why = `已到第 ${p.lvl} 層的上限 ${cap}`; }
  else { result = `副本中回復 ${POTION_HEAL * 100}% 血量，每場限用 1 瓶`; if (p.inv.potion >= POTION_CAP) why = `最多帶 ${POTION_CAP} 瓶`; }
  if (!why && Object.keys(rc.cost).some(k => p.inv[k] < rc.cost[k])) why = '材料不夠';
  return { can: !why, why, result };
}
function craft(p, id) {
  const rc = RECIPES.find(r => r.id === id); if (!rc) return { ok: false, msg: '沒有這個配方。' };
  const info = recipeInfo(p, rc); if (!info.can) return { ok: false, msg: `做不了${rc.name}：${info.why}。` };
  for (const k of Object.keys(rc.cost)) p.inv[k] -= rc.cost[k];
  if (rc.kind === 'forge') p.gear[rc.slot] = forgeIlvl(p.lvl);
  else if (rc.kind === 'temper') p.gear[rc.slot] = Math.min(gearCap(p.lvl), p.gear[rc.slot] + 2);
  else p.inv.potion++;
  return { ok: true, kind: rc.kind, msg: rc.kind === 'potion' ? `做好一瓶潮息藥水，現在有 ${p.inv.potion} 瓶。` : `${LOOT[rc.slot][0]}現在是裝等 ${p.gear[rc.slot]}。` };
}

/* ---------- quests ----------
 * Three groups. Main quests come one at a time, in order. Weekly quests reset every Monday (Taipei time).
 * Side quests can be done once, in any order. Progress only moves through questEvent(), which the server
 * calls for online accounts; rewards are handed out by questClaim(). */
const isRun = ev => ev.type === 'run';
const CLS_BIT = { tank: 1, heal: 2, dps: 4 };
const bits = n => (n & 1) + (n >> 1 & 1) + (n >> 2 & 1);
const MAIN = [
  { id: 'bell', title: '第一聲鐘響', goal: '通關沉鐘塔一次', need: 1, reward: { xp: 120, scrap: 6, salt: 2 }, inc: ev => isRun(ev) && ev.win ? 1 : 0 },
  { id: 'kick', title: '斷其咒語', goal: '成功打斷敵人的金色讀條 3 次', need: 3, reward: { xp: 120, salt: 3 }, inc: ev => isRun(ev) ? ev.kicks : 0 },
  { id: 'craft', title: '工坊開張', goal: '在背包裡製作任何一樣東西', need: 1, reward: { xp: 150, scrap: 8, salt: 2 }, inc: ev => ev.type === 'craft' ? 1 : 0 },
  { id: 'ontime', title: '搶在潮水之前', goal: '三分鐘內通關一次', need: 1, reward: { xp: 200, potion: 1 }, inc: ev => isRun(ev) && ev.onTime ? 1 : 0 },
  { id: 'clean', title: '乾淨的腳步', goal: '通關一場，而且整場沒有踩到紅圈', need: 1, reward: { xp: 250, shard: 1, scrap: 6 }, inc: ev => isRun(ev) && ev.win && ev.hits === 0 ? 1 : 0 },
  { id: 'lvl3', title: '更深一層', goal: '抵達第 3 層', need: 3, reward: { xp: 300, salt: 4, scrap: 8 }, value: p => p.lvl },
  { id: 'temper', title: '淬火', goal: '淬鍊任何一個部位一次', need: 1, reward: { xp: 300, shard: 2 }, inc: ev => ev.type === 'craft' && ev.kind === 'temper' ? 1 : 0 },
  { id: 'lvl5', title: '鐘塔中段', goal: '抵達第 5 層', need: 5, reward: { xp: 500, shard: 2, potion: 1, scrap: 12 }, value: p => p.lvl }
];
const WEEK = [
  { id: 'w-runs', title: '本週巡塔', goal: '這週通關 5 場', need: 5, reward: { xp: 300, scrap: 15, salt: 4 }, inc: ev => isRun(ev) && ev.win ? 1 : 0 },
  { id: 'w-kicks', title: '本週斷法', goal: '這週成功打斷 10 次', need: 10, reward: { xp: 250, salt: 5 }, inc: ev => isRun(ev) ? ev.kicks : 0 },
  { id: 'w-ontime', title: '本週準時', goal: '這週三分鐘內通關 3 場', need: 3, reward: { xp: 350, shard: 2 }, inc: ev => isRun(ev) && ev.onTime ? 1 : 0 }
];
const SIDE = [
  { id: 's-party', title: '結伴', goal: '和至少一位其他玩家一起通關', need: 1, online: true, reward: { xp: 200, scrap: 10, potion: 1 }, upd: (v, ev) => isRun(ev) && ev.win && ev.mates > 0 ? 1 : v },
  { id: 's-level', title: '站穩腳步', goal: '升到 5 級', need: 5, reward: { shard: 2, potion: 1 }, upd: (v, ev, p) => p.cl, have: v => v },
  { id: 's-gather', title: '拾荒', goal: '在鏽灘採集 6 次', need: 6, reward: { xp: 150, scrap: 6, herb: 2 }, upd: (v, ev) => ev.type === 'gather' ? Math.min(6, v + 1) : v },
  { id: 's-hunt', title: '清灘', goal: '在鏽灘擊倒 12 隻怪物', need: 12, reward: { xp: 200, salt: 4, scrap: 6 }, upd: (v, ev) => ev.type === 'kill' ? Math.min(12, v + 1) : v },
  { id: 's-friend', title: '留個名字', goal: '和一位玩家互相加為好友', need: 1, online: true, reward: { xp: 100, salt: 3 }, upd: (v, ev) => ev.type === 'friend' ? 1 : v }
];
const weekOf = now => Math.floor((Math.floor((now + 8 * 3600000) / 86400000) + 3) / 7);
const qInt = (v, a, b) => Number.isInteger(v) ? Math.min(b, Math.max(a, v)) : a;
/* Make p.q well-formed whatever it held before; with a time, also start a fresh week when one has begun. */
function fixQuests(p, now) {
  let q = p.q; if (!q || typeof q !== 'object') q = p.q = {};
  q.main = qInt(q.main, 0, MAIN.length); q.mp = qInt(q.mp, 0, 999);
  const side = {}, os = q.side && typeof q.side === 'object' ? q.side : {};
  for (const d of SIDE) { const v = os[d.id]; if (Number.isInteger(v) && v >= -1 && v <= 99) side[d.id] = v; }
  const ow = q.week && typeof q.week === 'object' ? q.week : {}, wk = { n: qInt(ow.n, 0, 1e6), p: {}, c: {} };
  for (const d of WEEK) { const v = ow.p && ow.p[d.id]; if (Number.isInteger(v) && v > 0) wk.p[d.id] = Math.min(d.need, v); if (ow.c && ow.c[d.id]) wk.c[d.id] = 1; }
  if (now != null && wk.n !== weekOf(now)) { wk.n = weekOf(now); wk.p = {}; wk.c = {}; }
  q.side = side; q.week = wk; return q;
}
const rewardText = r => Object.keys(r).map(k => `${k === 'xp' ? '經驗' : k === 'potion' ? '潮息藥水' : MATS[k]} +${r[k]}`).join('、');
/* Everything the quest screen needs. online = false hides quests that need other players. */
function questList(p, now, online) {
  const q = fixQuests(p, now), items = [], m = MAIN[q.main];
  if (m) { const have = Math.min(m.need, m.value ? m.value(p) : q.mp); items.push({ id: m.id, group: 'main', title: m.title, goal: m.goal, have, need: m.need, ready: have >= m.need, claimed: false, reward: rewardText(m.reward) }); }
  for (const d of WEEK) { const have = q.week.p[d.id] || 0, claimed = !!q.week.c[d.id]; items.push({ id: d.id, group: 'week', title: d.title, goal: d.goal, have: claimed ? d.need : have, need: d.need, ready: !claimed && have >= d.need, claimed, reward: rewardText(d.reward) }); }
  for (const d of SIDE) {
    if (d.online && !online) continue;
    const v = d.id === 's-level' && q.side[d.id] !== -1 ? p.cl : q.side[d.id] || 0, claimed = v === -1, have = claimed ? d.need : Math.min(d.need, d.have ? d.have(v) : v);
    items.push({ id: d.id, group: 'side', title: d.title, goal: d.goal, have, need: d.need, ready: !claimed && have >= d.need, claimed, reward: rewardText(d.reward) });
  }
  return { items, mainDone: q.main, mainTotal: MAIN.length };
}
/* ev: { type: 'run', win, onTime, cls, kicks, hits, mates } | { type: 'craft', kind } | { type: 'friend' } | { type: 'gather' } | { type: 'kill' } */
function questEvent(p, ev, now) {
  const q = fixQuests(p, now), m = MAIN[q.main];
  if (isRun(ev)) { ev.kicks = qInt(ev.kicks, 0, 50); ev.hits = qInt(ev.hits, 0, 999); }
  if (m && m.inc) q.mp = Math.min(m.need, q.mp + (m.inc(ev) || 0));
  for (const d of WEEK) if (!q.week.c[d.id]) { const v = Math.min(d.need, (q.week.p[d.id] || 0) + (d.inc(ev) || 0)); if (v > 0) q.week.p[d.id] = v; }
  for (const d of SIDE) if (q.side[d.id] !== -1) { const v = d.upd(q.side[d.id] || 0, ev, p); if (v > 0) q.side[d.id] = v; }
}
function questClaim(p, id, now) {
  const q = fixQuests(p, now), it = questList(p, now, true).items.find(x => x.id === id);
  if (!it) return { ok: false, msg: '沒有這個任務。' };
  if (it.claimed) return { ok: false, msg: '這個任務的獎勵已經領過了。' };
  if (!it.ready) return { ok: false, msg: `「${it.title}」還沒完成。` };
  const d = MAIN.concat(WEEK, SIDE).find(x => x.id === id);
  for (const k of Object.keys(d.reward)) { if (k === 'xp') addXp(p, d.reward.xp); else p.inv[k] = Math.min(k === 'potion' ? POTION_CAP : MAT_CAP, p.inv[k] + d.reward[k]); }
  if (it.group === 'main') { q.main++; q.mp = 0; } else if (it.group === 'week') q.week.c[id] = 1; else q.side[id] = -1;
  return { ok: true, msg: `「${it.title}」完成，領到 ${it.reward}。` };
}

/* ---------- network snapshot: compact arrays, read back by the client ---------- */
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
function snapshot(G) {
  return {
    tm: r2(G.t), st: G.state, cd: r2(G.cd), w: G.wave,
    a: G.actors.map(a => [r1(a.x), r1(a.y), R(a.hp), a.maxHp, a.alive ? 1 : 0, r2(a.face),
      (a.wallT > 0 ? 1 : 0) | (a.shield > 0 ? 2 : 0) | (a.iframe > 0 ? 4 : 0) | (a.rollT > 0 ? 8 : 0) | (a.human ? 16 : 0),
      a.target ? a.target.id : 0, a.cds.map(r1), R(a.ult), a.potions]),
    e: G.enemies.map(e => [e.id, e.kind, r1(e.x), r1(e.y), R(e.hp), e.maxHp, r2(e.face), r2(Math.max(0, e.spawnT)), e.stun > 0 ? 1 : 0, e.tm.enraged ? 1 : 0,
      e.cast ? [e.cast.name, r2(e.cast.t), e.cast.dur, e.cast.kickable ? 1 : 0, e.cast.victim ? e.cast.victim.idx : -1] : 0]),
    z: G.zones.map(z => [z.id, z.friendly ? (z.heal ? 2 : 1) : 0, z.type === 'circle' ? 0 : 1, r1(z.x), r1(z.y), z.r || 0, r2(z.ang || 0), z.half || 0, z.len || 0, r2(z.t), z.dur, z.done ? 1 : 0]),
    s: G.shots.map(s => [s.id, r1(s.x), r1(s.y), s.big ? 1 : 0, s.src.idx])
  };
}

return { W, H, TIME_LIMIT, CLASSES, SKILLS, ENEMY, WAVES, ROSTER, SPOTS, createRun, step, snapshot,
  cleanAim, defaultLoadout, validLoadout, loadoutOf, setLoadout,
  FIELD, GATHER_TIME, NODE_RESPAWN, createField, fieldYield, grant, fieldGain,
  MAX_LEVEL, lvF, xpNeed, recLevel, mobLevel, xpForKill, addXp, setLevel, charPower,
  MATS, RECIPES, POTION_CAP, ilvlOf, powerOf, gearCap, newProfile, fixProfile, applyResult, recipeInfo, craft,
  weekOf, fixQuests, questList, questEvent, questClaim, MAIN_IDS: MAIN.map(m => m.id) };
});
