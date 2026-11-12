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
/* Rules that are a single number. Like every table in this file they can be changed by applyData() (see the end). */
const TUNE = { maxLevel: 30, lvStep: .06, xpBase: 80, xpGrow: 45, xpPow: 1.6, towerStep: 1.13, trashDrop: .1,
  gatherTime: 1.4, nodeRespawn: 45, mobRespawn: 25, potionCap: 5, potionHeal: .35, bagCap: 16, respecCost: 30 };
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
  taunt: { seal: '嘲', name: '嘲諷擊', cd: 6, aim: 'enemy', range: 24, lv: 1, mul: 2.4, dur: 4, desc: '重擊目標，並強迫它攻擊你 4 秒' },
  wall: { seal: '牆', name: '盾牆', cd: 14, aim: 'self', lv: 1, dur: 4, pct: .6, desc: '4 秒內受到的傷害降低 60%' },
  bash: { seal: '斷', name: '盾擊', cd: 10, aim: 'enemy', range: 72, kick: true, fn: 'kick', lv: 1, mul: 1, stun: 1.2, desc: '打斷身邊敵人的金色讀條' },
  charge: { seal: '衝', name: '衝鋒', cd: 9, aim: 'dir', range: 150, w: 16, lv: 3, mul: 2.2, stun: .9, desc: '朝指定方向衝出去，撞到的敵人受傷並暈眩' },
  quake: { seal: '震', name: '震地', cd: 8, aim: 'dir', range: 105, half: .7, lv: 5, mul: 2.6, dur: 3, desc: '砸向前方的扇形範圍，命中的敵人會轉向你' },
  guard: { seal: '護', name: '援護', cd: 12, aim: 'ally', range: 230, lv: 8, amt: 360, desc: '替一名隊友套上護盾' },
  tankUlt: { seal: '鐵', name: '鐵潮', ult: true, aim: 'self', lv: 1, amt: 260, dur: 5, desc: '全場敵人轉向你，全隊獲得護盾' },
  anchor: { seal: '錨', name: '錨落', ult: true, aim: 'point', range: 170, rad: 80, lv: 10, mul: 8, stun: 1.5, desc: '把錨砸在指定位置，大範圍重傷並暈眩' },
  // 潮語者
  mend: { seal: '泉', name: '湧泉', cd: 2.2, aim: 'ally', range: 600, lv: 1, amt: 280, desc: '治療一名隊友；短按會補血量最低的人' },
  ring: { seal: '環', name: '潮環', cd: 9, aim: 'self', lv: 1, amt: 170, rad: 120, desc: '治療你身邊的所有隊友' },
  seal: { seal: '斷', name: '鹽封', cd: 12, aim: 'enemy', range: 240, kick: true, fn: 'kick', lv: 1, mul: 1, stun: 1.2, desc: '打斷敵人的金色讀條' },
  wave: { seal: '湧', name: '潮湧', cd: 7, aim: 'dir', range: 210, w: 22, lv: 3, mul: 3, amt: 150, desc: '朝指定方向推出一道潮水，傷害敵人並治療路上的隊友' },
  pool: { seal: '靜', name: '靜水', cd: 14, aim: 'point', range: 190, rad: 70, lv: 5, amt: 45, dur: 5, desc: '在指定位置留下一片水域，5 秒內持續治療站在裡面的隊友' },
  barrier: { seal: '幕', name: '潮幕', cd: 10, aim: 'ally', range: 600, lv: 8, amt: 320, desc: '替一名隊友套上護盾' },
  healUlt: { seal: '漲', name: '漲潮', ult: true, aim: 'self', lv: 1, pct: .5, desc: '全隊回復一半血量，並救起倒地的隊友' },
  surge: { seal: '逆', name: '逆潮', ult: true, aim: 'self', lv: 10, amt: 300, dur: 5, pct: .06, desc: '全隊獲得護盾，並在 5 秒內持續回血' },
  // 燼矢
  blast: { seal: '爆', name: '爆燃箭', cd: 4, aim: 'enemy', range: 210, lv: 1, mul: 3.6, desc: '對目標造成大量傷害' },
  roll: { seal: '滾', name: '翻滾', cd: 6, aim: 'dir', range: 104, w: 10, lv: 1, desc: '朝指定方向翻滾，翻滾中不會受傷' },
  snipe: { seal: '斷', name: '斷法箭', cd: 10, aim: 'enemy', range: 240, kick: true, fn: 'kick', lv: 1, mul: 1, stun: 1.2, desc: '打斷敵人的金色讀條' },
  pierce: { seal: '穿', name: '穿刺箭', cd: 6, aim: 'dir', range: 250, w: 14, lv: 3, mul: 3.2, desc: '朝指定方向射出一箭，貫穿路上所有敵人' },
  volley: { seal: '散', name: '散射', cd: 7, aim: 'dir', range: 160, half: .5, lv: 5, mul: 2.2, desc: '朝前方扇形範圍射出一排箭' },
  mark: { seal: '印', name: '獵印', cd: 14, aim: 'enemy', range: 210, lv: 8, dur: 6, pct: .25, desc: '標記一個敵人，6 秒內所有人對它的傷害提高 25%' },
  dpsUlt: { seal: '雨', name: '燼雨', ult: true, aim: 'point', range: 210, rad: 72, lv: 1, mul: 1.6, dur: 4, desc: '在指定位置降下 4 秒火雨' },
  sunshot: { seal: '日', name: '貫日', ult: true, aim: 'dir', range: 320, w: 30, lv: 10, mul: 14, desc: '朝指定方向射出一道貫穿全場的重箭' }
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
/* Talents. One point per level after the first. A row opens once 3 points per row above it are spent. Every talent
 * is `max` ranks of one modifier: hp, dmg, heal, taken (damage taken), speed, threat, ult (ultimate charge),
 * cdr (all cooldowns) or cd:<skill> (one skill's cooldown). */
const TALENTS = {
  tank: [
    { id: 't-hp', row: 0, max: 3, name: '厚殼', eff: ['hp', .05], desc: '生命上限 +5%' },
    { id: 't-threat', row: 0, max: 3, name: '挑釁姿態', eff: ['threat', .12], desc: '造成的仇恨 +12%' },
    { id: 't-taken', row: 0, max: 3, name: '卸力', eff: ['taken', -.03], desc: '受到的傷害 -3%' },
    { id: 't-wall', row: 1, max: 2, name: '久守', eff: ['cd:wall', -.12], desc: '盾牆冷卻 -12%' },
    { id: 't-dmg', row: 1, max: 3, name: '反擊', eff: ['dmg', .04], desc: '造成的傷害 +4%' },
    { id: 't-taunt', row: 1, max: 2, name: '喝斥', eff: ['cd:taunt', -.12], desc: '嘲諷擊冷卻 -12%' },
    { id: 't-ult', row: 2, max: 2, name: '鐵潮湧動', eff: ['ult', .15], desc: '大招能量累積 +15%' },
    { id: 't-speed', row: 2, max: 2, name: '踏浪', eff: ['speed', .05], desc: '移動速度 +5%' },
    { id: 't-cdr', row: 2, max: 2, name: '老練', eff: ['cdr', -.05], desc: '所有技能冷卻 -5%' } ],
  heal: [
    { id: 'h-heal', row: 0, max: 3, name: '深泉', eff: ['heal', .05], desc: '治療量 +5%' },
    { id: 'h-hp', row: 0, max: 3, name: '潮護', eff: ['hp', .05], desc: '生命上限 +5%' },
    { id: 'h-speed', row: 0, max: 2, name: '輕步', eff: ['speed', .05], desc: '移動速度 +5%' },
    { id: 'h-mend', row: 1, max: 2, name: '湧流', eff: ['cd:mend', -.1], desc: '湧泉冷卻 -10%' },
    { id: 'h-ring', row: 1, max: 2, name: '回波', eff: ['cd:ring', -.12], desc: '潮環冷卻 -12%' },
    { id: 'h-taken', row: 1, max: 3, name: '水幕', eff: ['taken', -.03], desc: '受到的傷害 -3%' },
    { id: 'h-ult', row: 2, max: 2, name: '漲潮之兆', eff: ['ult', .15], desc: '大招能量累積 +15%' },
    { id: 'h-dmg', row: 2, max: 3, name: '鹽刺', eff: ['dmg', .06], desc: '造成的傷害 +6%' },
    { id: 'h-cdr', row: 2, max: 2, name: '從容', eff: ['cdr', -.05], desc: '所有技能冷卻 -5%' } ],
  dps: [
    { id: 'd-dmg', row: 0, max: 3, name: '餘燼', eff: ['dmg', .04], desc: '造成的傷害 +4%' },
    { id: 'd-speed', row: 0, max: 2, name: '快腿', eff: ['speed', .05], desc: '移動速度 +5%' },
    { id: 'd-hp', row: 0, max: 3, name: '硬骨頭', eff: ['hp', .05], desc: '生命上限 +5%' },
    { id: 'd-blast', row: 1, max: 2, name: '連燃', eff: ['cd:blast', -.1], desc: '爆燃箭冷卻 -10%' },
    { id: 'd-roll', row: 1, max: 2, name: '滑步', eff: ['cd:roll', -.12], desc: '翻滾冷卻 -12%' },
    { id: 'd-ult', row: 1, max: 2, name: '積火', eff: ['ult', .15], desc: '大招能量累積 +15%' },
    { id: 'd-focus', row: 2, max: 3, name: '專注', eff: ['dmg', .04], desc: '造成的傷害 +4%' },
    { id: 'd-taken', row: 2, max: 2, name: '側身', eff: ['taken', -.04], desc: '受到的傷害 -4%' },
    { id: 'd-cdr', row: 2, max: 2, name: '熟手', eff: ['cdr', -.05], desc: '所有技能冷卻 -5%' } ]
};
const NO_MODS = { hp: 1, dmg: 1, heal: 1, taken: 1, speed: 1, threat: 1, ult: 1, cdr: 1, cd: {} };
const talentPoints = cl => Math.max(0, cl - 1), talentSpent = t => Object.keys(t || {}).reduce((n, k) => n + t[k], 0);
/* what a character's talents add up to; safe on anything */
function modsOf(talents, cls) {
  const m = { hp: 1, dmg: 1, heal: 1, taken: 1, speed: 1, threat: 1, ult: 1, cdr: 1, cd: {} }, list = TALENTS[cls] || [];
  for (const t of list) { const r = talents && talents[t.id]; if (!(r > 0)) continue; const k = t.eff[0], v = t.eff[1] * Math.min(r, t.max); if (k.startsWith('cd:')) m.cd[k.slice(3)] = 1 + v; else m[k] += v; }
  return m;
}

const defaultLoadout = cls => CLASSES[cls].skills.map(s => s.id);
/* three different unlocked regular skills of the class, then one unlocked ultimate */
function validLoadout(cls, ids, cl) {
  const d = CLASSES[cls];
  return !!d && Array.isArray(ids) && ids.length === 4 && ids.slice(0, 3).every((id, i) => d.pool.includes(id) && ids.indexOf(id) === i && SKILLS[id].lv <= cl) && d.ults.includes(ids[3]) && SKILLS[ids[3]].lv <= cl;
}
const skillSet = (cls, ids) => validLoadout(cls, ids, 99) ? ids.map(id => SKILLS[id]) : CLASSES[cls].skills;
const ENEMY = {
  grunt: { name: '鏽蝕水鬼', hp: 1000, dmg: 34, aspd: 1.3, range: 8, speed: 70, r: 13, aggro: 105 },
  caster: { name: '鹽咒祭司', hp: 800, dmg: 150, aspd: 0, range: 165, speed: 60, r: 12, aggro: 150, caster: true },
  // field creatures: tuned for one player; aggro and leash are distances
  crab: { name: '鏽灘蟹', xp: 12, hp: 300, dmg: 20, aspd: 1.4, range: 6, speed: 64, r: 11, aggro: 95, leash: 300 },
  acolyte: { name: '鹽咒學徒', xp: 16, hp: 240, dmg: 85, aspd: 0, range: 150, speed: 58, r: 11, aggro: 130, leash: 320, caster: true },
  brute: { name: '鏽錨巨蟹', hp: 2200, dmg: 34, aspd: 1.6, range: 10, speed: 54, r: 20, aggro: 200, leash: 9999, elite: true },     // only comes ashore with the surge
  boss: { name: '鏽潮看守者 莫葛', hp: 27000, dmg: 80, aspd: 1.5, range: 10, speed: 58, r: 28, aggro: 150, boss: true, intro: '莫葛從潮門爬了出來',
    moves: [{ t: 'adds', at: .5, kind: 'grunt', n: 2, say: '水鬼湧入！' }, { t: 'enrage', at: .3, mul: 1.3, say: '看守者狂怒！' },
      { t: 'roar', name: '潮嘯', first: 12, every: 16, cast: 2.8, dmg: 250 }, { t: 'cone', name: '錨擊', first: 5, every: 7, cast: 1.4, dmg: 300, half: .62, len: 125 },
      { t: 'circles', name: '落鐘', first: 8, every: 9, cast: 1.7, dmg: 290, r: 44, n: 2 }] }
};
/* A creature kind made in the editor is a copy of one of the six above (its `base`), which decides how it behaves and
 * where it can appear; its numbers, and for a boss its moves, are its own. */
const TOWER_BASE = ['grunt', 'caster', 'boss'], FIELD_BASE = ['crab', 'acolyte', 'brute'];
const baseOf = kind => (ENEMY[kind] && ENEMY[kind].base) || kind;
const kindsOf = bases => Object.keys(ENEMY).filter(k => bases.includes(baseOf(k)));
/* What a boss can do, as blocks: [label, { field: [label, min, max, step] }]. Timed moves wait `first` seconds, then
 * come every `every` seconds; the first one in the list that is ready goes. */
const TIMED = { first: ['第一次在幾秒後', 0, 120, .5], every: ['之後每幾秒一次', 2, 120, .5], cast: ['預警秒數', .5, 10, .1], dmg: ['傷害（再乘上層數）', 0, 1e5, 5] };
const MOVES = {
  cone: ['扇形斬：朝目標砍出扇形', Object.assign({}, TIMED, { half: ['扇形半角（弧度）', .2, 1.5, .02], len: ['扇形長度', 40, 300, 5] })],
  circles: ['落點圈：在幾個人腳下放圈', Object.assign({}, TIMED, { r: ['圈的半徑', 20, 150, 1], n: ['一次幾個圈', 1, 4, 1] })],
  nova: ['震盪：以自己為中心的大圈', Object.assign({}, TIMED, { r: ['圈的半徑', 40, 260, 5] })],
  roar: ['全場吼叫：金色讀條，沒打斷就全隊受傷', TIMED],
  adds: ['召喚小怪：血量低於某個比例時', { at: ['血量比例（0 到 1）', .05, .95, .05], n: ['幾隻', 1, 4, 1] }],
  enrage: ['狂暴：血量低於某個比例後變快', { at: ['血量比例（0 到 1）', .05, .95, .05], mul: ['變快幾倍', 1.05, 3, .05] }]
};
const PORTAL = { x: W / 2, y: 104, r: 26 };      // where the way out appears once 莫葛 is down
const WAVES = [ [['grunt', 3]], [['grunt', 2], ['caster', 1]], [['grunt', 2], ['caster', 2]], [['boss', 1]] ];
/* Every dungeon has a name, the level it opens at and a time to beat. There are two kinds.
 * 'waves': one arena, creatures arrive wave after wave, clearing the last wave wins.
 * 'layout': a place laid out by hand (map): terrain, creatures that stand, roam or patrol and fight when you come near,
 * bosses, chests and rare creatures that are there only some of the time, and events you set off by walking into
 * them. It is won when every boss in it is down.
 * Each character has their own floor in each dungeon; the tower's floor is p.lvl, the others are in p.dl. */
