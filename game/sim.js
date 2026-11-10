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

/* color values are token names; the client maps them to its palette */
const CLASSES = {
  tank: { name: '盾衛', role: '坦克', mark: '盾', color: 'tank', hp: 1500, atk: 30, aspd: 0.9, range: 14, speed: 92, threat: 8, ultK: 14,
    skills: [
      { id: 'taunt', seal: '嘲', name: '嘲諷擊', cd: 6, desc: '重擊目標，並強迫它攻擊你 4 秒' },
      { id: 'wall', seal: '牆', name: '盾牆', cd: 14, desc: '4 秒內受到的傷害降低 60%' },
      { id: 'kick', seal: '斷', name: '盾擊', cd: 10, desc: '打斷身邊敵人的金色讀條' },
      { id: 'tankUlt', seal: '鐵', name: '鐵潮', ult: true, desc: '全場敵人轉向你，全隊獲得護盾' } ] },
  heal: { name: '潮語者', role: '治療', mark: '潮', color: 'heal', hp: 900, atk: 16, aspd: 1.0, range: 180, speed: 98, threat: 1, ultK: 8,
    skills: [
      { id: 'mend', seal: '泉', name: '湧泉', cd: 2.2, desc: '治療血量最低的隊友，點隊友血條可以指定' },
      { id: 'ring', seal: '環', name: '潮環', cd: 9, desc: '治療你身邊的所有隊友' },
      { id: 'kick', seal: '斷', name: '鹽封', cd: 12, desc: '打斷敵人的金色讀條' },
      { id: 'healUlt', seal: '漲', name: '漲潮', ult: true, desc: '全隊回復一半血量，並救起倒地的隊友' } ] },
  dps: { name: '燼矢', role: '輸出', mark: '矢', color: 'ember', hp: 950, atk: 44, aspd: 0.7, range: 190, speed: 104, threat: 1, ultK: 36,
    skills: [
      { id: 'blast', seal: '爆', name: '爆燃箭', cd: 4, desc: '對目標造成大量傷害' },
      { id: 'roll', seal: '滾', name: '翻滾', cd: 6, desc: '朝移動方向翻滾，翻滾中不會受傷' },
      { id: 'kick', seal: '斷', name: '斷法箭', cd: 10, desc: '打斷敵人的金色讀條' },
      { id: 'dpsUlt', seal: '雨', name: '燼雨', ult: true, desc: '在目標腳下降下 4 秒火雨' } ] }
};
const ENEMY = {
  grunt: { name: '鏽蝕水鬼', hp: 1000, dmg: 34, aspd: 1.3, range: 8, speed: 70, r: 13 },
  caster: { name: '鹽咒祭司', hp: 800, dmg: 150, aspd: 0, range: 165, speed: 60, r: 12 },
  boss: { name: '鏽潮看守者 莫葛', hp: 27000, dmg: 80, aspd: 1.5, range: 10, speed: 58, r: 28 }
};
const WAVES = [ [['grunt', 3]], [['grunt', 2], ['caster', 1]], [['grunt', 2], ['caster', 2]], [['boss', 1]] ];
const ROSTER = ['tank', 'heal', 'dps', 'dps'];
const SPOTS = [[180, H - 150], [128, H - 84], [236, H - 96], [184, H - 58]];
const BOT_NAMES = { tank: '柯爾', heal: '蜜拉', dps: ['阿燼', '小霧'] };

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
    target: null, atkT: rand(0, .5), cds: [0, 0, 0, 0], ult: 0, wallT: 0, shield: 0, iframe: 0, rollT: 0, rvx: 0, rvy: 0, face: -Math.PI / 2, idleT: 0,
    ctrl: { mx: 0, my: 0, cast: [false, false, false, false], healOn: null },
    input: { mx: 0, my: 0, cast: [false, false, false, false], heal: -1, tg: 0 },
    stats: { dmg: 0, heal: 0, kicks: 0, hits: 0 },
    ai: { react: 0, delay: rand(.3, .75), kick: new WeakMap(), wob: rand(0, TAU), gcd: rand(0, .4) } };
}
/* opts: { lvl, players: [{ cls, name, pow, id }], grace, auto }
 * Each player takes the first free seat of their class; every other seat is a bot. */