const DUNGEONS = { tower: { name: '沉鐘塔', min: 3, time: TIME_LIMIT, type: 'waves', waves: WAVES } };
const EVENT_TYPES = ['ambush', 'say', 'heal'];
const blankScene = () => ({ w: 700, h: 1000, spawn: { x: 350, y: 930 }, rocks: [], walls: [], mobs: [], chests: [], events: [] });
/* the layout as a map the movement and drawing code understands */
const sceneField = (id, D) => ({ id: 'd:' + id, name: D.name, w: D.map.w, h: D.map.h, spawn: [D.map.spawn.x, D.map.spawn.y], fire: null, safe: null, gate: null, events: [], npcs: [], stalls: [], path: [], rocks: D.map.rocks, nodes: [], packs: [], exits: [], walls: D.map.walls });
const floorOf = (p, did) => did && did !== 'tower' && DUNGEONS[did] ? ((p.dl && p.dl[did]) || 1) : p.lvl;
const ROSTER = ['tank', 'heal', 'dps', 'dps'];
const SPOTS = [[180, H - 150], [128, H - 84], [236, H - 96], [184, H - 58]];
const BOT_NAMES = { tank: '柯爾', heal: '蜜拉', dps: ['阿燼', '小霧'] };

/* ---------- the field: 鏽灘, the shore between the camp (south) and the tower gate (north) ---------- */
const SOLO_BOOST = { tank: 1.8, heal: 3.2, dps: 1 };   // alone in the field, tanks and healers hit harder so every class can hunt
const FIELD = {
  id: 'shore', name: '鏽灘', w: 900, h: 1500, exits: [], walls: [],
  spawn: [450, 1398], fire: [450, 1330], safe: { x: 450, y: 1325, r: 150 },   // monsters neither enter nor attack into the camp
  gate: { x: 450, y: 120, r: 46 },
  events: [{ x: 450, y: 790, r: 115 }, { x: 620, y: 430, r: 115 }],             // where the tide surge can come ashore
  npcs: [{ id: 'kol', x: 385, y: 1285 }, { id: 'mira', x: 512, y: 1280 }, { id: 'jin', x: 540, y: 1372 }, { id: 'wu', x: 372, y: 1378 }],
  stalls: [{ id: 'shop', name: '老錨', title: '商人', x: 318, y: 1318 }, { id: 'ah', name: '秤婆', title: '拍賣', x: 585, y: 1318 }, { id: 'mail', name: '信箱', title: '寄信收信', x: 450, y: 1235 }],      // people at the camp who run a service rather than a story
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
const lvF = L => 1 + TUNE.lvStep * (Math.max(1, L) - 1);
const xpNeed = L => L >= TUNE.maxLevel ? 0 : Math.round(TUNE.xpBase + TUNE.xpGrow * Math.pow(L - 1, TUNE.xpPow));   // experience to go from L to L + 1
const recLevel = floor => Math.min(TUNE.maxLevel, 1 + (floor - 1) * 2);                    // the level a tower floor is meant for
const mobLevel = (pk, cl) => clamp(cl, pk.min, pk.max);
/* Creatures a few levels under you teach less and less; ones above you teach a little more. */
function xpForKill(kind, mobLvl, cl) {
  const d = cl - mobLvl, mul = d < 0 ? Math.min(1.3, 1 - d * .1) : d <= 2 ? 1 : d >= 7 ? .1 : 1 - (d - 2) * .2;
  return Math.round(((ENEMY[kind] && ENEMY[kind].xp) || 0) * lvF(mobLvl) * mul);
}
/* A field creature at a level, for a party of a size: more people means more health, not harder hits. */
function scaleMob(e, lvl, size) { const k = e.maxHp ? e.hp / e.maxHp : 1; e.lvl = lvl; e.size = size || 1; e.maxHp = R(e.def.hp * lvF(lvl) * (1 + .6 * (e.size - 1))); e.hp = Math.max(1, R(e.maxHp * k)); e.dmg = e.def.dmg * lvF(lvl); }
/* Who is actually in the field (a seat whose player left stays in the list, marked out), and the level creatures follow. */
const present = G => G.actors.filter(a => !a.out);
function partyLevel(G) { const ps = present(G); return ps.length ? Math.max(1, Math.round(ps.reduce((n, a) => n + a.lvl, 0) / ps.length)) : 1; }
/* Gear, talents or skills changed while out in the world: new strength, the same share of health. Cooldowns stay with their slots. */
function refit(a, lvl, pow, mods, skills) { const k = a.maxHp ? a.hp / a.maxHp : 1; a.lvl = lvl; a.pow = pow; if (mods) a.mods = mods; if (skills) a.skills = skillSet(a.cls, skills); a.maxHp = R(a.def.hp * pow * a.mods.hp); a.hp = a.alive ? Math.max(1, R(a.maxHp * k)) : 0; }
function setLevel(a, lvl, pow) { a.lvl = lvl; a.pow = pow; a.maxHp = R(a.def.hp * pow * a.mods.hp); a.hp = a.maxHp; }   // levelling up refills your health

/* Every map of the world. The shore is the one with the camp, the people and the tide surge; maps made in the editor
 * are joined to it by exits. A field (G) is one map: G.F. */
const MAPS = { shore: FIELD };
const blankMap = (id, name) => ({ id, name, w: 900, h: 900, spawn: [450, 800], fire: null, safe: null, gate: null, events: [], npcs: [], stalls: [], path: [], rocks: [], nodes: [], packs: [], exits: [], walls: [] });
const inCamp = (G, p) => { const c = G.F.safe; return !!c && Math.hypot(p.x - c.x, p.y - c.y) < c.r; };
/* Keep a body out of what cannot be walked through: rocks (round) and walls or water (boxes, x and y at the centre). */
function pushOut(p, F) {
  F = F || FIELD;
  for (const r of F.rocks) { const dx = p.x - r.x, dy = p.y - r.y, d = Math.hypot(dx, dy) || .01, m = r.r + p.r; if (d < m) { p.x = r.x + dx / d * m; p.y = r.y + dy / d * m; } }
  for (const b of F.walls) {
    if (b.type === 'road') continue; const hw = b.w / 2, hh = b.h / 2, dx = p.x - b.x, dy = p.y - b.y;
    if (Math.abs(dx) >= hw + p.r || Math.abs(dy) >= hh + p.r) continue;
    const cx = clamp(dx, -hw, hw), cy = clamp(dy, -hh, hh), ox = dx - cx, oy = dy - cy, d = Math.hypot(ox, oy);
    if (d > 0) { if (d < p.r) { p.x = b.x + cx + ox / d * p.r; p.y = b.y + cy + oy / d * p.r; } }
    else if (hw - Math.abs(dx) < hh - Math.abs(dy)) p.x = b.x + (dx < 0 ? -1 : 1) * (hw + p.r); else p.y = b.y + (dy < 0 ? -1 : 1) * (hh + p.r);      // inside the box: out through the nearer side
  }
}

/* ---------- events ---------- */
function ev(G, o) { G.events.push(o); }
function text(G, x, y, s, c, z, d) { ev(G, { k: 'text', x: R(x), y: R(y), s, c, z: z || 11, d: d || .8 }); }
function ring(G, x, y, a, b, c, d) { ev(G, { k: 'ring', x: R(x), y: R(y), a: R(a), b: R(b), c, d: d || .35 }); }
function beam(G, p, q, c) { ev(G, { k: 'beam', x: R(p.x), y: R(p.y), x2: R(q.x), y2: R(q.y), c }); }
function banner(G, s, ms) { ev(G, { k: 'banner', s, ms: ms || 1600 }); }
function shake(G, v) { ev(G, { k: 'shake', v }); }
function fail(G, a, s) { if (a.human) ev(G, { k: 'fail', i: a.idx, s }); return false; }

/* ---------- setup ---------- */
function mkActor(cls, name, spot, pow, mods) {
  const d = CLASSES[cls], md = mods || NO_MODS;
  return { cls, def: d, name, x: spot[0], y: spot[1], r: 12, pow, mods: md, maxHp: R(d.hp * pow * md.hp), hp: R(d.hp * pow * md.hp), alive: true, human: false, pid: null, idx: 0,
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
  const did = DUNGEONS[opts.dungeon] ? opts.dungeon : 'tower';
  const D = DUNGEONS[did], lay = D.type === 'layout' && !!D.F;
  const G = { mode: 'dungeon', did, D, layout: lay, F: lay ? D.F : null, limit: D.time || TIME_LIMIT, chests: [], trigs: [], calm: 0, portal: null, bossN: 0, bw: lay ? D.F.w : W, bh: lay ? D.F.h : H, t: 0, lvl, elvl: recLevel(lvl), es: Math.pow(TUNE.towerStep, lvl - 1), state: 'countdown', cd: 3, wave: -1, gap: null, actors: [], enemies: [], zones: [], shots: [], events: [],
    boss: null, result: null, nextId: 1, grace: opts.grace || 0, auto: !!opts.auto, drops: 0 };
  const pending = (opts.players || []).slice(); let dpsN = 0;
  ROSTER.forEach((c, i) => {
    const k = pending.findIndex(p => p.cls === c), p = k >= 0 ? pending.splice(k, 1)[0] : null;
    const at = lay ? [clamp(D.F.spawn[0] + (SPOTS[i][0] - 180) * .5, 20, D.F.w - 20), clamp(D.F.spawn[1] + (SPOTS[i][1] - 340) * .5, 20, D.F.h - 20)] : SPOTS[i];      // in a layout the party starts around its entrance
    const a = mkActor(c, p ? p.name : (c === 'dps' ? BOT_NAMES.dps[dpsN++] : BOT_NAMES[c]), at, p ? p.pow : botPow, p ? p.mods : null);
    a.lvl = p && p.lvl > 0 ? p.lvl : G.elvl;   // a player shows their own level; a bot shows the level the floor is meant for
    a.idx = i; a.human = !!p; a.pid = p ? p.id : null; a.potions = p && p.potions > 0 ? 1 : 0; if (p && p.skills) a.skills = skillSet(c, p.skills); G.actors.push(a);   // one potion per run
  });
  if (lay) populate(G);
  return G;
}
/* Fill a layout: each placed group is there or not by its chance, likewise each chest. */
function populate(G) {
  const M = G.D.map;
  M.mobs.forEach((m, gi) => {
    if (!ENEMY[m.kind] || Math.random() >= m.chance) return;
    for (let i = 0; i < m.n; i++) {
      const e = mkEnemy(G, m.kind, m.x + (i - (m.n - 1) / 2) * 30, m.y + (i % 2) * 20); e.grp = gi; e.home = { x: e.x, y: e.y }; e.engaged = false; e.spawnT = 0;
      e.roam = m.roam || 0; e.wp = m.path && m.path.length ? [e.home].concat(m.path.map(q => ({ x: q.x + (e.x - m.x), y: q.y + (e.y - m.y) }))) : null; e.wi = 1; e.wd = 1; e.loop = !!m.loop;      // a patrol: from where it stands through each point of its route e.wx = e.x; e.wy = e.y; e.wt = rand(0, 3);
      if (m.rare) { e.rare = true; e.maxHp = R(e.maxHp * 2.5); e.hp = e.maxHp; e.dmg *= 1.3; e.name = '稀有・' + e.name; }
    }
  });
  G.chests = M.chests.filter(c => Math.random() < c.chance).map(c => ({ x: c.x, y: c.y, open: false }));
  G.trigs = M.events.map(() => ({ done: false })); G.bossN = G.enemies.filter(e => e.boss).length; G.wave = 0;
}
/* A creature of a layout that is not fighting yet: it fights when someone comes near or hits it, and its whole group
 * with it; until then it stands, roams about its spot or walks its patrol. True when it should fight this step. */
function delveMob(G, e, dt) {
  const near = nearest(e, G.actors);
  if ((near && dist(e, near) < (e.def.aggro || 110) + near.r) || e.threat.size) {
    for (const o of G.enemies) if (o.alive && o.grp === e.grp && !o.engaged) { o.engaged = true; if (near && !o.threat.size) o.threat.set(near, 1); if (o.boss && G.boss !== o) { G.boss = o; banner(G, o.def.intro || `${o.name} 出現了`, 2200); } }
    return true;
  }
  let tx = e.x, ty = e.y;
  if (e.wp) {      // at a point of the route: on to the next one, round in a ring or there and back
    const p = e.wp[e.wi], n = e.wp.length;
    e.wst = (e.wst || 0) + dt;      // a point that cannot be reached, behind a rock say, is given up on after a while
        if (Math.hypot(p.x - e.x, p.y - e.y) < 6 || e.wst > 14) { e.wst = 0; if (e.loop) e.wi = (e.wi + 1) % n; else { if (e.wi + e.wd < 0 || e.wi + e.wd >= n) e.wd = -e.wd; e.wi += e.wd; } }
    tx = e.wp[e.wi].x; ty = e.wp[e.wi].y;
  }
  else if (e.roam > 0) { e.wt -= dt; if (e.wt <= 0) { e.wt = rand(2, 5); const an = rand(0, TAU), rr = rand(0, e.roam); e.wx = e.home.x + Math.cos(an) * rr; e.wy = e.home.y + Math.sin(an) * rr; } tx = e.wx; ty = e.wy; }
  const d = Math.hypot(tx - e.x, ty - e.y); if (d > 3) { const sp = e.def.speed * .45 * dt; e.x += (tx - e.x) / d * Math.min(sp, d); e.y += (ty - e.y) / d * Math.min(sp, d); e.face = Math.atan2(ty - e.y, tx - e.x); }
  return false;
}
/* The part of a step that only a layout has: getting your breath back between fights, chests, events, and the win. */
function stepDelve(G, dt) {
  const fight = G.enemies.some(e => e.engaged), M = G.D.map;
  G.calm = fight ? 0 : G.calm + dt;
  if (G.calm > 2) for (const a of G.actors) { if (!a.alive) revive(G, a); else if (a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * .1 * dt); }
  for (const a of G.actors) {
    if (!a.alive || !a.human) continue;      // only people open chests and set things off, never the AI teammates
    for (const c of G.chests) if (!c.open && !fight && Math.hypot(c.x - a.x, c.y - a.y) < 36) { c.open = true; G.drops++; text(G, c.x, c.y - 24, '寶箱！多一件裝備', 'brass', 14, 1.8); ring(G, c.x, c.y, 6, 36, 'brass', .5); }
    M.events.forEach((t, i) => {
      const st = G.trigs[i]; if (!st || st.done || Math.hypot(t.x - a.x, t.y - a.y) > t.r) return; st.done = true;
      if (t.type === 'say') banner(G, t.text || '……', 2800);
      else if (t.type === 'heal') { for (const p of G.actors) { if (!p.alive) revive(G, p); p.hp = p.maxHp; } text(G, t.x, t.y - 20, '泉水讓全隊回滿了', 'heal', 14, 1.8); ring(G, t.x, t.y, 10, t.r, 'heal', .6); }
      else { banner(G, t.text || '有埋伏！', 2200); const kind = ENEMY[t.kind] ? t.kind : 'grunt';
        for (let k = 0; k < t.n; k++) { const an = k * 2.1 + i, e = mkEnemy(G, kind, clamp(t.x + Math.cos(an) * 70, 20, G.bw - 20), clamp(t.y + Math.sin(an) * 70, 20, G.bh - 20)); e.grp = 1000 + i; e.home = { x: e.x, y: e.y }; e.engaged = true; e.threat.set(a, 1); } }
    });
  }
  if (G.bossN ? !G.enemies.some(e => e.boss) : !G.enemies.length) { if (!G.portal) { const p = G.actors.find(a => a.human && a.alive) || G.actors[0]; G.portal = { x: p.x, y: p.y }; } finish(G, true); }
}
function mkEnemy(G, kind, x, y) {
  const d = ENEMY[kind], s = G.es;
  const e = { id: G.nextId++, kind, def: d, name: d.name, lvl: G.elvl || 1, x, y, r: d.r, maxHp: R(d.hp * s), hp: R(d.hp * s), dmg: d.dmg * s, atkT: rand(.4, 1), threat: new Map(),
    fix: null, fixT: 0, target: null, cast: null, stun: 0, boss: !!d.boss, tm: { enraged: false, rage: 1 }, alive: true, spawnT: .6, face: Math.PI / 2 };
  if (d.caster) e.tm.cast = rand(1.5, 3.5);
  if (d.moves) e.mv = d.moves.map(m => ({ t: m.first || 0, used: false }));
  if (e.boss && !G.layout) G.boss = e;      // in a layout a boss is announced when it joins the fight
  const tank = G.mode !== 'field' && !G.layout && G.actors.find(a => a.cls === 'tank'); if (tank) e.threat.set(tank, 40);
  G.enemies.push(e); return e;
}
function spawnMob(G, pk, home) {
  const def = G.F.packs[pk]; if (!def || !ENEMY[def.kind]) return null;      // the map was edited while this field was running
  const e = mkEnemy(G, def.kind, home.x + rand(-14, 14), home.y + rand(-14, 14));
  e.pk = pk; e.home = home; e.wx = e.x; e.wy = e.y; e.wt = rand(0, 3); e.engaged = false; e.ret = false;
  if (def.name) { e.name = def.name; e.named = true; }      // a creature with a name of its own: someone a quest can ask for
  // with a route it walks that instead of idling about its spot
  if (def.path && def.path.length) { e.spot = home; e.wp = [{ x: e.x, y: e.y }].concat(def.path.map(q => ({ x: q.x + (e.x - def.x), y: q.y + (e.y - def.y) }))); e.wi = 1; e.wd = 1; e.loop = !!def.loop; }
  scaleMob(e, mobLevel(def, partyLevel(G)), G.ev ? 1 : Math.max(1, present(G).length)); return e;
}
function fieldSeat(F, p, idx, at) {
  const a = mkActor(p.cls, p.name, at ? [clamp(at[0], 20, F.w - 20), clamp(at[1], 20, F.h - 20)] : [clamp(F.spawn[0] + (idx % 4 - 1.5) * 26, 20, F.w - 20), clamp(F.spawn[1] + (idx % 2) * 18, 20, F.h - 20)], p.pow, p.mods);
  a.lvl = p.lvl > 0 ? p.lvl : 1; if (p.skills) a.skills = skillSet(p.cls, p.skills);
  a.idx = idx; a.human = true; a.out = false; a.pid = p.id; a.calm = 0; a.downT = 0; a.gather = null; a.pick = 0; return a;
}
/* opts: { lvl, players: [{ cls, name, pow, id, lvl, skills }] } (or a single `player`), cap (seats, 4 unless said), event ({ x, y, r }
 * for a field that holds a tide surge). No bots and no timer. Each gathering spot regrows separately for each person. */
function createField(opts) {
  const ps = opts.players || (opts.player ? [opts.player] : []), cap = opts.cap || 4, F = MAPS[opts.map] || FIELD;
  const G = { mode: 'field', F, map: F.id, bw: F.w, bh: F.h, t: 0, lvl: opts.lvl || 1, elvl: 1, es: 1, state: 'run', cd: 0, wave: -1, gap: null, actors: [], enemies: [], zones: [], shots: [], events: [],
    boss: null, result: null, nextId: 1, grace: opts.grace || 0, auto: false, respawns: [], cap, nodes: F.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, cd: new Array(cap).fill(0) })),
    ev: opts.event ? { x: opts.event.x, y: opts.event.y, r: opts.event.r, wave: -1, t: 0, gap: 2, done: false } : null };
  ps.slice(0, cap).forEach((p, i) => G.actors.push(fieldSeat(F, p, i)));
  F.packs.forEach((pk, k) => { for (let i = 0; i < pk.n; i++) spawnMob(G, k, { x: pk.x + (i - (pk.n - 1) / 2) * 34, y: pk.y + (i % 2) * 22 }); });
  return G;
}
/* Someone walks in: they take a seat that was left, or a new one. Returns the seat, or -1 when the field is full. */
function addFieldActor(G, p, at) {
  let idx = G.actors.findIndex(a => a.out); if (idx < 0) { if (G.actors.length >= G.cap) return -1; idx = G.actors.length; }
  G.actors[idx] = fieldSeat(G.F, p, idx, at); for (const n of G.nodes) n.cd[idx] = 0; return idx;
}
function removeFieldActor(G, idx) {
  const a = G.actors[idx]; if (!a || a.out) return; a.out = true; a.alive = false; a.target = null; a.gather = null;
  for (const e of G.enemies) e.threat.delete(a);
}
function nextWave(G) {
  if (G.layout) return;
  G.wave++; const w = G.D.waves[G.wave]; if (!w) return; const had = G.boss;
  const list = []; for (const [k, n] of w) if (ENEMY[k]) for (let i = 0; i < n; i++) list.push(k);
  list.forEach((k, i) => mkEnemy(G, k, W / 2 + (i - (list.length - 1) / 2) * 52, ENEMY[k].boss ? 84 : ENEMY[k].caster ? 58 : 76));
  if (G.boss && G.boss !== had) banner(G, G.boss.def.intro || `${G.boss.name} 出現了`, 2200);
}

/* ---------- combat helpers ---------- */
function inRange(a, t, extra) { return dist(a, t) <= a.def.range + a.r + t.r + (extra || 0); }
function nearest(p, list) { let b = null, bd = 1e9; for (const o of list) { if (!o.alive) continue; const d = dist(p, o); if (d < bd) { bd = d; b = o; } } return b; }
const bossMul = G => G.t > G.limit ? 1 + (G.t - G.limit) / 15 : 1;

function hurtActor(G, a, dmg, avoidable) {
  if (!a.alive || a.iframe > 0) return;
  dmg *= a.mods.taken; if (a.wallT > 0) dmg *= 1 - SKILLS.wall.pct;
  if (a.shield > 0) { const s = Math.min(a.shield, dmg); a.shield -= s; dmg -= s; }
  if (dmg <= 0) return;
  a.hp -= dmg; a.ult = Math.min(100, a.ult + dmg / a.maxHp * 40);
  if (avoidable) a.stats.hits++;
  ev(G, { k: 'hurt', i: a.idx, v: R(dmg), av: avoidable ? 1 : 0 });
  if (a.hp <= 0) { a.hp = 0; a.alive = false; a.shield = 0; ev(G, { k: 'down', i: a.idx }); }
}
function hurtEnemy(G, e, dmg, src, big, noUlt) {
  if (!e.alive || e.ret) return;                        // a creature walking back to its spot cannot be hurt
  if (G.mode === 'field' && present(G).length < 2) dmg *= SOLO_BOOST[src.cls] || 1;     // the boost is for hunting alone
  dmg *= src.mods.dmg; if (e.vulnT > 0) dmg *= 1 + SKILLS.mark.pct;                         // marked by a hunter
  e.hp -= dmg; src.stats.dmg += dmg;
  e.threat.set(src, (e.threat.get(src) || 0) + dmg * src.def.threat * src.mods.threat);
  if (!noUlt) src.ult = Math.min(100, src.ult + dmg / (src.pow * src.def.ultK) * src.mods.ult);
  ev(G, { k: 'dmg', x: R(e.x), y: R(e.y - e.r - 6), v: R(dmg), big: big ? 1 : 0, by: src.idx });
  if (e.hp <= 0) {
    e.hp = 0; e.alive = false; ring(G, e.x, e.y, e.r * .5, e.r * 2.2, e.boss ? 'brass' : 'rust', .45);
    if (G.mode === 'field') { if (!e.evm) G.respawns.push({ pk: e.pk, home: e.spot || e.home, at: G.t + ((G.F.packs[e.pk] || {}).respawn || TUNE.mobRespawn) }); ev(G, { k: 'kill', kind: e.kind, pk: e.pk, by: src.idx, who: present(G).filter(a => a === src || (a.alive && dist(a, e) < 420)).map(a => a.idx) }); }   // everyone nearby gets credit
    if (e.rare) { G.drops++; text(G, e.x, e.y - e.r - 20, '稀有精英掉了東西', 'brass', 13, 1.6); }
    else if (G.mode !== 'field' && !e.boss && Math.random() < TUNE.trashDrop) { G.drops++; text(G, e.x, e.y - e.r - 20, '掉了東西', 'brass', 12, 1.3); }
    if (e.boss && G.layout) G.portal = { x: e.x, y: e.y };      // the way out opens where the last boss fell
    if (e.boss) { for (const o of G.enemies) if (o !== e && o.alive && (!G.layout || (o.engaged && !o.boss))) { o.alive = false; ring(G, o.x, o.y, 6, 30, 'rust', .4); } G.zones.length = 0; shake(G, .6); }
  }
}
function healActor(G, a, amt, src) {
  if (!a.alive) return;
  const real = Math.min(amt * src.mods.heal, a.maxHp - a.hp); if (real < 1) return;
  a.hp += real; src.stats.heal += real;
  src.ult = Math.min(100, src.ult + real / (src.pow * 22) * src.mods.ult);
  ev(G, { k: 'heal', i: a.idx, v: R(real), by: src.idx });
  const open = G.mode === 'field' || G.layout;      // where creatures wait to be pulled, healing only angers the ones already fighting
  for (const e of G.enemies) if (!open || e.engaged) e.threat.set(src, (e.threat.get(src) || 0) + real * .2);
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
  taunt(G, a, aim, sk) { const t = aimEnemy(G, a, aim, sk.range); if (!t) return fail(G, a, '離目標太遠'); hurtEnemy(G, t, a.def.atk * a.pow * sk.mul, a, true); t.fix = a; t.fixT = sk.dur; ring(G, t.x, t.y, 8, 36, 'tank'); },
  wall(G, a, aim, sk) { a.wallT = sk.dur; ring(G, a.x, a.y, 8, 32, 'tank'); },
  kick(G, a, aim, sk) {
    const want = aim && aim.k === 'id' ? aim.id : 0; let best = null;
    for (const e of G.enemies) {
      if (!e.alive || !e.cast || !e.cast.kickable || dist(a, e) > sk.range + e.r) continue;
      const score = (e.id === want ? 4 : 0) + (e === a.target ? 2 : 0) + e.cast.t / e.cast.dur; if (!best || score > best.s) best = { e, s: score };
    }
    if (!best) return fail(G, a, '沒有金色讀條可以打斷');
    const e = best.e; e.cast = null; e.stun = sk.stun; if (e.def.caster) e.tm.cast = rand(4, 5);
    hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a); beam(G, a, e, 'brass'); ring(G, e.x, e.y, e.r, e.r + 22, 'brass');
    text(G, e.x, e.y - e.r - 24, '打斷', 'brass', 16, 1.1); a.stats.kicks++;
  },
  charge(G, a, aim, sk) {
    const d = aimDir(G, a, aim), o = { x: a.x, y: a.y };
    a.rvx = d.x * sk.range / .22; a.rvy = d.y * sk.range / .22; a.rollT = .22; a.iframe = Math.max(a.iframe, .25);
    for (const e of G.enemies) if (e.alive && inLine(e, o, d, sk.range, sk.w)) { hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a, true); stunFoe(G, a, e, sk.stun); }
    lineFx(G, o, d, sk.range, sk.w, 'tank');
  },
  quake(G, a, aim, sk) {
    const d = aimDir(G, a, aim), ang = Math.atan2(d.y, d.x);
    for (const e of G.enemies) if (e.alive && inCone(e, a, ang, sk.half, sk.range)) { hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a, true); e.fix = a; e.fixT = sk.dur; }
    coneFx(G, a, ang, sk.half, sk.range, 'tank'); shake(G, .2);
  },
  guard(G, a, aim, sk) { const t = aimAlly(G, a, aim, true); t.shield = Math.max(t.shield, sk.amt * a.pow); if (t !== a) beam(G, a, t, 'tank'); ring(G, t.x, t.y, 8, 30, 'tank'); },
  tankUlt(G, a, aim, sk) { for (const e of G.enemies) { e.fix = a; e.fixT = sk.dur; } for (const p of G.actors) if (p.alive) p.shield = Math.max(p.shield, sk.amt * a.pow); ring(G, a.x, a.y, 10, 170, 'tank', .55); },
  anchor(G, a, aim, sk) {
    const t = a.target && a.target.alive ? a.target : nearestFoe(G, a, sk.range), p = aimPoint(G, a, aim, sk.range, t); if (!p) return fail(G, a, '沒有目標');
    for (const e of G.enemies) if (e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= sk.rad + e.r) { hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a, true); stunFoe(G, a, e, sk.stun); }
    ring(G, p.x, p.y, 10, sk.rad, 'tank', .5); shake(G, .5);
  },
  mend(G, a, aim, sk) {
    let t = aim && aim.k === 'id' && aim.id < 0 ? G.actors[-aim.id - 1] : null; if (t && !t.alive) t = null;
    if (!t) { let br = 1; for (const p of G.actors) { if (!p.alive) continue; const r = p.hp / p.maxHp; if (r < br) { br = r; t = p; } } }
    if (!t) return fail(G, a, '隊友都是滿血');
    healActor(G, t, sk.amt * a.pow, a); if (t !== a) beam(G, a, t, 'heal'); ring(G, t.x, t.y, 6, 22, 'heal');
  },
  ring(G, a, aim, sk) { for (const p of G.actors) if (p.alive && dist(a, p) <= sk.rad) healActor(G, p, sk.amt * a.pow, a); ring(G, a.x, a.y, 10, sk.rad, 'heal', .45); },
  wave(G, a, aim, sk) {
    const d = aimDir(G, a, aim);
    for (const e of G.enemies) if (e.alive && inLine(e, a, d, sk.range, sk.w)) hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a, true);
    for (const p of G.actors) if (p.alive && p !== a && inLine(p, a, d, sk.range, sk.w)) healActor(G, p, sk.amt * a.pow, a);
    lineFx(G, a, d, sk.range, sk.w, 'heal');
  },
  pool(G, a, aim, sk) {
    const p = aimPoint(G, a, aim, sk.range, aimAlly(G, a, null, false));
    G.zones.push({ id: G.nextId++, friendly: true, heal: true, type: 'circle', x: p.x, y: p.y, r: sk.rad, t: 0, dur: sk.dur, tick: 0, dmg: sk.amt * a.pow, src: a, ign: new Set() });
  },
  barrier(G, a, aim, sk) { const t = aimAlly(G, a, aim, false); t.shield = Math.max(t.shield, sk.amt * a.pow); if (t !== a) beam(G, a, t, 'heal'); ring(G, t.x, t.y, 8, 30, 'heal'); },
  healUlt(G, a, aim, sk) { for (const p of G.actors) { if (!p.alive) revive(G, p); else healActor(G, p, p.maxHp * sk.pct, a); } ring(G, a.x, a.y, 10, 240, 'heal', .7); },
  surge(G, a, aim, sk) { for (const p of G.actors) if (p.alive) { p.shield = Math.max(p.shield, sk.amt * a.pow); p.hotT = sk.dur; p.hotPer = p.maxHp * sk.pct; } ring(G, a.x, a.y, 10, 240, 'heal', .7); },
  blast(G, a, aim, sk) { const t = aimEnemy(G, a, aim, sk.range); if (!t) return fail(G, a, '離目標太遠'); shoot(G, a, t, a.def.atk * a.pow * sk.mul, true); },
  roll(G, a, aim) {
    let mx = a.ctrl.mx, my = a.ctrl.my, m = Math.hypot(mx, my);
    if (aim && aim.k === 'd' && Math.hypot(aim.x, aim.y) > .001) { mx = aim.x; my = aim.y; m = Math.hypot(mx, my); }   // an aimed roll goes where you pointed
    else if (m < .2) { mx = -Math.cos(a.face); my = -Math.sin(a.face); m = 1; }
    a.rvx = mx / m * 400; a.rvy = my / m * 400; a.rollT = .26; a.iframe = .42;
  },
  pierce(G, a, aim, sk) {
    const d = aimDir(G, a, aim);
    for (const e of G.enemies) if (e.alive && inLine(e, a, d, sk.range, sk.w)) hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a, true);
    lineFx(G, a, d, sk.range, sk.w, 'ember');
  },
  volley(G, a, aim, sk) {
    const d = aimDir(G, a, aim), ang = Math.atan2(d.y, d.x);
    for (const e of G.enemies) if (e.alive && inCone(e, a, ang, sk.half, sk.range)) hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a, true);
    coneFx(G, a, ang, sk.half, sk.range, 'ember');
  },
  mark(G, a, aim, sk) { const t = aimEnemy(G, a, aim, sk.range); if (!t) return fail(G, a, '離目標太遠'); t.vulnT = sk.dur; text(G, t.x, t.y - t.r - 24, '獵印', 'ember', 14, 1.1); ring(G, t.x, t.y, t.r, t.r + 20, 'ember'); },
  dpsUlt(G, a, aim, sk) {
    const t = a.target && a.target.alive ? a.target : nearestFoe(G, a, sk.range), p = aimPoint(G, a, aim, sk.range, t); if (!p) return fail(G, a, '沒有目標');
    G.zones.push({ id: G.nextId++, friendly: true, type: 'circle', x: p.x, y: p.y, r: sk.rad, t: 0, dur: sk.dur, tick: 0, dmg: a.def.atk * a.pow * sk.mul, src: a, ign: new Set() });
  },
  sunshot(G, a, aim, sk) {
    const d = aimDir(G, a, aim);
    for (const e of G.enemies) if (e.alive && inLine(e, a, d, sk.range, sk.w)) hurtEnemy(G, e, a.def.atk * a.pow * sk.mul, a, true);
    lineFx(G, a, d, sk.range, sk.w, 'brass'); shake(G, .4);
  }
};
function tryCast(G, a, i, aim) {
  const sk = a.skills[i]; if (!a.alive || !sk) return false;
  if (sk.ult) { if (a.ult < 100) return false; } else if (a.cds[i] > 0) return false;
  if (SK[sk.fn || sk.id](G, a, aim || null, sk) === false) return false;
  if (sk.ult) a.ult = 0; else a.cds[i] = sk.cd * a.mods.cdr * (a.mods.cd[sk.id] || 1);
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
  if (G.mode === 'field' || G.layout) {      // out here, and in a laid-out dungeon, you only fight what is in the fight, or what you tapped
    const t0 = a.target; if (t0 && (!t0.alive || t0.ret || (!t0.engaged && a.pick !== t0.id))) a.target = null;
    if (!a.target) { let bd = 1e9; for (const e of G.enemies) if (e.alive && e.engaged && (G.layout || e.threat.has(a))) { const d = dist(a, e); if (d < bd) { bd = d; a.target = e; } } }
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
  const lead = G.layout ? G.actors.find(p => p.human && p.alive && p !== a) : null, en = G.layout && lead ? G.enemies.filter(e => e.engaged) : G.enemies; let tg = null;      // in a layout the AI follows a person and fights what that person's group is fighting
  if (a.cls === 'tank') {
    let ld = 1e9; for (const e of en) if (e.alive && e.target && e.target !== a) { const d = dist(a, e); if (d < ld) { ld = d; tg = e; } }
    if (!tg) tg = (G.boss && G.boss.alive) ? G.boss : (a.target && a.target.alive ? a.target : nearest(a, en));
  } else {
    const pr = e => e.def.caster ? 0 : e.boss ? 2 : 1; let bs = 1e9;
    for (const e of en) { if (!e.alive) continue; const s = pr(e) * 1e6 + e.hp; if (s < bs) { bs = s; tg = e; } }
  }
  a.target = tg;
  if (lead) {      // the AI has no way of finding a path round a wall: when it has fallen far behind it simply catches up
    const d = dist(a, lead); if (d > 230) { a.x = clamp(lead.x + (a.idx - 1.5) * 22, 20, G.bw - 20); a.y = clamp(lead.y + 30, 20, G.bh - 20); ring(G, a.x, a.y, 4, 22, a.def.color, .3); }
    if (!tg) { const want = 40 + a.idx * 12; if (d > want && d <= 230) { c.mx = (lead.x - a.x) / d; c.my = (lead.y - a.y) / d; } return; }
  }
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
    if (m > .05) { const sp = a.def.speed * a.mods.speed; a.x += mx * sp * dt; a.y += my * sp * dt; if (!a.target) a.face = Math.atan2(my, mx); }
  }
  a.x = clamp(a.x, a.r + 6, G.bw - a.r - 6); a.y = clamp(a.y, a.r + (G.F ? 6 : 36), G.bh - a.r - 8);
  if (G.F) pushOut(a, G.F);
  if (a.target) a.face = Math.atan2(a.target.y - a.y, a.target.x - a.x);
  if (c.healOn) { const k = a.skills.findIndex(q => q.aim === 'ally'); if (k >= 0) tryCast(G, a, k, { k: 'id', id: -(c.healOn.idx + 1) }); c.healOn = null; }   // a tap on a party frame
  for (let i = 0; i < 4; i++) if (c.cast[i]) { const aim = c.aim[i]; c.cast[i] = false; c.aim[i] = null; tryCast(G, a, i, aim); }
  if (c.pot) {
    c.pot = false;
    if (a.potions <= 0) fail(G, a, '這場的藥水用過了');
    else if (a.hp >= a.maxHp) fail(G, a, '血是滿的');
    else { const real = Math.min(a.maxHp * TUNE.potionHeal, a.maxHp - a.hp); a.potions--; a.stats.pots++; a.hp += real; ev(G, { k: 'heal', i: a.idx, v: R(real), by: a.idx }); ring(G, a.x, a.y, 6, 30, 'heal', .4); }
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
  if (G.layout && !e.engaged && !delveMob(G, e, dt)) return;
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
  else { e.atkT -= dt; if (e.atkT <= 0) { e.atkT = e.def.aspd / (e.tm.enraged ? e.tm.rage : 1); hurtActor(G, tg, e.dmg * (e.boss ? bossMul(G) : 1) * rand(.9, 1.1), false); ring(G, tg.x, tg.y, 4, 16, 'danger', .18); } }
  if (e.mv) runMoves(G, e, dt, tg);
  if (e.def.elite) {      // the brute slams the ground under whoever it is chasing
    e.tm.slam = (e.tm.slam === undefined ? 4 : e.tm.slam) - dt;
    if (e.tm.slam <= 0) { e.tm.slam = 6; addZone(G, { type: 'circle', x: tg.x, y: tg.y, r: 62, dur: 1.5, dmg: 130 * lvF(e.lvl) }); e.cast = { name: '砸地', t: 0, dur: 1.5, kickable: false }; }
  }
}
function runMoves(G, b, dt, tg) {
  const list = b.def.moves, sp = b.tm.enraged ? b.tm.rage : 1, hit = v => v * G.es * bossMul(G);
  for (let i = 0; i < list.length; i++) {
    const m = list[i], st = b.mv[i]; if (!st) continue;
    if (m.t === 'adds') { if (!st.used && b.hp < b.maxHp * m.at) { st.used = true; if (m.say) banner(G, m.say); const kind = ENEMY[m.kind] && !ENEMY[m.kind].boss ? m.kind : 'grunt'; for (let k = 0; k < m.n; k++) { const side = (k % 2 ? 1 : -1) * (54 + 34 * (k >> 1)), ad = G.layout ? mkEnemy(G, kind, clamp(b.x + side, 20, G.bw - 20), clamp(b.y - 40, 20, G.bh - 20)) : mkEnemy(G, kind, k % 2 ? W - 60 - 34 * (k >> 1) : 60 + 34 * (k >> 1), 70); if (G.layout) { ad.grp = b.grp; ad.engaged = true; ad.home = { x: ad.x, y: ad.y }; ad.threat.set(tg, 1); } } } }
    else if (m.t === 'enrage') { if (!st.used && b.hp < b.maxHp * m.at) { st.used = true; b.tm.enraged = true; b.tm.rage = m.mul; if (m.say) banner(G, m.say); ring(G, b.x, b.y, b.r, 120, 'danger', .6); } }
    else st.t -= dt * sp;
  }
  for (let i = 0; i < list.length; i++) {
    const m = list[i], st = b.mv[i]; if (!st || m.t === 'adds' || m.t === 'enrage' || st.t > 0) continue;
    st.t = m.every;
    if (m.t === 'roar') { b.cast = { name: m.name || '吼叫', t: 0, dur: m.cast, kickable: true, done: () => { for (const a of G.actors) hurtActor(G, a, hit(m.dmg), false); ring(G, b.x, b.y, 20, 280, 'danger', .6); shake(G, .5); } }; return; }
    if (m.t === 'cone') { addZone(G, { type: 'cone', x: b.x, y: b.y, ang: Math.atan2(tg.y - b.y, tg.x - b.x), half: m.half, len: m.len, dur: m.cast, dmg: hit(m.dmg) }); b.cast = { name: m.name || '重擊', t: 0, dur: m.cast, kickable: false }; return; }
    if (m.t === 'nova') { addZone(G, { type: 'circle', x: b.x, y: b.y, r: m.r, dur: m.cast, dmg: hit(m.dmg) }); b.cast = { name: m.name || '震盪', t: 0, dur: m.cast, kickable: false }; return; }
    if (m.t === 'circles') { let pool = G.actors.filter(a => a.alive && a !== tg); if (!pool.length) pool = [tg]; pool.sort(() => Math.random() - .5);
      for (const a of pool.slice(0, m.n + (b.tm.enraged ? 1 : 0))) addZone(G, { type: 'circle', x: a.x, y: a.y, r: m.r, dur: m.cast, dmg: hit(m.dmg) }); }
  }
}
function updWorld(G, dt) {
  const en = G.enemies;
  for (let i = 0; i < en.length; i++) for (let j = i + 1; j < en.length; j++) {
    const a = en[i], b = en[j], d = dist(a, b) || .01, ov = a.r + b.r - d; if (ov <= 0) continue;
    const ux = (a.x - b.x) / d, uy = (a.y - b.y) / d, wa = a.boss ? 0 : b.boss ? 1 : .5;
    a.x += ux * ov * wa; a.y += uy * ov * wa; b.x -= ux * ov * (1 - wa); b.y -= uy * ov * (1 - wa);
  }
  for (const e of en) { e.x = clamp(e.x, e.r, G.bw - e.r); e.y = clamp(e.y, e.r + (G.F ? 0 : 30), G.bh - e.r); if (G.F) pushOut(e, G.F); }
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
  if (G.state === 'over' || G.state === 'won') return;
  // a win does not stop the world: the clock stops, everyone gets up, and a portal opens for whoever wants to leave
  G.state = win ? 'won' : 'over'; G.result = { win, onTime: win && G.t <= G.limit, t: G.t }; if (win && !G.portal) G.portal = { x: PORTAL.x, y: PORTAL.y };
  if (win) for (const a of G.actors) { if (!a.alive) revive(G, a); a.target = null; }
  banner(G, win ? (G.did === 'tower' ? '莫葛沉回海底' : `${G.D.name}　通關`) : '全隊倒下', 1500);
}
/* ---------- field rules ---------- */
/* Returns true when the creature should fight this step; otherwise it has already wandered or walked home. */
function fieldMob(G, e, dt) {
  if (e.evm) { const foe = nearest(e, present(G)); if (!foe) return false; if (!e.threat.size) e.threat.set(foe, 1); return true; }      // surge creatures never give up
  const home = e.home, dHome = Math.hypot(e.x - home.x, e.y - home.y);
  if (e.ret) {
    const d = dHome || 1, sp = e.def.speed * 1.6 * dt; e.x += (home.x - e.x) / d * Math.min(sp, d); e.y += (home.y - e.y) / d * Math.min(sp, d);
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * .5 * dt); if (dHome < 8) { e.ret = false; e.hp = e.maxHp; }
    return false;
  }
  if (!e.engaged) {
    const near = nearest(e, G.actors);
    if (near && !inCamp(G, near) && dist(e, near) < e.def.aggro + near.r) { e.engaged = true; e.threat.set(near, (e.threat.get(near) || 0) + 1); }
    else if (e.threat.size) e.engaged = true;          // somebody hit it from a distance
    else {
      if (e.wp) {      // on patrol: wherever it is pulled from becomes the place it comes back to
        const p = e.wp[e.wi], n = e.wp.length;
        e.wst = (e.wst || 0) + dt;      // a point that cannot be reached, behind a rock say, is given up on after a while
        if (Math.hypot(p.x - e.x, p.y - e.y) < 6 || e.wst > 14) { e.wst = 0; if (e.loop) e.wi = (e.wi + 1) % n; else { if (e.wi + e.wd < 0 || e.wi + e.wd >= n) e.wd = -e.wd; e.wi += e.wd; } }
        const q = e.wp[e.wi], dq = Math.hypot(q.x - e.x, q.y - e.y) || 1, sp = Math.min(e.def.speed * .5 * dt, dq); e.x += (q.x - e.x) / dq * sp; e.y += (q.y - e.y) / dq * sp; e.face = Math.atan2(q.y - e.y, q.x - e.x);
        e.home = { x: e.x, y: e.y }; return false;
      }
      e.wt -= dt; if (e.wt <= 0) { e.wt = rand(2, 5); const an = rand(0, TAU), rr = rand(0, 40); e.wx = home.x + Math.cos(an) * rr; e.wy = home.y + Math.sin(an) * rr; }
      const d = Math.hypot(e.wx - e.x, e.wy - e.y); if (d > 3) { e.x += (e.wx - e.x) / d * e.def.speed * .35 * dt; e.y += (e.wy - e.y) / d * e.def.speed * .35 * dt; e.face = Math.atan2(e.wy - e.y, e.wx - e.x); }
      return false;
    }
  }
  let foe = false; for (const p of e.threat.keys()) if (p.alive && !inCamp(G, p)) { foe = true; break; }
  if (dHome > e.def.leash || !foe) { e.engaged = false; e.ret = true; e.threat.clear(); e.cast = null; e.fix = null; e.target = null; return false; }   // dragged too far, or nobody left to fight
  return true;
}
function fieldActor(G, a, dt) {
  if (a.out) return;
  if (!a.alive) {
    a.gather = null; a.downT += dt;
    if (a.downT >= 3) { a.downT = 0; a.alive = true; a.hp = a.maxHp; const E = G.ev && !G.ev.done ? G.ev : null;      // during a surge you get back up at its edge, not at the far camp
      a.x = E ? E.x + (a.idx % 2 ? 1 : -1) * 40 : G.F.spawn[0]; a.y = E ? Math.min(G.F.h - 20, E.y + E.r + 40) : G.F.spawn[1]; a.target = null; ev(G, { k: 'woke', i: a.idx, ev: E ? 1 : 0 }); }
    return;
  }
  const hunted = G.enemies.some(e => e.engaged && e.threat.has(a));
  a.calm = hunted ? 0 : a.calm + dt;
  if (a.calm > 3 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * .08 * dt);   // catch your breath between fights
  // gathering: stand still next to something worth picking up
  const still = Math.hypot(a.ctrl.mx, a.ctrl.my) < .05 && a.rollT <= 0; let node = null;
  if (still && !hunted) for (const n of G.nodes) if (n.cd[a.idx] <= 0 && Math.hypot(n.x - a.x, n.y - a.y) < 38) { node = n; break; }
  if (!node) { a.gather = null; return; }
  if (!a.gather || a.gather.id !== node.id) a.gather = { id: node.id, t: 0 };
  a.gather.t += dt;
  // done: the spot regrows for this person only
  if (a.gather.t >= TUNE.gatherTime) { node.cd[a.idx] = TUNE.nodeRespawn; a.gather = null; ev(G, { k: 'gathered', id: node.id, type: node.type, by: a.idx }); }
}
function stepField(G, dt) {
  G.t += dt;
  const here = present(G), size = G.ev ? 1 : Math.max(1, here.length), plv = partyLevel(G);      // in a surge field the ordinary creatures stay solo-sized
  for (const a of here) playerThink(G, a, dt);
  for (const a of here) updActor(G, a, dt);
  for (const e of G.enemies) updEnemy(G, e, dt);
  updWorld(G, dt);
  G.enemies = G.enemies.filter(e => e.alive);
  G.respawns = G.respawns.filter(r => { if (G.t < r.at || here.some(a => Math.hypot(a.x - r.home.x, a.y - r.home.y) < 170)) return true; spawnMob(G, r.pk, r.home); return false; });
  // creatures that are not in a fight follow the party's level, inside their pack's range, and its size
  for (const e of G.enemies) if (!e.evm && !e.engaged && !e.ret) { const pkd = G.F.packs[e.pk]; if (!pkd) continue; const want = mobLevel(pkd, plv); if (e.lvl !== want || e.size !== size) scaleMob(e, want, size); }
  for (const n of G.nodes) for (let i = 0; i < n.cd.length; i++) if (n.cd[i] > 0) n.cd[i] -= dt;
  stepEvent(G, dt);
  for (const a of G.actors) fieldActor(G, a, dt);
}
/* ---------- the tide surge: a public event in the field ----------
 * Three waves come ashore at one spot, the last led by a brute. Creatures are sized for however many people are
 * there when a wave starts, at the group's level held between EV_MIN and EV_MAX. */