function createRun(opts) {
  const lvl = opts.lvl || 1, botPow = 1 + .1 * (lvl - 1);
  const G = { t: 0, lvl, es: Math.pow(1.13, lvl - 1), state: 'countdown', cd: 3, wave: -1, gap: null, actors: [], enemies: [], zones: [], shots: [], events: [],
    boss: null, result: null, nextId: 1, grace: opts.grace || 0, auto: !!opts.auto };
  const pending = (opts.players || []).slice(); let dpsN = 0;
  ROSTER.forEach((c, i) => {
    const k = pending.findIndex(p => p.cls === c), p = k >= 0 ? pending.splice(k, 1)[0] : null;
    const a = mkActor(c, p ? p.name : (c === 'dps' ? BOT_NAMES.dps[dpsN++] : BOT_NAMES[c]), SPOTS[i], p ? p.pow : botPow);
    a.idx = i; a.human = !!p; a.pid = p ? p.id : null; G.actors.push(a);
  });
  return G;
}
function mkEnemy(G, kind, x, y) {
  const d = ENEMY[kind], s = G.es;
  const e = { id: G.nextId++, kind, def: d, name: d.name, x, y, r: d.r, maxHp: R(d.hp * s), hp: R(d.hp * s), dmg: d.dmg * s, atkT: rand(.4, 1), threat: new Map(),
    fix: null, fixT: 0, target: null, cast: null, stun: 0, boss: kind === 'boss', tm: {}, alive: true, spawnT: .6, face: Math.PI / 2 };
  if (kind === 'caster') e.tm.cast = rand(1.5, 3.5);
  if (e.boss) { e.tm = { cleave: 5, bells: 8, roar: 12, adds: false, enraged: false }; G.boss = e; }
  const tank = G.actors.find(a => a.cls === 'tank'); if (tank) e.threat.set(tank, 40);
  G.enemies.push(e); return e;
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
  if (!e.alive) return;
  e.hp -= dmg; src.stats.dmg += dmg;
  e.threat.set(src, (e.threat.get(src) || 0) + dmg * src.def.threat);
  if (!noUlt) src.ult = Math.min(100, src.ult + dmg / (src.pow * src.def.ultK));
  ev(G, { k: 'dmg', x: R(e.x), y: R(e.y - e.r - 6), v: R(dmg), big: big ? 1 : 0, by: src.idx });
  if (e.hp <= 0) {
    e.hp = 0; e.alive = false; ring(G, e.x, e.y, e.r * .5, e.r * 2.2, e.boss ? 'brass' : 'rust', .45);
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

/* ---------- skills ---------- */
const SK = {
  taunt(G, a) { const t = a.target; if (!t || !inRange(a, t, 10)) return fail(G, a, '離目標太遠'); hurtEnemy(G, t, a.def.atk * a.pow * 2.4, a, true); t.fix = a; t.fixT = 4; ring(G, t.x, t.y, 8, 36, 'tank'); },
  wall(G, a) { a.wallT = 4; ring(G, a.x, a.y, 8, 32, 'tank'); },
  kick(G, a) {
    const reach = a.def.range < 60 ? 72 : 240; let best = null;
    for (const e of G.enemies) { if (!e.alive || !e.cast || !e.cast.kickable || dist(a, e) > reach + e.r) continue; if (!best || e === a.target || (best !== a.target && e.cast.t / e.cast.dur > best.cast.t / best.cast.dur)) best = e; }
    if (!best) return fail(G, a, '沒有金色讀條可以打斷');
    best.cast = null; best.stun = 1.2; if (best.kind === 'caster') best.tm.cast = rand(4, 5);
    hurtEnemy(G, best, a.def.atk * a.pow, a); beam(G, a, best, 'brass'); ring(G, best.x, best.y, best.r, best.r + 22, 'brass');
    text(G, best.x, best.y - best.r - 24, '打斷', 'brass', 16, 1.1); a.stats.kicks++;
  },
  tankUlt(G, a) { for (const e of G.enemies) { e.fix = a; e.fixT = 5; } for (const p of G.actors) if (p.alive) p.shield = Math.max(p.shield, 260 * a.pow); ring(G, a.x, a.y, 10, 170, 'tank', .55); },
  mend(G, a, on) {
    let t = on && on.alive ? on : null;
    if (!t) { let br = 1; for (const p of G.actors) { if (!p.alive) continue; const r = p.hp / p.maxHp; if (r < br) { br = r; t = p; } } }
    if (!t) return fail(G, a, '隊友都是滿血');
    healActor(G, t, 280 * a.pow, a); if (t !== a) beam(G, a, t, 'heal'); ring(G, t.x, t.y, 6, 22, 'heal');
  },
  ring(G, a) { for (const p of G.actors) if (p.alive && dist(a, p) <= 120) healActor(G, p, 170 * a.pow, a); ring(G, a.x, a.y, 10, 120, 'heal', .45); },
  healUlt(G, a) { for (const p of G.actors) { if (!p.alive) revive(G, p); else healActor(G, p, p.maxHp * .5, a); } ring(G, a.x, a.y, 10, 240, 'heal', .7); },
  blast(G, a) { const t = a.target; if (!t || !inRange(a, t, 20)) return fail(G, a, '離目標太遠'); shoot(G, a, t, a.def.atk * a.pow * 3.6, true); },
  roll(G, a) {
    let mx = a.ctrl.mx, my = a.ctrl.my, m = Math.hypot(mx, my);
    if (m < .2) { mx = -Math.cos(a.face); my = -Math.sin(a.face); m = 1; }
    a.rvx = mx / m * 400; a.rvy = my / m * 400; a.rollT = .26; a.iframe = .42;
  },
  dpsUlt(G, a) { const t = a.target; if (!t) return fail(G, a, '沒有目標'); G.zones.push({ id: G.nextId++, friendly: true, type: 'circle', x: t.x, y: t.y, r: 72, t: 0, dur: 4, tick: 0, dmg: a.def.atk * a.pow * 1.6, src: a, ign: new Set() }); }
};
function tryCast(G, a, i, on) {
  const sk = a.def.skills[i]; if (!a.alive) return false;
  if (sk.ult) { if (a.ult < 100) return false; } else if (a.cds[i] > 0) return false;
  if (SK[sk.id](G, a, on) === false) return false;
  if (sk.ult) a.ult = 0; else a.cds[i] = sk.cd;
  return true;
}

/* ---------- controllers: people and bots both fill the same ctrl object ---------- */
function playerThink(G, a, dt) {
  const c = a.ctrl, inp = a.input;
  c.mx = clamp(+inp.mx || 0, -1, 1); c.my = clamp(+inp.my || 0, -1, 1);
  for (let i = 0; i < 4; i++) if (inp.cast[i]) { c.cast[i] = true; inp.cast[i] = false; }
  if (inp.heal >= 0) { c.healOn = G.actors[inp.heal] || null; inp.heal = -1; }
  if (inp.tg) { const e = G.enemies.find(e => e.id === inp.tg && e.alive); if (e) a.target = e; inp.tg = 0; }
  if (!a.alive) return;
  if (!a.target || !a.target.alive) a.target = nearest(a, G.enemies);
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
  if (dv) { a.ai.react += dt; if (a.ai.react >= a.ai.delay) { c.mx = dv.x; c.my = dv.y; moved = true; if (a.cls === 'dps' && a.cds[1] <= 0 && Math.random() < dt * 2) c.cast[1] = true; } }
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
function botSkills(G, a, dt) {
  const c = a.ctrl.cast, ai = a.ai;
  for (const e of G.enemies) {   // each bot only tries some interrupts, and late, so a quick player matters
    const k = e.cast; if (!k || !k.kickable) continue;
    let plan = ai.kick.get(k); if (plan === undefined) { plan = Math.random() < .34 ? rand(.45, .85) * k.dur : -1; ai.kick.set(k, plan); }
    if (plan >= 0 && k.t >= plan && a.cds[2] <= 0) c[2] = true;
  }
  ai.gcd -= dt; if (ai.gcd > 0) return; ai.gcd = .4;
  const t = a.target, live = G.actors.filter(p => p.alive), ratio = p => p.hp / p.maxHp;
  if (a.cls === 'tank') {
    const loose = G.enemies.filter(e => e.alive && e.target && e.target !== a).length;
    if (a.ult >= 100 && (loose >= 2 || live.reduce((s, p) => s + ratio(p), 0) / live.length < .55)) c[3] = true;
    if (t && a.cds[0] <= 0 && inRange(a, t, 10) && (t.target !== a || t.boss)) c[0] = true;
    if (a.cds[1] <= 0 && ratio(a) < .5) c[1] = true;
  } else if (a.cls === 'heal') {
    const low = live.filter(p => ratio(p) < .35).length, down = G.actors.length - live.length;
    if (a.ult >= 100 && (down > 0 || low >= 2)) { c[3] = true; return; }
    if (a.cds[1] <= 0 && live.filter(p => ratio(p) < .7 && dist(a, p) <= 120).length >= 2) { c[1] = true; return; }
    if (a.cds[0] <= 0 && live.some(p => ratio(p) < .8)) c[0] = true;
  } else {
    if (t && a.cds[0] <= 0 && inRange(a, t, 20)) c[0] = true;
    if (t && a.ult >= 100 && ((G.boss && G.boss.alive) || G.enemies.length >= 3)) c[3] = true;
  }
}

/* ---------- simulation ---------- */
function updActor(G, a, dt) {
  for (let i = 0; i < 4; i++) if (a.cds[i] > 0) a.cds[i] = Math.max(0, a.cds[i] - dt);
  a.wallT = Math.max(0, a.wallT - dt); a.iframe = Math.max(0, a.iframe - dt);
  const c = a.ctrl;
  if (!a.alive) { c.cast.fill(false); c.healOn = null; return; }
  if (a.target && !a.target.alive) a.target = null;
  if (a.rollT > 0) { a.rollT -= dt; a.x += a.rvx * dt; a.y += a.rvy * dt; }
  else {
    let mx = c.mx, my = c.my; const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    if (m > .05) { a.x += mx * a.def.speed * dt; a.y += my * a.def.speed * dt; if (!a.target) a.face = Math.atan2(my, mx); }
  }
  a.x = clamp(a.x, a.r + 6, W - a.r - 6); a.y = clamp(a.y, a.r + 36, H - a.r - 8);
  if (a.target) a.face = Math.atan2(a.target.y - a.y, a.target.x - a.x);
  if (c.healOn) { if (a.cls === 'heal') tryCast(G, a, 0, c.healOn); c.healOn = null; }
  for (let i = 0; i < 4; i++) if (c.cast[i]) { c.cast[i] = false; tryCast(G, a, i); }
  a.atkT -= dt; const t = a.target;
  if (t && a.atkT <= 0 && a.rollT <= 0 && inRange(a, t)) {
    a.atkT = a.def.aspd; const dmg = a.def.atk * a.pow * rand(.9, 1.1);
    if (a.def.range < 60) { hurtEnemy(G, t, dmg, a); ring(G, t.x, t.y, 4, 14, a.def.color, .18); } else shoot(G, a, t, dmg);
  }
}
function updEnemy(G, e, dt) {
  if (e.spawnT > 0) { e.spawnT -= dt; return; }
  if (e.stun > 0) { e.stun -= dt; return; }
  if (e.cast) { e.cast.t += dt; if (e.cast.t >= e.cast.dur) { const k = e.cast; e.cast = null; if (k.done) k.done(); } return; }
  e.fixT -= dt; let tg = null;
  if (e.fixT > 0 && e.fix && e.fix.alive) tg = e.fix;
  else { let best = -1; for (const [p, v] of e.threat) if (p.alive && v > best) { best = v; tg = p; } if (!tg) tg = nearest(e, G.actors); }
  e.target = tg; if (!tg) return;
  const d = dist(e, tg) || 1, dx = (tg.x - e.x) / d, dy = (tg.y - e.y) / d; e.face = Math.atan2(dy, dx);
  if (e.kind === 'caster') {
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
  for (const e of en) { e.x = clamp(e.x, e.r, W - e.r); e.y = clamp(e.y, e.r + 30, H - e.r); }
  for (const s of G.shots) {
    const t = s.t; if (!t.alive) { s.dead = true; continue; }
    const d = dist(s, t) || 1, st = s.spd * dt; s.px = s.x; s.py = s.y;
    if (d <= st + t.r * .6) { hurtEnemy(G, t, s.dmg, s.src, s.big); if (s.big) ring(G, t.x, t.y, 6, 30, 'ember', .25); s.dead = true; }
    else { s.x += (t.x - s.x) / d * st; s.y += (t.y - s.y) / d * st; }
  }
  G.shots = G.shots.filter(s => !s.dead);
  for (const z of G.zones) {
    z.t += dt;
    if (z.friendly) { z.tick -= dt; if (z.tick <= 0) { z.tick = .5; for (const e of en) if (e.alive && Math.hypot(e.x - z.x, e.y - z.y) <= z.r + e.r) hurtEnemy(G, e, z.dmg, z.src, false, true); } }
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
function step(G, dt) {
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

/* ---------- network snapshot: compact arrays, read back by the client ---------- */
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
function snapshot(G) {
  return {
    tm: r2(G.t), st: G.state, cd: r2(G.cd), w: G.wave,
    a: G.actors.map(a => [r1(a.x), r1(a.y), R(a.hp), a.maxHp, a.alive ? 1 : 0, r2(a.face),
      (a.wallT > 0 ? 1 : 0) | (a.shield > 0 ? 2 : 0) | (a.iframe > 0 ? 4 : 0) | (a.rollT > 0 ? 8 : 0) | (a.human ? 16 : 0),
      a.target ? a.target.id : 0, a.cds.map(r1), R(a.ult)]),
    e: G.enemies.map(e => [e.id, e.kind, r1(e.x), r1(e.y), R(e.hp), e.maxHp, r2(e.face), r2(Math.max(0, e.spawnT)), e.stun > 0 ? 1 : 0, e.tm.enraged ? 1 : 0,
      e.cast ? [e.cast.name, r2(e.cast.t), e.cast.dur, e.cast.kickable ? 1 : 0, e.cast.victim ? e.cast.victim.idx : -1] : 0]),
    z: G.zones.map(z => [z.id, z.friendly ? 1 : 0, z.type === 'circle' ? 0 : 1, r1(z.x), r1(z.y), z.r || 0, r2(z.ang || 0), z.half || 0, z.len || 0, r2(z.t), z.dur, z.done ? 1 : 0]),
    s: G.shots.map(s => [s.id, r1(s.x), r1(s.y), s.big ? 1 : 0, s.src.idx])
  };
}

return { W, H, TIME_LIMIT, CLASSES, ENEMY, WAVES, ROSTER, SPOTS, createRun, step, snapshot };
});