const EV_WAVES = [[['crab', 3]], [['crab', 2], ['acolyte', 1]], [['brute', 1], ['crab', 1]]], EV_MIN = 3, EV_MAX = 16;
function stepEvent(G, dt) {
  const E = G.ev; if (!E || E.done) return; const here = present(G); if (!here.length) return;
  E.t += dt; if (G.enemies.some(e => e.evm && e.alive)) return;
  if (E.wave >= EV_WAVES.length - 1) { E.done = true; ev(G, { k: 'event-done' }); return; }
  E.gap -= dt; if (E.gap > 0) return; E.gap = 2.5; E.wave++;
  const size = here.length, lvl = clamp(partyLevel(G), EV_MIN, EV_MAX); let i = 0;
  for (const [kind, n] of EV_WAVES[E.wave]) if (ENEMY[kind]) for (let k = 0; k < n + (baseOf(kind) === 'crab' ? Math.floor((size - 1) / 2) : 0); k++) {
    const an = (i++) * 2.4 + E.wave, e = mkEnemy(G, kind, E.x + Math.cos(an) * 92, E.y + Math.sin(an) * 92);
    e.evm = true; e.pk = -1; e.home = { x: E.x, y: E.y }; e.wx = e.x; e.wy = e.y; e.wt = 0; e.engaged = true; e.ret = false; scaleMob(e, lvl, 1 + (size - 1) * .7);      // a little gentler per head than a party's own field
  }
  banner(G, E.wave === EV_WAVES.length - 1 ? '鏽錨巨蟹上岸了' : `漲潮　第 ${E.wave + 1} 波`, 2000);
}
/* What everyone who saw a surge through gets. */
function eventReward(p) {
  fixProfile(p); const mats = { shard: 1, scrap: 4, herb: 2 }; grant(p, mats); const x = addXp(p, 150 + 25 * p.cl), coin = addCoin(p, 40);
  const item = Math.random() < DROP.event ? giveItem(p, rollItem(fieldIlvl(clamp(p.cl, EV_MIN, EV_MAX)) + 2, null, DROP.eventSet)) : null;
  return { mats, xp: x.xp, ups: x.ups, coin, item };
}

/* What a gather or a kill gives. The server rolls this for online accounts. */
function fieldYield(what, key) {
  const m = {};
  if (what === 'gather') { if (key === 'herb') m.herb = 1 + (Math.random() < .35 ? 1 : 0); else if (key === 'wreck') m.scrap = 2 + Math.floor(Math.random() * 2); else if (key === 'salt') m.salt = 1; }
  else if (baseOf(key) === 'crab') { if (Math.random() < .6) m.scrap = 1; }
  else if (baseOf(key) === 'acolyte') { if (Math.random() < .5) m.salt = 1; }
  return m;
}
/* the name of the pack a field creature came from, when the pack has one: what a kill quest looks for */
const packTag = (map, pk) => { const d = Number.isInteger(pk) ? (MAPS[map] || FIELD).packs[pk] : null; return (d && d.name) || ''; };
function grant(p, mats) { fixProfile(p); for (const k of Object.keys(mats)) if (k in MATS) p.inv[k] = Math.min(MAT_CAP, p.inv[k] + mats[k]); }
/* Everything one gather or one kill gives this profile: materials and experience. For a kill, pk says which pack the
 * creature belonged to; null when the claim does not name a real pack of that creature. */
function fieldGain(p, what, key, pk, map) {
  fixProfile(p); let xp = 5, ml = 0;
  if (what === 'kill') { const def = Number.isInteger(pk) ? (MAPS[map] || FIELD).packs[pk] : null; if (!def || def.kind !== key) return null; ml = mobLevel(def, p.cl); xp = xpForKill(key, ml, p.cl); }
  const mats = fieldYield(what, key); grant(p, mats); const x = addXp(p, xp);
  const coin = what === 'kill' && Math.random() < .6 ? addCoin(p, 1 + Math.floor(Math.random() * 2) + Math.floor(p.cl / 6)) : 0;      // creatures sometimes carry a little coin
  const item = ml && Math.random() < DROP.field ? giveItem(p, rollItem(fieldIlvl(ml), null, DROP.fieldSet)) : null;      // and, now and then, something to wear
  return { mats, xp: x.xp, ups: x.ups, coin, item };
}

function step(G, dt) {
  if (G.mode === 'field') return stepField(G, dt);
  if (G.state === 'countdown') { G.cd -= dt; if (G.cd <= 0) { G.cd = 0; G.state = 'run'; nextWave(G); } return; }
  if (G.state === 'won') {      // nothing left to fight: people walk about, the others wait
    for (const a of G.actors) { if (a.human && !G.auto) playerThink(G, a, dt); else { a.ctrl.mx = a.ctrl.my = 0; a.ctrl.cast.fill(false); } }
    for (const a of G.actors) updActor(G, a, dt);
    updWorld(G, dt); return;
  }
  if (G.state !== 'run') return;
  G.t += dt;
  for (const a of G.actors) { if (a.human && !G.auto) playerThink(G, a, dt); else botThink(G, a, dt); }
  for (const a of G.actors) updActor(G, a, dt);
  for (const e of G.enemies) updEnemy(G, e, dt);
  updWorld(G, dt);
  G.enemies = G.enemies.filter(e => e.alive);
  if (G.actors.every(a => !a.alive)) return finish(G, false);
  if (G.layout) return stepDelve(G, dt);
  if (!G.enemies.length) {
    if (G.wave >= G.D.waves.length - 1) return finish(G, true);
    if (G.gap == null) { G.gap = 1.8; for (const a of G.actors) if (!a.alive) revive(G, a); }
    G.gap -= dt; if (G.gap <= 0) { G.gap = null; nextWave(G); }
  }
}

/* ---------- progression: the same rules on the server and in the offline client ---------- */
const LOOT = { w: ['武器'], a: ['護甲'], t: ['飾品'] };
const MATS = { scrap: '鏽鐵屑', salt: '鹽晶', shard: '沉鐘碎片', herb: '潮草' };
const MAT_CAP = 9999;
const ilvlOf = gear => Math.round((gear.w + gear.a + gear.t) / 3);
const powerOf = gear => 1 + (ilvlOf(gear) - 10) * .02;
const forgeIlvl = lvl => 10 + lvl * 4 + 3;      // what the forge makes at this tower level: a good drop, never the best
const gearCap = lvl => 10 + lvl * 4 + 7;        // how far tempering can push a slot at this tower level
const charPower = p => powerOf(p.gear) * lvF(p.cl);     // what a character brings to a fight: gear and level
function newProfile() { return { lvl: 1, cl: 1, xp: 0, gear: { w: 10, a: 10, t: 10 }, eq: { w: { n: '', q: 0 }, a: { n: '', q: 0 }, t: { n: '', q: 0 } }, bag: [], dl: {}, best: {}, runs: 0, inv: { scrap: 0, salt: 0, shard: 0, herb: 0, potion: 0 }, q: null, loadout: {}, coin: 0, talents: {} }; }
const COIN_CAP = 9999999;
function addCoin(p, n) { n = Math.max(0, Math.round(n)); p.coin = Math.min(COIN_CAP, (p.coin || 0) + n); return n; }
function fixProfile(p) {   // fill in anything an older save does not have
  const d = newProfile();
  for (const k of Object.keys(d)) if (p[k] == null) p[k] = d[k];
  for (const k of Object.keys(d.inv)) if (!(p.inv[k] >= 0)) p.inv[k] = 0;
  p.coin = p.coin >= 0 ? Math.min(COIN_CAP, Math.floor(p.coin)) : 0;
  { const t = {}, old = p.talents && typeof p.talents === 'object' ? p.talents : {};      // keep only real talents at real ranks
    for (const list of Object.values(TALENTS)) for (const d of list) if (Number.isInteger(old[d.id]) && old[d.id] > 0) t[d.id] = Math.min(d.max, old[d.id]); p.talents = t; }
  { const bag = [], eq = {}, old = p.eq && typeof p.eq === 'object' ? p.eq : {};      // keep only real items
    if (Array.isArray(p.bag)) for (const o of p.bag.slice(0, TUNE.bagCap)) { const it = fixItem(o); if (it) bag.push(it); }
    for (const k of SLOTS) { const o = old[k]; eq[k] = o && typeof o === 'object' && typeof o.n === 'string' && NAME_SLOT[o.n] === k ? { n: o.n, q: qInt(o.q, 0, 2) } : { n: '', q: 0 }; }
    p.bag = bag; p.eq = eq; }
  { const dl = {}, old = isObj(p.dl) ? p.dl : {}; for (const k of Object.keys(DUNGEONS)) if (k !== 'tower' && Number.isInteger(old[k]) && old[k] > 1) dl[k] = Math.min(50, old[k]); p.dl = dl; }      // floors reached in the other dungeons
  p.cl = Number.isInteger(p.cl) ? clamp(p.cl, 1, TUNE.maxLevel) : 1; p.xp = p.xp >= 0 && p.cl < TUNE.maxLevel ? Math.min(Math.floor(p.xp), xpNeed(p.cl)) : 0;
  fixQuests(p);
  const lo = {}, old = p.loadout && typeof p.loadout === 'object' ? p.loadout : {};      // keep only loadouts that are still allowed
  for (const k of Object.keys(CLASSES)) if (validLoadout(k, old[k], p.cl)) lo[k] = old[k].slice();
  p.loadout = lo;
  return p;
}
function addXp(p, n) {
  n = Math.max(0, Math.round(n)); let ups = 0; if (p.cl >= TUNE.maxLevel || !n) return { xp: 0, ups: 0 };
  p.xp += n; while (p.cl < TUNE.maxLevel && p.xp >= xpNeed(p.cl)) { p.xp -= xpNeed(p.cl); p.cl++; ups++; }
  if (p.cl >= TUNE.maxLevel) p.xp = 0; return { xp: n, ups };
}
/* ---------- gear as things you can hold ----------
 * An item is { s: slot, il: item level, q: quality 0 to 2, n: name }. What you wear is p.gear (the item levels, which
 * are what make you stronger) together with p.eq (each piece's name and quality). Everything else waits in p.bag.
 * A name can belong to a set: wearing two or three pieces of one set adds its bonuses. */
const SLOTS = ['w', 'a', 't'], QUALITY = ['普通', '精良', '稀有'];
const PLAIN = { w: ['鏽潮錨刃', '沉鐘之舌', '拆船鉤'], a: ['鹽殼護肩', '潮紋斗篷', '纜繩綁腿'], t: ['生鏽的羅盤', '舊船釘', '潮音貝'] };
const SETS = {
  warden: { name: '看守者', pieces: { w: '看守者鐘錘', a: '看守者鍊甲', t: '看守者徽記' }, two: ['hp', .06, '生命 +6%'], three: ['taken', -.05, '受到的傷害 -5%'] },
  lamp: { name: '霧燈', pieces: { w: '霧燈之芯', a: '霧燈披風', t: '霧燈碎片' }, two: ['speed', .05, '移動速度 +5%'], three: ['dmg', .08, '造成的傷害 +8%'] },
  tide: { name: '潮鳴', pieces: { w: '潮鳴之舌', a: '潮鳴法衣', t: '潮鳴鐘錘' }, two: ['heal', .08, '治療量 +8%'], three: ['cdr', -.06, '所有技能冷卻 -6%'] }
};
/* How often gear drops, and how often a drop is a set piece. */
const DROP = { field: .05, fieldSet: .08, event: .4, eventSet: .3, bossSet: .4, trashSet: .1 };
const NAME_SLOT = {}, NAME_SET = {}, PLAIN_FIRST = () => ({ w: PLAIN.w[0], a: PLAIN.a[0], t: PLAIN.t[0] });
function indexNames() {
  for (const k of Object.keys(NAME_SLOT)) delete NAME_SLOT[k]; for (const k of Object.keys(NAME_SET)) delete NAME_SET[k];
  for (const k of SLOTS) { for (const n of PLAIN[k]) NAME_SLOT[n] = k; NAME_SLOT['工坊' + LOOT[k][0]] = k; NAME_SLOT['用舊的' + LOOT[k][0]] = k; }
  for (const id of Object.keys(SETS)) for (const k of SLOTS) { NAME_SLOT[SETS[id].pieces[k]] = k; NAME_SET[SETS[id].pieces[k]] = id; }
}
indexNames();
const fieldIlvl = mobLvl => 10 + Math.round(mobLvl * 1.5) + Math.floor(Math.random() * 3);
function rollItem(base, slot, setChance) {
  const k = slot || pick(SLOTS), q = Math.random() < .06 ? 2 : Math.random() < .25 ? 1 : 0;
  return { s: k, il: base + q * 2, q, n: Math.random() < (setChance || 0) ? (SETS[pick(Object.keys(SETS))] || { pieces: PLAIN_FIRST() }).pieces[k] : pick(PLAIN[k]) };
}
function fixItem(o) { return o && typeof o === 'object' && typeof o.n === 'string' && SLOTS.includes(o.s) && NAME_SLOT[o.n] === o.s ? { s: o.s, il: qInt(o.il, 10, 999), q: qInt(o.q, 0, 2), n: o.n } : null; }
const itemPrice = it => Math.round(it.il * (1 + it.q) * 1.5);       // what the merchant pays for it
const itemSet = it => NAME_SET[it.n] || '';
const itemText = it => `${it.n}（${LOOT[it.s][0]}・裝等 ${it.il}${it.q ? '・' + QUALITY[it.q] : ''}）`;
const wornItem = (p, k) => ({ s: k, il: p.gear[k], q: p.eq[k].q, n: p.eq[k].n || '用舊的' + LOOT[k][0] });
function setCount(p) { const n = {}; for (const k of SLOTS) { const id = p.eq && p.eq[k] ? NAME_SET[p.eq[k].n] : ''; if (id) n[id] = (n[id] || 0) + 1; } return n; }
/* Everything that changes how a character fights apart from raw power: talents plus set bonuses. */
function modsFor(p, cls) {
  const m = modsOf(p.talents, cls), n = setCount(p);
  for (const id of Object.keys(n)) { const d = SETS[id]; if (n[id] >= 2) m[d.two[0]] += d.two[1]; if (n[id] >= 3) m[d.three[0]] += d.three[1]; }
  return m;
}
/* For the bag screen: every set, which pieces are on, and what it gives. */
function setList(p) { const n = setCount(p); return Object.keys(SETS).map(id => { const d = SETS[id]; return { id, name: d.name, have: n[id] || 0, pieces: SLOTS.map(k => ({ s: k, n: d.pieces[k], on: !!p.eq && p.eq[k].n === d.pieces[k] })), two: d.two[2], three: d.three[2] }; }); }
/* Put an item in the bag. With no room left it is sold on the spot: returns the coins it became, 0 when it was kept. */
function stow(p, it) { if (p.bag.length < TUNE.bagCap) { p.bag.push(it); return 0; } return addCoin(p, itemPrice(it)); }
function wear(p, it) { p.gear[it.s] = it.il; p.eq[it.s] = { n: it.n, q: it.q }; }
/* A new item arrives. It is put on at once when it beats what is worn, unless that would break a set bonus;
 * otherwise it goes to the bag. Returns { it, up, old, sold }: sold is what the piece that found no room fetched. */
function giveItem(p, it) {
  fixProfile(p); const old = p.gear[it.s], was = NAME_SET[p.eq[it.s].n], keep = was && was !== NAME_SET[it.n] && setCount(p)[was] >= 2, up = it.il > old && !keep; let sold = 0;
  if (up) { const prev = wornItem(p, it.s); wear(p, it); if (old > 10) sold = stow(p, prev); }
  else sold = stow(p, it);
  return { it, up, old, sold };
}
function equipItem(p, i) {
  fixProfile(p); const it = Number.isInteger(i) ? p.bag[i] : null; if (!it) return { ok: false, msg: '背包裡沒有這件。' };
  const prev = wornItem(p, it.s), had = p.gear[it.s] > 10; wear(p, it); if (had) p.bag[i] = prev; else p.bag.splice(i, 1);
  return { ok: true, msg: `換上了${it.n}（裝等 ${it.il}）。` };
}
function sellItem(p, i) {
  fixProfile(p); const it = Number.isInteger(i) ? p.bag[i] : null; if (!it) return { ok: false, msg: '背包裡沒有這件。' };
  p.bag.splice(i, 1); const got = addCoin(p, itemPrice(it)); return { ok: true, msg: `賣掉${it.n}，拿到 ${got} 鐘幣。` };
}
/* What a won run leaves on the floor: `boss` pieces from 莫葛 and `trash` pieces from the creatures before him. */
function runDrops(lvl, r, boss, trash, firstSlot) {
  const out = [];
  for (let i = 0; i < boss; i++) out.push(rollItem(10 + lvl * 4 + Math.floor(Math.random() * 4) + (r.onTime ? 2 : 0), i === 0 ? firstSlot : null, DROP.bossSet));
  for (let i = 0; i < trash; i++) out.push(rollItem(8 + lvl * 4 + Math.floor(Math.random() * 3), null, DROP.trashSet));
  return out;
}
const bossDrops = humans => [1, 1, 2, 2, 3][clamp(humans, 0, 4)];      // how many pieces 莫葛 leaves for a group of this many people

/* r: { win, onTime, t }. Updates the profile p and returns { loot, mats, xp, ups, coin }: loot is the list of gear this
 * character got for themselves, each as giveItem() describes it. o.trash is how many creatures left something.
 * o.share means the group divides the gear afterwards, so none is handed out here. */
function applyResult(p, lvl, r, o) {
  fixProfile(p); o = o || {};
  const mats = r.win
    ? { scrap: 3 + Math.floor(Math.random() * 3) + Math.floor(lvl / 3), salt: 1 + (Math.random() < .5 ? 1 : 0), shard: r.onTime ? 1 : (Math.random() < .3 ? 1 : 0) }
    : { scrap: 1 + Math.floor(Math.random() * 2), salt: 0, shard: 0 };
  for (const k of Object.keys(mats)) p.inv[k] = Math.min(MAT_CAP, p.inv[k] + mats[k]);
  const x = addXp(p, r.win ? (100 + 50 * lvl) * (r.onTime ? 1.25 : 1) : 25), coin = addCoin(p, r.win ? (20 + 10 * lvl) * (r.onTime ? 1.25 : 1) : 5);
  if (!r.win) return { loot: [], mats, xp: x.xp, ups: x.ups, coin };
  p.runs++;
  // alone, the first piece leans towards your weakest slot
  const weak = Math.random() < .5 ? SLOTS.reduce((m, k) => p.gear[k] < p.gear[m] ? k : m, 'w') : null;
  const loot = o.share ? [] : runDrops(lvl, r, 1, clamp(o.trash | 0, 0, 6), weak).map(it => giveItem(p, it));
  const did = DUNGEONS[o.dungeon] ? o.dungeon : 'tower', bk = did === 'tower' ? lvl : did + ':' + lvl;
  if (!p.best[bk] || r.t < p.best[bk]) p.best[bk] = Math.round(r.t * 10) / 10;
  if (r.onTime) { const next = Math.max(floorOf(p, did), Math.min(50, lvl + 1)); if (did === 'tower') p.lvl = next; else p.dl[did] = next; }
  return { loot, mats, xp: x.xp, ups: x.ups, coin };
}

/* ---------- skill loadouts ---------- */
function loadoutOf(p, cls) { const ids = p.loadout && p.loadout[cls]; return validLoadout(cls, ids, p.cl || 1) ? ids.slice() : defaultLoadout(cls); }
function setLoadout(p, cls, ids) {
  fixProfile(p); if (!Object.prototype.hasOwnProperty.call(CLASSES, cls)) return { ok: false, msg: '沒有這個職業。' };
  if (!validLoadout(cls, ids, p.cl)) return { ok: false, msg: '這組技能不能用：要三個不重複的一般技能加一個大招，而且都已經解鎖。' };
  p.loadout[cls] = ids.slice(); return { ok: true, msg: '技能換好了。' };
}

/* ---------- talents on a profile ---------- */
function learnTalent(p, cls, id) {
  fixProfile(p); const d = (TALENTS[cls] || []).find(t => t.id === id); if (!d) return { ok: false, msg: '沒有這個天賦。' };
  const spent = talentSpent(p.talents), have = p.talents[id] || 0;
  if (spent >= talentPoints(p.cl)) return { ok: false, msg: '沒有天賦點了，升級會再得到一點。' };
  if (have >= d.max) return { ok: false, msg: `「${d.name}」已經點滿了。` };
  if (spent < d.row * 3) return { ok: false, msg: `這一排要先在別的天賦投入 ${d.row * 3} 點。` };
  p.talents[id] = have + 1; return { ok: true, msg: `「${d.name}」${have + 1} / ${d.max}。` };
}
function resetTalents(p) {
  fixProfile(p); if (!talentSpent(p.talents)) return { ok: false, msg: '還沒有點任何天賦。' };
  if (p.coin < TUNE.respecCost) return { ok: false, msg: `重置要 ${TUNE.respecCost} 鐘幣，你只有 ${p.coin}。` };
  p.coin -= TUNE.respecCost; p.talents = {}; return { ok: true, msg: `天賦重置了，花了 ${TUNE.respecCost} 鐘幣。` };
}

/* ---------- the merchant ---------- */
const SHOP = { buy: { potion: 60, herb: 12, salt: 16, scrap: 7 }, sell: { scrap: 2, salt: 4, herb: 3, shard: 35 } };
const itemName = k => k === 'potion' ? '潮息藥水' : MATS[k];
function shopBuy(p, key, n) {
  fixProfile(p); const price = Object.prototype.hasOwnProperty.call(SHOP.buy, key) ? SHOP.buy[key] : 0; if (!price || !Number.isInteger(n) || n < 1 || n > 99) return { ok: false, msg: '商人不賣這個。' };
  const cap = key === 'potion' ? TUNE.potionCap : MAT_CAP; if (p.inv[key] + n > cap) return { ok: false, msg: `${itemName(key)}帶不了那麼多，上限 ${cap}。` };
  if (p.coin < price * n) return { ok: false, msg: `鐘幣不夠，要 ${price * n}，你只有 ${p.coin}。` };
  p.coin -= price * n; p.inv[key] += n; return { ok: true, msg: `買了 ${itemName(key)} ×${n}，花了 ${price * n} 鐘幣。` };
}
function shopSell(p, key, n) {
  fixProfile(p); const price = Object.prototype.hasOwnProperty.call(SHOP.sell, key) ? SHOP.sell[key] : 0; if (!price || !Number.isInteger(n) || n < 1 || n > 9999) return { ok: false, msg: '商人不收這個。' };
  if (p.inv[key] < n) return { ok: false, msg: `你沒有那麼多${itemName(key)}。` };
  p.inv[key] -= n; const got = addCoin(p, price * n); return { ok: true, msg: `賣掉 ${itemName(key)} ×${n}，拿到 ${got} 鐘幣。` };
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
  else { result = `副本中回復 ${TUNE.potionHeal * 100}% 血量，每場限用 1 瓶`; if (p.inv.potion >= TUNE.potionCap) why = `最多帶 ${TUNE.potionCap} 瓶`; }
  if (!why && Object.keys(rc.cost).some(k => p.inv[k] < rc.cost[k])) why = '材料不夠';
  return { can: !why, why, result };
}
function craft(p, id) {
  const rc = RECIPES.find(r => r.id === id); if (!rc) return { ok: false, msg: '沒有這個配方。' };
  const info = recipeInfo(p, rc); if (!info.can) return { ok: false, msg: `做不了${rc.name}：${info.why}。` };
  for (const k of Object.keys(rc.cost)) p.inv[k] -= rc.cost[k];
  let made = null; if (rc.kind === 'forge') made = giveItem(p, { s: rc.slot, il: forgeIlvl(p.lvl), q: 0, n: '工坊' + LOOT[rc.slot][0] });
  else if (rc.kind === 'temper') p.gear[rc.slot] = Math.min(gearCap(p.lvl), p.gear[rc.slot] + 2);
  else p.inv.potion++;
  if (made && !made.up) return { ok: true, kind: rc.kind, msg: made.sold ? `做好了，可是背包滿了，直接賣了 ${made.sold} 鐘幣。` : `做好了。身上那件是套裝，所以新的先放進背包。` };
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
  { id: 'bell', title: '第一聲鐘響', goal: '通關沉鐘塔一次', need: 1, reward: { coin: 30, xp: 120, scrap: 6, salt: 2 }, inc: ev => isRun(ev) && ev.win ? 1 : 0 },
  { id: 'kick', title: '斷其咒語', goal: '成功打斷敵人的金色讀條 3 次', need: 3, reward: { coin: 30, xp: 120, salt: 3 }, inc: ev => isRun(ev) ? ev.kicks : 0 },
  { id: 'craft', title: '工坊開張', goal: '在背包裡製作任何一樣東西', need: 1, reward: { coin: 40, xp: 150, scrap: 8, salt: 2 }, inc: ev => ev.type === 'craft' ? 1 : 0 },
  { id: 'ontime', title: '搶在潮水之前', goal: '三分鐘內通關一次', need: 1, reward: { coin: 50, xp: 200, potion: 1 }, inc: ev => isRun(ev) && ev.onTime ? 1 : 0 },
  { id: 'clean', title: '乾淨的腳步', goal: '通關一場，而且整場沒有踩到紅圈', need: 1, reward: { coin: 60, xp: 250, shard: 1, scrap: 6 }, inc: ev => isRun(ev) && ev.win && ev.hits === 0 ? 1 : 0 },
  { id: 'lvl3', title: '更深一層', goal: '抵達第 3 層', need: 3, reward: { coin: 70, xp: 300, salt: 4, scrap: 8 }, value: p => p.lvl },
  { id: 'temper', title: '淬火', goal: '淬鍊任何一個部位一次', need: 1, reward: { coin: 70, xp: 300, shard: 2 }, inc: ev => ev.type === 'craft' && ev.kind === 'temper' ? 1 : 0 },
  { id: 'lvl5', title: '鐘塔中段', goal: '抵達第 5 層', need: 5, reward: { coin: 120, xp: 500, shard: 2, potion: 1, scrap: 12 }, value: p => p.lvl }
];
const WEEK = [
  { id: 'w-runs', title: '本週巡塔', goal: '這週通關 5 場', need: 5, reward: { coin: 80, xp: 300, scrap: 15, salt: 4 }, inc: ev => isRun(ev) && ev.win ? 1 : 0 },
  { id: 'w-kicks', title: '本週斷法', goal: '這週成功打斷 10 次', need: 10, reward: { coin: 60, xp: 250, salt: 5 }, inc: ev => isRun(ev) ? ev.kicks : 0 },
  { id: 'w-surge', title: '本週漲潮', goal: '這週在鏽灘撐過 2 次漲潮', need: 2, online: true, reward: { coin: 80, xp: 300, shard: 2 }, inc: ev => ev.type === 'event' ? 1 : 0 },
  { id: 'w-ontime', title: '本週準時', goal: '這週三分鐘內通關 3 場', need: 3, reward: { coin: 80, xp: 350, shard: 2 }, inc: ev => isRun(ev) && ev.onTime ? 1 : 0 }
];
const SIDE = [
  { id: 's-party', title: '結伴', goal: '和至少一位其他玩家一起通關', need: 1, online: true, reward: { coin: 50, xp: 200, scrap: 10, potion: 1 }, upd: (v, ev) => isRun(ev) && ev.win && ev.mates > 0 ? 1 : v },
  { id: 's-level', title: '站穩腳步', goal: '升到 5 級', need: 5, reward: { coin: 60, shard: 2, potion: 1 }, upd: (v, ev, p) => p.cl, have: v => v },
  { id: 's-gather', title: '拾荒', goal: '在鏽灘採集 6 次', need: 6, reward: { coin: 40, xp: 150, scrap: 6, herb: 2 }, upd: (v, ev) => ev.type === 'gather' ? Math.min(6, v + 1) : v },
  { id: 's-hunt', title: '清灘', goal: '在鏽灘擊倒 12 隻怪物', need: 12, reward: { coin: 50, xp: 200, salt: 4, scrap: 6 }, upd: (v, ev) => ev.type === 'kill' ? Math.min(12, v + 1) : v },
  { id: 's-friend', title: '留個名字', goal: '和一位玩家互相加為好友', need: 1, online: true, reward: { coin: 30, xp: 100, salt: 3 }, upd: (v, ev) => ev.type === 'friend' ? 1 : v }
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
const rewardText = r => Object.keys(r).map(k => `${k === 'xp' ? '經驗' : k === 'coin' ? '鐘幣' : k === 'potion' ? '潮息藥水' : MATS[k]} +${r[k]}`).join('、');
/* Everything the quest screen needs. online = false hides quests that need other players. */
function questList(p, now, online) {
  const q = fixQuests(p, now), items = [], m = MAIN[q.main];
  if (m) { const have = Math.min(m.need, m.value ? m.value(p) : q.mp); items.push({ id: m.id, group: 'main', title: m.title, goal: m.goal, have, need: m.need, ready: have >= m.need, claimed: false, reward: rewardText(m.reward) }); }
  for (const d of WEEK) { if (d.online && !online) continue; const have = q.week.p[d.id] || 0, claimed = !!q.week.c[d.id]; items.push({ id: d.id, group: 'week', title: d.title, goal: d.goal, have: claimed ? d.need : have, need: d.need, ready: !claimed && have >= d.need, claimed, reward: rewardText(d.reward) }); }
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
  for (const k of Object.keys(d.reward)) { if (k === 'xp') addXp(p, d.reward.xp); else if (k === 'coin') addCoin(p, d.reward.coin); else p.inv[k] = Math.min(k === 'potion' ? TUNE.potionCap : MAT_CAP, p.inv[k] + d.reward[k]); }
  if (it.group === 'main') { q.main++; q.mp = 0; } else if (it.group === 'week') q.week.c[id] = 1; else q.side[id] = -1;
  return { ok: true, msg: `「${it.title}」完成，領到 ${it.reward}。` };
}

/* ---------- network snapshot: compact arrays, read back by the client ---------- */
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
/* each seat's threat on a creature as a share of the highest, 0 to 100; 0 when nobody has any */
function threatList(G, e) { if (!e.threat.size) return 0; let top = 0; for (const v of e.threat.values()) if (v > top) top = v; if (top <= 0) return 0; return G.actors.map(a => { const v = e.threat.get(a); return v > 0 && a.alive ? R(v / top * 100) : 0; }); }
function snapshot(G) {
  return {
    tm: r2(G.t), st: G.state, cd: r2(G.cd), w: G.wave,
    a: G.actors.map(a => [r1(a.x), r1(a.y), R(a.hp), a.maxHp, a.alive ? 1 : 0, r2(a.face),
      (a.wallT > 0 ? 1 : 0) | (a.shield > 0 ? 2 : 0) | (a.iframe > 0 ? 4 : 0) | (a.rollT > 0 ? 8 : 0) | (a.human ? 16 : 0),
      a.target ? a.target.id : 0, a.cds.map(r1), R(a.ult), a.potions, a.gather ? [a.gather.id, r2(a.gather.t)] : 0, a.out ? 1 : 0]),
    e: G.enemies.map(e => [e.id, e.kind, r1(e.x), r1(e.y), R(e.hp), e.maxHp, r2(e.face), r2(Math.max(0, e.spawnT)), e.stun > 0 ? 1 : 0, e.tm.enraged ? 1 : 0,
      e.cast ? [e.cast.name, r2(e.cast.t), e.cast.dur, e.cast.kickable ? 1 : 0, e.cast.victim ? e.cast.victim.idx : -1] : 0, e.lvl, e.engaged ? 1 : 0, e.ret ? 1 : 0, e.target ? e.target.idx : -1, threatList(G, e), e.rare ? 1 : 0, e.pk != null ? e.pk : -1]),
    z: G.zones.map(z => [z.id, z.friendly ? (z.heal ? 2 : 1) : 0, z.type === 'circle' ? 0 : 1, r1(z.x), r1(z.y), z.r || 0, r2(z.ang || 0), z.half || 0, z.len || 0, r2(z.t), z.dur, z.done ? 1 : 0]),
    s: G.shots.map(s => [s.id, r1(s.x), r1(s.y), s.big ? 1 : 0, s.src.idx]),
    nd: G.nodes ? G.nodes.map(n => n.cd.reduce((m, v, i) => m | (v > 0 ? 1 << i : 0), 0)) : undefined,   // per seat: is this spot used up
    evs: G.ev ? [G.ev.wave, G.ev.done ? 1 : 0] : undefined,
    ch: G.layout ? G.chests.map(c => [c.x, c.y, c.open ? 1 : 0]) : undefined, tg: G.layout ? G.trigs.reduce((m, t, i) => m | (t.done ? 1 << i : 0), 0) : undefined, pt: G.portal ? [R(G.portal.x), R(G.portal.y)] : undefined
  };
}

/* ---------- the game's numbers as data ----------
 * exportData() gives everything a designer may change as one plain object. applyData() takes such an object, or any
 * part of one, and writes it into the live tables: only known fields, of the right kind, inside the bounds in LIM.
 * The server applies game/data.js when it starts; the page applies the same file and then what the editor saved on
 * that device. LIM is also what the editor reads for labels and steps: [label, min, max, step]. */
const LIM = {
  maxLevel: ['等級上限', 5, 60, 1], lvStep: ['每升一級的強度增幅', 0, .5, .01], xpBase: ['升級經驗：基礎', 10, 5000, 1], xpGrow: ['升級經驗：成長', 0, 1000, 1], xpPow: ['升級經驗：曲線', 1, 3, .05],
  towerStep: ['塔每高一層的強度倍率', 1, 2, .01], trashDrop: ['塔內小怪掉裝機率', 0, 1, .01], gatherTime: ['採集秒數', .2, 10, .1], nodeRespawn: ['採集點重生秒數', 1, 600, 1], mobRespawn: ['野怪重生秒數', 1, 600, 1],
  potionCap: ['藥水攜帶上限', 1, 20, 1], potionHeal: ['藥水回復比例', .05, 1, .01], bagCap: ['背包格數', 4, 40, 1], respecCost: ['重置天賦價格', 0, 9999, 1],
  hp: ['生命', 1, 1e6, 10], atk: ['攻擊力', 0, 1e5, 1], aspd: ['攻擊間隔（秒，0 是不普攻）', 0, 10, .05], range: ['距離', 0, 900, 1], speed: ['移動速度', 10, 400, 1], threat: ['仇恨倍率', 0, 50, .5], ultK: ['大招充能難度（越大越慢）', 1, 500, 1],
  cd: ['冷卻（秒）', .5, 180, .1], lv: ['解鎖等級', 1, 60, 1], w: ['直線半寬', 2, 120, 1], half: ['扇形半角（弧度）', .1, 1.6, .05], rad: ['範圍半徑', 10, 400, 1], mul: ['攻擊力倍率', 0, 100, .1], amt: ['基礎量（再乘上角色強度）', 0, 1e5, 5],
  dur: ['持續秒數', 0, 60, .5], stun: ['暈眩秒數', 0, 15, .1], pct: ['比例（0 到 1）', 0, 1, .01],
  dmg: ['傷害', 0, 1e5, 1], aggro: ['警戒距離', 0, 900, 5], leash: ['追擊距離', 0, 9999, 10], xp: ['擊倒給的經驗', 0, 1e5, 1],
  field: ['野怪掉裝機率', 0, 1, .01], fieldSet: ['野怪掉的是套裝的機率', 0, 1, .01], event: ['漲潮多給一件的機率', 0, 1, .01], eventSet: ['漲潮給的是套裝的機率', 0, 1, .01], bossSet: ['王掉的是套裝的機率', 0, 1, .01], trashSet: ['塔內小怪掉的是套裝的機率', 0, 1, .01],
  time: ['限時（秒，在這之內通關才升層）', 60, 1800, 10], chance: ['出現機率（0 到 1）', .05, 1, .05], roam: ['遊走半徑（0 是站著不動）', 0, 300, 5],
  need: ['需要的次數', 1, 999, 1], n: ['數量', 1, 6, 1], min: ['最低等級', 1, 60, 1], max: ['最高等級', 1, 60, 1]
};
const TEXT = { name: 14, desc: 60, title: 14, goal: 40, seal: 1 };
const MOD_KEYS = ['hp', 'dmg', 'heal', 'taken', 'speed', 'threat', 'ult', 'cdr'], NODE_TYPES = ['herb', 'wreck', 'salt'], WALL_TYPES = ['wall', 'water', 'road'], ID_OK = /^[a-z][a-z0-9]{1,11}$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const cleanStr = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>&"']/g, '').trim().slice(0, max) : '';
const numIn = (v, lo, hi, int) => typeof v === 'number' && Number.isFinite(v) ? clamp(int ? Math.round(v) : v, lo, hi) : null;
/* copy the editable fields of src onto tgt: numbers named in LIM, texts named in TEXT, and only where tgt already has that field */
function patch(tgt, src) {
  for (const k of Object.keys(src)) {
    if (LIM[k] && typeof tgt[k] === 'number') { const v = numIn(src[k], LIM[k][1], LIM[k][2], LIM[k][3] >= 1); if (v !== null) tgt[k] = v; }
    else if (TEXT[k] && typeof tgt[k] === 'string') { const v = cleanStr(src[k], TEXT[k]); if (v) tgt[k] = v; }
  }
}
const editable = o => { const r = {}; for (const k of Object.keys(o)) if ((LIM[k] && typeof o[k] === 'number') || (TEXT[k] && typeof o[k] === 'string')) r[k] = o[k]; return r; };
function exportData() {
  const map = t => { const r = {}; for (const k of Object.keys(t)) r[k] = editable(t[k]); return r; }, quests = list => list.map(x => Object.assign({ id: x.id }, editable(x), { reward: x.reward }, x.custom ? { kill: x.kill } : null));
  const enemies = map(ENEMY), maps = {}, dungeons = {};
  for (const k of Object.keys(ENEMY)) { if (ENEMY[k].base) enemies[k].base = ENEMY[k].base; if (ENEMY[k].moves) enemies[k].moves = ENEMY[k].moves; }
  for (const k of Object.keys(DUNGEONS)) { const D = DUNGEONS[k]; dungeons[k] = D.type === 'layout' ? { name: D.name, min: D.min, time: D.time, type: 'layout', map: D.map } : { name: D.name, min: D.min, time: D.time, type: 'waves', waves: D.waves }; }
  for (const k of Object.keys(MAPS)) { const F = MAPS[k];
    maps[k] = { name: F.name, w: F.w, h: F.h, spawn: { x: F.spawn[0], y: F.spawn[1] }, gate: F.gate ? { x: F.gate.x, y: F.gate.y } : null, packs: F.packs, nodes: F.nodes, rocks: F.rocks, walls: F.walls, exits: F.exits };
    if (k === 'shore') Object.assign(maps[k], { events: F.events, npcs: F.npcs, stalls: F.stalls.map(o => ({ id: o.id, x: o.x, y: o.y })) }); }
  return JSON.parse(JSON.stringify({ v: 2, tune: TUNE, classes: map(CLASSES), skills: map(SKILLS), enemies, drop: DROP, shop: SHOP, recipes: RECIPES.map(r => ({ id: r.id, name: r.name, cost: r.cost })),
    talents: TALENTS, sets: SETS, plain: PLAIN, quests: { main: quests(MAIN), week: quests(WEEK), side: quests(SIDE) }, dungeons, evWaves: EV_WAVES, maps }));
}
function cleanMoves(list) {
  const out = [];
  for (const m of list.slice(0, 8)) {
    const spec = isObj(m) && MOVES[m.t]; if (!spec) continue; const r = { t: m.t }; let ok = true;
    for (const f of Object.keys(spec[1])) { const L = spec[1][f], v = numIn(m[f], L[1], L[2], L[3] >= 1); if (v === null) ok = false; else r[f] = v; }
    if (!ok) continue;
    if (spec[1].cast) r.name = cleanStr(m.name, 6); else r.say = cleanStr(m.say, 12);
    if (m.t === 'adds') r.kind = typeof m.kind === 'string' ? m.kind : 'grunt';
    out.push(r);
  }
  return out;
}
function applyData(d) {
  if (!isObj(d)) return false;
  const each = (src, tgt, f) => { if (isObj(src)) for (const k of Object.keys(tgt)) if (isObj(src[k])) f(tgt[k], src[k], k); };
  const prices = (src, lo, hi, keys) => { const r = {}; if (isObj(src)) for (const k of keys) { const v = numIn(src[k], lo, hi, true); if (v !== null && v > 0) r[k] = v; } return r; };
  const matKeys = Object.keys(MATS);
  if (isObj(d.tune)) { patch(TUNE, d.tune); const v = numIn(d.tune.towerLevel, 1, 60, true); if (v !== null) DUNGEONS.tower.min = v; }      // an older save kept the tower's level here
  each(d.classes, CLASSES, patch); each(d.skills, SKILLS, patch);
  if (isObj(d.enemies)) {
    for (const k of Object.keys(ENEMY)) if (ENEMY[k].base && !isObj(d.enemies[k])) delete ENEMY[k];      // a kind made in the editor that is no longer listed
    for (const k of Object.keys(d.enemies).slice(0, 40)) {
      const src = d.enemies[k]; if (!isObj(src)) continue;
      if (!ENEMY[k]) { if (!ID_OK.test(k) || !TOWER_BASE.concat(FIELD_BASE).includes(src.base)) continue; ENEMY[k] = Object.assign(JSON.parse(JSON.stringify(ENEMY[src.base])), { base: src.base }); delete ENEMY[k].intro; }
      patch(ENEMY[k], src); if (ENEMY[k].boss && Array.isArray(src.moves)) ENEMY[k].moves = cleanMoves(src.moves);
    }
  }
  if (isObj(d.drop)) patch(DROP, d.drop);
  if (isObj(d.shop)) { if (isObj(d.shop.buy)) SHOP.buy = prices(d.shop.buy, 1, 99999, ['potion'].concat(matKeys)); if (isObj(d.shop.sell)) SHOP.sell = prices(d.shop.sell, 1, 99999, matKeys); }
  if (Array.isArray(d.recipes)) for (const r of d.recipes) { const t = isObj(r) && RECIPES.find(x => x.id === r.id), cost = t ? prices(r.cost, 1, 999, matKeys) : null; if (cost && Object.keys(cost).length) t.cost = cost; }
  if (isObj(d.talents)) for (const cls of Object.keys(TALENTS)) {
    const src = d.talents[cls]; if (!Array.isArray(src)) continue; const out = [], seen = new Set();
    for (const t of src.slice(0, 15)) {
      if (!isObj(t) || typeof t.id !== 'string' || !/^[a-z]-[a-z0-9]{1,12}$/.test(t.id) || seen.has(t.id) || !Array.isArray(t.eff)) continue;
      const key = t.eff[0], val = numIn(t.eff[1], -1, 1, false), okKey = MOD_KEYS.includes(key) || (typeof key === 'string' && key.startsWith('cd:') && CLASSES[cls].pool.includes(key.slice(3)));
      const name = cleanStr(t.name, TEXT.name), row = numIn(t.row, 0, 2, true), max = numIn(t.max, 1, 10, true); if (!okKey || !val || !name || row === null || max === null) continue;
      seen.add(t.id); out.push({ id: t.id, row, max, name, eff: [key, val], desc: cleanStr(t.desc, TEXT.desc) });
    }
    if (out.length) TALENTS[cls] = out;
  }
  if (isObj(d.plain)) for (const k of SLOTS) { const src = d.plain[k]; if (!Array.isArray(src)) continue; const out = []; for (const n of src.slice(0, 20)) { const v = cleanStr(n, 8); if (v && !out.includes(v)) out.push(v); } if (out.length) PLAIN[k] = out; }
  if (isObj(d.sets)) {
    const out = {}, used = new Set(SLOTS.reduce((a, k) => a.concat(PLAIN[k], ['工坊' + LOOT[k][0], '用舊的' + LOOT[k][0]]), []));
    const bonus = b => { const v = Array.isArray(b) ? numIn(b[1], -1, 1, false) : null; return v && MOD_KEYS.includes(b[0]) ? [b[0], v, cleanStr(b[2], 20)] : null; };
    for (const id of Object.keys(d.sets).slice(0, 12)) {
      const src = d.sets[id]; if (!/^[a-z][a-z0-9]{1,11}$/.test(id) || !isObj(src) || !isObj(src.pieces)) continue;
      const name = cleanStr(src.name, 6), pieces = {}, two = bonus(src.two), three = bonus(src.three); let ok = !!name && !!two && !!three;
      for (const k of SLOTS) { const v = cleanStr(src.pieces[k], 8); if (!v || used.has(v)) ok = false; pieces[k] = v; }
      if (!ok) continue; for (const k of SLOTS) used.add(pieces[k]); out[id] = { name, pieces, two, three };
    }
    for (const id of Object.keys(SETS)) delete SETS[id]; Object.assign(SETS, out);
  }
  indexNames();
  /* A quest made in the editor: knock down a creature that has a name (a pack's own name), so many times. It sits with
   * the side quests. Listing the side quests without it removes it. */
  if (isObj(d.quests) && Array.isArray(d.quests.side)) {
    for (let i = SIDE.length - 1; i >= 0; i--) if (SIDE[i].custom && !d.quests.side.some(q => isObj(q) && q.id === SIDE[i].id)) SIDE.splice(i, 1);
    for (const q of d.quests.side) {
      if (!isObj(q) || typeof q.kill !== 'string' || !/^k[a-z0-9]{1,8}$/.test(q.id) || SIDE.some(x => x.id === q.id) || SIDE.filter(x => x.custom).length >= 20) continue;
      const t = { id: q.id, title: '新任務', goal: '擊倒指定的怪', need: 1, reward: { xp: 100 }, kill: '', custom: true }; t.upd = (v, ev) => ev.type === 'kill' && !!ev.tag && ev.tag === t.kill ? Math.min(t.need, v + 1) : v; SIDE.push(t);
    }
  }
  if (isObj(d.quests)) for (const [key, list] of [['main', MAIN], ['week', WEEK], ['side', SIDE]]) if (Array.isArray(d.quests[key])) for (const q of d.quests[key]) {
    const t = isObj(q) && list.find(x => x.id === q.id); if (!t) continue; patch(t, q);
    if (t.custom) { if (typeof q.kill === 'string') t.kill = cleanStr(q.kill, 8); t.need = Math.min(99, t.need); }
    if (isObj(q.reward)) { const r = prices(q.reward, 1, 99999, ['coin', 'xp', 'potion'].concat(matKeys)); if (Object.keys(r).length) t.reward = r; }
  }
  const wavesOf = (src, max) => { const out = []; if (Array.isArray(src)) for (const w of src.slice(0, max)) { const row = []; if (Array.isArray(w)) for (const e of w.slice(0, 4)) { const n = Array.isArray(e) ? numIn(e[1], 1, 8, true) : null; if (n && typeof e[0] === 'string') row.push([e[0], n]); } if (row.length) out.push(row); } return out; };
  const setWaves = (D, w) => { if (D.waves === WAVES) { WAVES.length = 0; for (const row of w) WAVES.push(row); } else D.waves = w; };
  if (Array.isArray(d.waves) && !isObj(d.dungeons)) { const w = wavesOf(d.waves, 8); if (w.length) setWaves(DUNGEONS.tower, w); }      // an older save: the tower's waves on their own
  if (isObj(d.dungeons)) {
    for (const k of Object.keys(DUNGEONS)) if (k !== 'tower' && !isObj(d.dungeons[k])) delete DUNGEONS[k];
    for (const k of Object.keys(d.dungeons).slice(0, 12)) {
      const src = d.dungeons[k]; if (!isObj(src) || !ID_OK.test(k)) continue;
      if (!DUNGEONS[k]) DUNGEONS[k] = src.type === 'layout' ? { name: '新副本', min: 1, time: 300, type: 'layout', map: blankScene() } : { name: '新副本', min: 1, time: 180, type: 'waves', waves: [] };
      const D = DUNGEONS[k]; patch(D, src);
      if (D.type !== 'layout') { if (Array.isArray(src.waves)) { const w = wavesOf(src.waves, 8); if (w.length) setWaves(D, w); } continue; }
      const f = src.map, M = D.map; if (!isObj(f)) continue;
      { const w = numIn(f.w, 360, 1800, true), h = numIn(f.h, 440, 2400, true); if (w) M.w = w; if (h) M.h = h; }
      const pos = (o, r) => { const x = numIn(o && o.x, 20, M.w - 20, true), y = numIn(o && o.y, 20, M.h - 20, true); return x === null || y === null ? null : Object.assign(r || {}, { x, y }); };
      const lst = (key, max, one) => { if (!Array.isArray(f[key])) return null; const out = []; for (const o of f[key].slice(0, max)) { const v = isObj(o) ? one(o) : null; if (v) out.push(v); } return out; };
      { const sp = pos(f.spawn); if (sp) M.spawn = sp; else { M.spawn.x = clamp(M.spawn.x, 20, M.w - 20); M.spawn.y = clamp(M.spawn.y, 20, M.h - 20); } }
      { const v = lst('rocks', 30, o => { const p = pos(o), r = p && numIn(o.r, 10, 80, true); return r ? Object.assign(p, { r }) : null; }); if (v) M.rocks = v; }
      { const v = lst('walls', 40, o => { const p = pos(o), w = p && numIn(o.w, 20, 1200, true), h = p && numIn(o.h, 20, 1200, true); return w && h && WALL_TYPES.includes(o.type) ? Object.assign(p, { w, h, type: o.type }) : null; }); if (v) M.walls = v; }
      // a route is up to six points; an older save had one far end as px, py
      { const v = lst('mobs', 40, o => { const p = typeof o.kind === 'string' ? pos(o, { kind: o.kind }) : null; if (!p) return null; const n = numIn(o.n, 1, 4, true), ch = numIn(o.chance, .05, 1, false), roam = numIn(o.roam, 0, 300, true);
          Object.assign(p, { n: n || 1, chance: ch === null ? 1 : ch, rare: !!o.rare, roam: roam || 0, loop: !!o.loop, path: [] });
          for (const w of (Array.isArray(o.path) ? o.path : [{ x: o.px, y: o.py }]).slice(0, 20)) { const q = p.path.length < 6 ? pos(w) : null; if (q) p.path.push(q); } return p; }); if (v) M.mobs = v; }
      { const v = lst('chests', 10, o => { const p = pos(o), ch = numIn(o.chance, .05, 1, false); return p ? Object.assign(p, { chance: ch === null ? 1 : ch }) : null; }); if (v) M.chests = v; }
      { const v = lst('events', 16, o => { const p = EVENT_TYPES.includes(o.type) ? pos(o, { type: o.type }) : null; if (!p) return null; p.r = numIn(o.r, 30, 250, true) || 70; p.text = cleanStr(o.text, 20);
          if (o.type === 'ambush') { p.kind = typeof o.kind === 'string' ? o.kind : 'grunt'; p.n = numIn(o.n, 1, 4, true) || 2; } return p; }); if (v) M.events = v; }
    }
  }
  { const ev = wavesOf(d.evWaves, EV_WAVES.length); if (ev.length === EV_WAVES.length && ev.every(w => w.length)) ev.forEach((w, i) => { EV_WAVES[i] = w; }); }
  const mapsIn = isObj(d.maps) ? d.maps : isObj(d.field) ? { shore: d.field } : null;      // an older save had the one map as `field`
  if (mapsIn) {
    if (isObj(d.maps)) for (const k of Object.keys(MAPS)) if (k !== 'shore' && !isObj(mapsIn[k])) delete MAPS[k];
    for (const k of Object.keys(mapsIn).slice(0, 12)) {
      const f = mapsIn[k]; if (!isObj(f) || !ID_OK.test(k)) continue;
      if (!MAPS[k]) MAPS[k] = blankMap(k, '新地圖'); const F = MAPS[k];
      { const nm = cleanStr(f.name, 8), w = numIn(f.w, 360, 2400, true), h = numIn(f.h, 440, 3000, true); if (nm) F.name = nm; if (k !== 'shore') { if (w) F.w = w; if (h) F.h = h; } }
      const pos = (o, r) => { const x = numIn(o && o.x, 20, F.w - 20, true), y = numIn(o && o.y, 20, F.h - 20, true); return x === null || y === null ? null : Object.assign(r || {}, { x, y }); };
      const lst = (key, max, one) => { if (!Array.isArray(f[key])) return null; const out = []; for (const o of f[key].slice(0, max)) { const v = isObj(o) ? one(o) : null; if (v) out.push(v); } return out; };
      { const sp = pos(f.spawn); if (sp) F.spawn = [sp.x, sp.y]; else { F.spawn[0] = clamp(F.spawn[0], 20, F.w - 20); F.spawn[1] = clamp(F.spawn[1], 20, F.h - 20); } }
      if (f.gate === null && k !== 'shore') F.gate = null; else if (pos(f.gate)) F.gate = Object.assign({ r: 46 }, pos(f.gate));
      // a pack may have a name of its own, a patrol route and its own time to come back; each is stored only when set
      { const v = lst('packs', 30, o => { const p = typeof o.kind === 'string' ? pos(o, { kind: o.kind }) : null, n = p && numIn(o.n, 1, 6, true), lo = p && numIn(o.min, 1, 60, true), hi = p && numIn(o.max, 1, 60, true); if (!(p && n && lo && hi)) return null; Object.assign(p, { n, min: Math.min(lo, hi), max: Math.max(lo, hi) });
          const nm = cleanStr(o.name, 8), rs = numIn(o.respawn, 5, 900, true), path = []; if (nm) p.name = nm; if (rs) p.respawn = rs;
          if (Array.isArray(o.path)) for (const w of o.path.slice(0, 20)) { const q = path.length < 6 ? pos(w) : null; if (q) path.push(q); } if (path.length) { p.path = path; p.loop = !!o.loop; } return p; }); if (v && (v.length || k !== 'shore')) F.packs = v; }
      { const ids = new Set(), v = lst('nodes', 40, o => { const id = numIn(o.id, 1, 999, true), p = id && !ids.has(id) && NODE_TYPES.includes(o.type) ? pos(o, { id, type: o.type }) : null; if (p) ids.add(id); return p; }); if (v && (v.length || k !== 'shore')) F.nodes = v; }
      { const v = lst('rocks', 30, o => { const p = pos(o), r = p && numIn(o.r, 10, 80, true); return r ? Object.assign(p, { r }) : null; }); if (v) F.rocks = v; }
      { const v = lst('walls', 40, o => { const p = pos(o), w = p && numIn(o.w, 20, 1200, true), h = p && numIn(o.h, 20, 1200, true); return w && h && WALL_TYPES.includes(o.type) ? Object.assign(p, { w, h, type: o.type }) : null; }); if (v) F.walls = v; }
      { const v = lst('exits', 6, o => { const p = typeof o.to === 'string' ? pos(o, { to: o.to }) : null; if (p && Number.isFinite(o.tx) && Number.isFinite(o.ty)) { p.tx = Math.round(o.tx); p.ty = Math.round(o.ty); } return p; }); if (v) F.exits = v; }
      if (k !== 'shore') continue;
      { const v = lst('events', 6, o => { const p = pos(o), r = p && numIn(o.r, 60, 200, true); return r ? Object.assign(p, { r }) : null; }); if (v && v.length) F.events = v; }
      for (const [key, list] of [['npcs', F.npcs], ['stalls', F.stalls]]) if (Array.isArray(f[key])) for (const o of f[key]) { const t = isObj(o) && list.find(x => x.id === o.id), p = t && pos(o); if (p) Object.assign(t, p); }
    }
  }
  /* Whatever was changed, nothing may point at something that no longer exists. */
  { const tk = kindsOf(TOWER_BASE), fk = kindsOf(FIELD_BASE);
    for (const k of Object.keys(ENEMY)) if (ENEMY[k].moves) for (const m of ENEMY[k].moves) if (m.t === 'adds' && (!tk.includes(m.kind) || ENEMY[m.kind].boss)) m.kind = 'grunt';
    for (const k of Object.keys(DUNGEONS)) { const D = DUNGEONS[k];
      if (D.type === 'layout') { D.map.mobs = D.map.mobs.filter(m => tk.includes(m.kind)); for (const t of D.map.events) if (t.type === 'ambush' && (!tk.includes(t.kind) || ENEMY[t.kind].boss)) t.kind = 'grunt'; D.F = sceneField(k, D); continue; }
      const w = D.waves.map(row => row.filter(e => tk.includes(e[0]))).filter(row => row.length); if (!w.length) w.push([['grunt', 1]]); setWaves(D, w); }
    EV_WAVES.forEach((w, i) => { const row = w.filter(e => fk.includes(e[0])); EV_WAVES[i] = row.length ? row : [['crab', 1]]; });
    for (const k of Object.keys(MAPS)) { const F = MAPS[k]; F.packs = F.packs.filter(p => fk.includes(p.kind));
      F.exits = F.exits.filter(e => MAPS[e.to] && e.to !== k); for (const e of F.exits) { const T = MAPS[e.to]; e.tx = clamp(Number.isFinite(e.tx) ? e.tx : T.spawn[0], 20, T.w - 20); e.ty = clamp(Number.isFinite(e.ty) ? e.ty : T.spawn[1], 20, T.h - 20); } } }
  return true;
}
{ const pre = typeof self !== 'undefined' && self ? self.EmbertideData : null; if (pre) applyData(pre); }      // the committed data file, when the page loaded one before this script

return { packTag, exportData, applyData, LIM, TEXT, MOD_KEYS, NODE_TYPES, WALL_TYPES, MOVES, MAPS, DUNGEONS, floorOf, baseOf, EV_WAVES, PLAIN, TUNE,
  EVENT_TYPES, get TOWER_KINDS() { return kindsOf(TOWER_BASE); }, get FIELD_KINDS() { return kindsOf(FIELD_BASE); },
  W, H, TIME_LIMIT, CLASSES, SKILLS, ENEMY, WAVES, ROSTER, SPOTS, createRun, step, snapshot,
  cleanAim, defaultLoadout, validLoadout, loadoutOf, setLoadout,
  FIELD, get GATHER_TIME() { return TUNE.gatherTime; }, get NODE_RESPAWN() { return TUNE.nodeRespawn; }, createField, addFieldActor, removeFieldActor, present, pushOut, fieldYield, grant, fieldGain, eventReward,
  get MAX_LEVEL() { return TUNE.maxLevel; }, lvF, xpNeed, recLevel, mobLevel, xpForKill, addXp, setLevel, charPower,
  MATS, RECIPES, get POTION_CAP() { return TUNE.potionCap; }, ilvlOf, powerOf, gearCap, newProfile, fixProfile, applyResult, recipeInfo, craft,
  weekOf, fixQuests, questList, questEvent, questClaim, MAIN_IDS: MAIN.map(m => m.id),
  TALENTS, NO_MODS, talentPoints, talentSpent, modsOf, learnTalent, resetTalents, get RESPEC_COST() { return TUNE.respecCost; }, SHOP, shopBuy, shopSell, itemName, addCoin, threatList,
  SLOTS, SLOT_NAME: { w: '武器', a: '護甲', t: '飾品' }, get BAG_CAP() { return TUNE.bagCap; }, QUALITY, SETS, DROP, get TRASH_DROP() { return TUNE.trashDrop; }, rollItem, fixItem, itemPrice, itemSet, itemText, wornItem, setCount, setList, modsFor, giveItem, equipItem, sellItem,
  runDrops, bossDrops, refit, get TOWER_LEVEL() { return DUNGEONS.tower.min; }, PORTAL };
});
