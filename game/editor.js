/* Embertide editor: change the game's numbers, items and map without touching code.
 * It edits the same plain object that Sim.exportData() gives and Sim.applyData() takes. Every change is applied to the
 * running tables at once (so closing the editor and playing uses it), kept in this device's storage, and can be saved
 * to the page's cloud store, where it can be read back and written into game/data.js.
 * Built for a phone: lists that open into forms, and a map you drag things on. */
(function () {
'use strict';
const S = window.Sim; if (!S || typeof document === 'undefined') return;
const KEY = 'embertide.data', CLOUD = 'design/data';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clone = v => JSON.parse(JSON.stringify(v)), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const get = (o, path) => path.reduce((x, k) => x == null ? undefined : x[k], o);
const put = (o, path, v) => { path.slice(0, -1).reduce((x, k) => x[k], o)[path[path.length - 1]] = v; };
const MODL = { hp: '生命', dmg: '造成的傷害', heal: '治療量', taken: '受到的傷害', speed: '移動速度', threat: '仇恨', ult: '大招充能', cdr: '所有技能冷卻' };
const SLOTL = { w: '武器', a: '護甲', t: '飾品' }, NODEL = { herb: '潮草', wreck: '殘骸（鏽鐵屑）', salt: '鹽晶' }, TEXTL = { name: '名字', desc: '說明文字', title: '標題', goal: '目標文字', seal: '技能鍵上的字' };
const TABS = [['tune', '規則'], ['classes', '職業'], ['skills', '技能'], ['talents', '天賦'], ['enemies', '怪物'], ['dungeons', '副本'], ['drop', '掉落'], ['sets', '套裝'], ['plain', '裝備名'], ['shop', '商人'], ['recipes', '配方'], ['quests', '任務'], ['map', '地圖']];
let doc = null, base = null, root = null, tab = 'tune', opened = {}, sel = null, tool = 'move', sayT = 0, mapId = 'shore';

const itemName = k => k === 'coin' ? '鐘幣' : k === 'xp' ? '經驗' : S.itemName(k) || k;
const kindName = k => (doc.enemies[k] && doc.enemies[k].name) || k;
const baseOf = k => (doc.enemies[k] && doc.enemies[k].base) || k, TOWER = ['grunt', 'caster', 'boss'];
const kindsOf = tower => Object.keys(doc.enemies).filter(k => TOWER.includes(baseOf(k)) === tower);
const freeId = (o, p) => { let n = 1; while (o[p + n]) n++; return p + n; };
function save() { try { localStorage.setItem(KEY, JSON.stringify(doc)); window.__dataLocal = true; } catch (e) {} }
function say(msg) { const n = root.querySelector('#ed-say'); n.textContent = msg; n.hidden = false; clearTimeout(sayT); sayT = setTimeout(() => { n.hidden = true; }, 3200); }
/* Everything goes through here: the rules check the change, and what comes back out is what is kept. */
function commit(quiet) { S.applyData(doc); doc = S.exportData(); save(); if (!quiet) render(); }
function setAt(path, v) { put(doc, path, v); commit(); const now = get(doc, path); if (!same(now, v)) say(`這個值不能用，已經調整成 ${typeof now === 'object' ? '允許的內容' : now}。`); }
function diffCount(a, b) { if (same(a, b)) return 0; if (a && b && typeof a === 'object' && typeof b === 'object') { let n = 0; for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) n += diffCount(a[k], b[k]); return n; } return 1; }

/* ---------- small pieces ---------- */
function field(label, input, changed) { const l = el('label', changed ? 'chg' : '', label); l.appendChild(input); return l; }
function numField(label, path, lim, hint) {
  const inp = el('input'), v = get(doc, path), b = get(base, path); inp.type = 'number'; inp.inputMode = 'decimal'; inp.step = lim[3]; inp.min = lim[1]; inp.max = lim[2]; inp.value = v == null ? '' : v;
  inp.addEventListener('change', () => { const n = parseFloat(inp.value); if (Number.isFinite(n)) setAt(path, n); else render(); });
  return field(label + (b !== undefined && b !== v ? `（預設 ${b}）` : hint ? `（${hint}）` : ''), inp, b !== undefined && b !== v);
}
function textField(label, path, max) {
  const inp = el('input'), v = get(doc, path), b = get(base, path); inp.type = 'text'; inp.maxLength = max; inp.value = v == null ? '' : v; inp.autocomplete = 'off';
  inp.addEventListener('change', () => setAt(path, inp.value));
  return field(label, inp, b !== undefined && b !== v);
}
function pickField(label, path, options, num) {
  const sl = el('select'), v = get(doc, path); for (const [val, text] of options) { const o = el('option', '', text); o.value = val; sl.appendChild(o); } sl.value = v;
  sl.addEventListener('change', () => setAt(path, num ? +sl.value : sl.value)); return field(label, sl, !same(get(base, path), v));
}
/* a choice that is not stored as one field: it writes the object back whole */
function choice(label0, value, options, write) { const sl = el('select'); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; sl.appendChild(o); } sl.value = value; sl.addEventListener('change', () => { write(sl.value); commit(); }); return field(label0, sl); }
/* every editable field of one object, in the order the object has them */
function form(path, only) {
  const box = el('div', 'fields'), o = get(doc, path);
  for (const k of Object.keys(o)) { if (only && !only.includes(k)) continue; if (S.TEXT[k] && typeof o[k] === 'string') box.appendChild(textField(TEXTL[k], path.concat(k), S.TEXT[k])); }
  for (const k of Object.keys(o)) { if (only && !only.includes(k)) continue; if (S.LIM[k] && typeof o[k] === 'number') box.appendChild(numField(S.LIM[k][0], path.concat(k), S.LIM[k])); }
  return box;
}
/* a row that opens into its form */
function card(key, title, sub, build, changed) {
  const li = el('li', 'ed-card' + (opened[key] ? ' open' : '') + (changed ? ' chg' : '')), head = el('button', 'ed-head'); head.type = 'button';
  head.append(el('b', '', title), el('small', '', sub || ''), el('i', '', opened[key] ? '收起' : '修改'));
  head.addEventListener('click', () => { opened[key] = !opened[key]; render(); }); li.appendChild(head);
  if (opened[key]) { const body = el('div', 'ed-body'); build(body); li.appendChild(body); }
  return li;
}
function btn(text, cls, fn) { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
function note(text) { return el('p', 'note', text); }
function group(title) { const g = el('div', 'group'); if (title) g.appendChild(el('h3', '', title)); return g; }
const list = () => el('ul', 'ed-list');
/* amounts keyed by item: a row of number boxes, where 0 means "not in the list" */
function amounts(path, keys, lo, hi) {
  const box = el('div', 'fields'), cur = get(doc, path) || {}, was = get(base, path) || {};
  for (const k of keys) {
    const inp = el('input'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = 0; inp.max = hi; inp.step = 1; inp.value = cur[k] || 0;
    inp.addEventListener('change', () => { const n = Math.round(parseFloat(inp.value) || 0), next = Object.assign({}, get(doc, path)); if (n >= lo) next[k] = n; else delete next[k]; setAt(path, next); });
    box.appendChild(field(itemName(k) + ((was[k] || 0) !== (cur[k] || 0) ? `（預設 ${was[k] || 0}）` : ''), inp, (was[k] || 0) !== (cur[k] || 0)));
  }
  return box;
}

/* the waves of a dungeon: which creatures and how many; `max` waves at most, 0 when the number of waves is fixed */
function waveList(host, path, kinds, max) {
  const waves = get(doc, path);
  waves.forEach((w, i) => {
    const box = el('div', 'ed-wave'), top = el('div', 'ed-btns'); top.appendChild(el('b', '', `第 ${i + 1} 波`));
    if (max && waves.length > 1) top.appendChild(btn('刪掉這一波', 'mini', () => { waves.splice(i, 1); commit(); })); box.appendChild(top);
    w.forEach((e, j) => { const row = el('div', 'ed-row'), sl = el('select'), n = el('input');
      for (const k of kinds) { const o = el('option', '', kindName(k)); o.value = k; sl.appendChild(o); } sl.value = e[0]; n.type = 'number'; n.min = 1; n.max = 8; n.step = 1; n.inputMode = 'numeric'; n.value = e[1];
      sl.addEventListener('change', () => setAt(path.concat(i, j, 0), sl.value)); n.addEventListener('change', () => setAt(path.concat(i, j, 1), Math.round(parseFloat(n.value) || 1)));
      row.append(sl, n, btn('刪', 'mini', () => { if (w.length < 2) return say('每一波至少要有一種怪。'); w.splice(j, 1); commit(); })); box.appendChild(row); });
    if (w.length < 4) box.appendChild(btn('加一種怪', 'mini', () => { w.push([kinds[0], 1]); commit(); }));
    host.appendChild(box);
  });
  if (max && waves.length < max) host.appendChild(btn('加一波', 'mini go', () => { waves.push([[kinds[0], 2]]); commit(); }));
}
/* a boss's moves: blocks from Sim.MOVES, each with its own numbers */
function moveList(host, k) {
  const moves = doc.enemies[k].moves, g = group('招式（由上往下，先準備好的先放）');
  moves.forEach((m, i) => {
    const spec = S.MOVES[m.t], box = el('div', 'ed-wave'), top = el('div', 'ed-btns'), f = el('div', 'fields'), p = ['enemies', k, 'moves', i];
    top.append(el('b', '', spec[0]), btn('刪', 'mini', () => { moves.splice(i, 1); commit(); })); box.appendChild(top);
    if (spec[1].cast) f.appendChild(textField('招式名字', p.concat('name'), 6)); else f.appendChild(textField('出現時畫面上的字', p.concat('say'), 12));
    if (m.t === 'adds') f.appendChild(pickField('叫出哪種怪', p.concat('kind'), kindsOf(true).filter(x => baseOf(x) !== 'boss').map(x => [x, kindName(x)])));
    for (const key of Object.keys(spec[1])) f.appendChild(numField(spec[1][key][0], p.concat(key), spec[1][key]));
    box.appendChild(f); g.appendChild(box);
  });
  if (moves.length < 8) { const row = el('div', 'ed-row'), sl = el('select'); for (const t of Object.keys(S.MOVES)) { const o = el('option', '', S.MOVES[t][0]); o.value = t; sl.appendChild(o); }
    row.append(sl, btn('加這個招式', 'mini go', () => { const spec = S.MOVES[sl.value][1], m = { t: sl.value, name: '', say: '', kind: 'grunt' };
      const dflt = { first: 6, every: 10, cast: 1.5, dmg: 250, half: .6, len: 120, r: sl.value === 'nova' ? 110 : 44, n: 2, at: .5, mul: 1.3 }; for (const key of Object.keys(spec)) m[key] = dflt[key]; moves.push(m); commit(); })); row.lastChild.style.gridColumn = '2 / span 2'; g.appendChild(row); }
  host.appendChild(g);
}

/* ---------- the tabs ---------- */
const VIEW = {
  tune(body) { body.append(note('整個遊戲共用的規則。改完關掉編輯器進遊戲就會生效。'), form(['tune'])); },
  classes(body) {
    const ul = list();
    for (const k of Object.keys(doc.classes)) ul.appendChild(card('c:' + k, doc.classes[k].name, `生命 ${doc.classes[k].hp}　攻擊 ${doc.classes[k].atk}`, b => b.appendChild(form(['classes', k])), !same(doc.classes[k], base.classes[k])));
    body.append(note('三個職業的基礎數值。一個職業帶哪些技能目前寫在程式裡。'), ul);
  },
  skills(body) {
    body.appendChild(note('這裡改的是數字和文字。技能怎麼運作（怎麼瞄準、是傷害還是治療）寫在程式裡；說明文字裡的數字要自己跟著改。'));
    for (const cls of Object.keys(S.CLASSES)) {
      const g = group(doc.classes[cls].name), ul = list();
      for (const id of S.CLASSES[cls].pool.concat(S.CLASSES[cls].ults)) { const k = doc.skills[id], ult = S.SKILLS[id].ult;
        ul.appendChild(card('s:' + id, `${k.seal}　${k.name}`, ult ? '大招' : `冷卻 ${k.cd} 秒　Lv.${k.lv} 解鎖`, b => b.appendChild(form(['skills', id])), !same(k, base.skills[id]))); }
      g.appendChild(ul); body.appendChild(g);
    }
  },
  talents(body) {
    body.appendChild(note('每個天賦是「某一種加成 × 最多幾點」。排數決定要先投多少點才開放（第 2 排 3 點、第 3 排 6 點）。'));
    for (const cls of Object.keys(doc.talents)) {
      const g = group(doc.classes[cls].name), ul = list(), arr = doc.talents[cls];
      const effs = S.MOD_KEYS.map(k => [k, MODL[k]]).concat(S.CLASSES[cls].pool.map(id => ['cd:' + id, `「${doc.skills[id].name}」的冷卻`]));
      arr.forEach((t, i) => ul.appendChild(card('t:' + t.id, t.name, `第 ${t.row + 1} 排　最多 ${t.max} 點　每點 ${t.eff[1] > 0 ? '+' : ''}${Math.round(t.eff[1] * 100)}%`, b => {
        const f = el('div', 'fields'), p = ['talents', cls, i];
        f.append(textField('名字', p.concat('name'), S.TEXT.name), textField('說明文字', p.concat('desc'), S.TEXT.desc), pickField('第幾排', p.concat('row'), [[0, '第 1 排'], [1, '第 2 排'], [2, '第 3 排']], true),
          numField('最多幾點', p.concat('max'), ['', 1, 10, 1]), pickField('加成種類', p.concat('eff', 0), effs), numField('每點加多少（0.05 是 5%，減少填負數）', p.concat('eff', 1), ['', -1, 1, .01]));
        b.append(f, btn('刪除這個天賦', 'mini', () => { if (arr.length < 2) return say('每個職業至少要留一個天賦。'); arr.splice(i, 1); commit(); }));
      }, !same(t, (base.talents[cls] || []).find(x => x.id === t.id)))));
      g.append(ul, btn('新增天賦', 'mini go', () => { let n = 1; while (arr.some(x => x.id === `${cls[0]}-n${n}`)) n++; const id = `${cls[0]}-n${n}`; arr.push({ id, row: 0, max: 3, name: '新天賦', eff: ['dmg', .03], desc: '造成的傷害 +3%' }); opened['t:' + id] = true; commit(); }));
      body.appendChild(g);
    }
  },
  enemies(body) {
    const ul = list(), how = { grunt: '塔裡的近戰怪', caster: '塔裡的施法怪（會讀金色條）', boss: '王', crab: '野外的近戰怪', acolyte: '野外的施法怪', brute: '野外的精英（會砸地）' };
    body.appendChild(note('怪物怎麼行動由「原型」決定，共六種。要新的怪物，就把一隻現有的複製出來，再改名字和數值。王的招式可以自己組合。塔裡的怪會再乘上層數，野外的怪會再乘上等級。'));
    for (const k of Object.keys(doc.enemies)) { const e = doc.enemies[k], b0 = baseOf(k);
      ul.appendChild(card('e:' + k, e.name, `${how[b0]}　生命 ${e.hp}　傷害 ${e.dmg}`, b => {
        b.appendChild(form(['enemies', k]));
        if (e.moves) moveList(b, k);
        const row = el('div', 'ed-btns'); row.appendChild(btn('複製成新怪物', 'mini go', () => { const id = freeId(doc.enemies, 'm'); doc.enemies[id] = Object.assign(clone(e), { base: b0, name: (e.name + '二型').slice(0, 14) }); opened['e:' + id] = true; opened['e:' + k] = false; commit(); if (!doc.enemies[id]) say('沒有加進去：怪物種類已經到上限。'); }));
        if (e.base) row.appendChild(btn('刪除這種怪物', 'mini', () => { delete doc.enemies[k]; commit(); say('刪掉了。用到牠的怪群和波次也一起拿掉了。'); }));
        b.appendChild(row);
      }, !same(e, base.enemies[k])));
    }
    body.appendChild(ul);
  },
  dungeons(body) {
    body.appendChild(note('副本有兩種。波次型：一個場地，怪一波一波來，打完最後一波通關。場景型：像編輯場景一樣自己擺地形、怪、王、寶箱和事件，玩家走進去探索，全部的王倒下就通關。每個角色在每個副本各有自己的層數。'));
    const ul = list();
    for (const id of Object.keys(doc.dungeons)) { const d = doc.dungeons[id], lay = d.type === 'layout';
      ul.appendChild(card('d:' + id, d.name, `${lay ? '場景型' : '波次型'}　Lv.${d.min} 開放　${lay ? `${d.map.mobs.length} 組怪` : `${d.waves.length} 波`}`, b => {
        const f = el('div', 'fields'); f.append(textField('名字', ['dungeons', id, 'name'], S.TEXT.name), numField('開放等級（角色幾級才能進）', ['dungeons', id, 'min'], S.LIM.min), numField(S.LIM.time[0], ['dungeons', id, 'time'], S.LIM.time)); b.appendChild(f);
        if (lay) b.append(note(`場景裡現在有 ${d.map.mobs.length} 組怪、${d.map.chests.length} 個寶箱、${d.map.events.length} 個事件。`), btn('編輯場景（擺地形、怪、王、寶箱、事件）', 'mini go', () => { mapId = 'd:' + id; tab = 'map'; sel = null; tool = 'move'; root.scrollTop = 0; render(); }));
        else waveList(b, ['dungeons', id, 'waves'], kindsOf(true), 8);
        if (id !== 'tower') b.appendChild(btn('刪除這個副本', 'mini', () => { delete doc.dungeons[id]; commit(); }));
      }, !same(d, base.dungeons[id])));
    }
    const row = el('div', 'ed-btns'), boss0 = kindsOf(true).find(k => baseOf(k) === 'boss'), full = id => { if (!doc.dungeons[id]) say('沒有加進去：副本已經到上限。'); };
    row.append(btn('新增場景型副本', 'mini go', () => { const id = freeId(doc.dungeons, 'd'); doc.dungeons[id] = { type: 'layout', name: '新副本', min: 1, time: 300, map: { w: 700, h: 1000, spawn: { x: 350, y: 930 }, rocks: [], walls: [], chests: [], events: [],
        mobs: [{ kind: 'grunt', x: 350, y: 620, n: 2, chance: 1, rare: false, roam: 50 }, { kind: boss0, x: 350, y: 180, n: 1, chance: 1, rare: false, roam: 0 }] } }; opened['d:' + id] = true; commit(); full(id); }),
      btn('新增波次型副本', 'mini', () => { const id = freeId(doc.dungeons, 'd'); doc.dungeons[id] = { type: 'waves', name: '新副本', min: 1, time: 180, waves: [[['grunt', 3]], [['grunt', 2], ['caster', 1]], [[boss0, 1]]] }; opened['d:' + id] = true; commit(); full(id); }));
    body.append(ul, row);
    const g = group('漲潮（鏽灘的野外事件）'); g.appendChild(note('固定三波。螃蟹的數量還會隨在場人數增加。')); waveList(g, ['evWaves'], kindsOf(false), 0); body.appendChild(g);
  },
  drop(body) { body.append(note('機率填 0 到 1，例如 0.05 是 5%。塔內小怪的掉裝機率在「規則」那一頁。'), form(['drop'])); },
  sets(body) {
    const ul = list(), ids = Object.keys(doc.sets), mods = S.MOD_KEYS.map(k => [k, MODL[k]]);
    for (const id of ids) { const st = doc.sets[id];
      ul.appendChild(card('set:' + id, st.name + '套裝', `兩件：${st.two[2]}　三件：${st.three[2]}`, b => {
        const f = el('div', 'fields'), p = ['sets', id];
        f.append(textField('套裝名字', p.concat('name'), 6), textField('武器的名字', p.concat('pieces', 'w'), 8), textField('護甲的名字', p.concat('pieces', 'a'), 8), textField('飾品的名字', p.concat('pieces', 't'), 8));
        for (const [key, label] of [['two', '穿兩件'], ['three', '穿三件']]) f.append(pickField(label + '：加成種類', p.concat(key, 0), mods), numField(label + '：加多少（0.05 是 5%）', p.concat(key, 1), ['', -1, 1, .01]), textField(label + '：顯示的文字', p.concat(key, 2), 20));
        b.append(f, note('改掉或刪掉名字後，玩家身上叫舊名字的裝備會消失。'), btn('刪除這套', 'mini', () => { delete doc.sets[id]; commit(); }));
      }, !same(st, base.sets[id])));
    }
    body.append(note('每套三件：武器、護甲、飾品各一。件的名字不能和別的裝備重複。'), ul, btn('新增套裝', 'mini go', () => {
      let n = 1; while (doc.sets['set' + n]) n++; const id = 'set' + n; doc.sets[id] = { name: '新套裝' + n, pieces: { w: `新套${n}之刃`, a: `新套${n}之甲`, t: `新套${n}之環` }, two: ['hp', .05, '生命 +5%'], three: ['dmg', .05, '造成的傷害 +5%'] };
      opened['set:' + id] = true; commit(); if (!doc.sets[id]) say('這套沒有加進去：名字和別的裝備重複了。'); }));
  },
  plain(body) {
    body.appendChild(note('不屬於套裝的裝備名字。掉落時會從該部位的名字裡隨機挑一個。刪掉名字後，玩家身上叫那個名字的裝備會消失。'));
    for (const k of Object.keys(SLOTL)) {
      const g = group(SLOTL[k]), arr = doc.plain[k];
      arr.forEach((n, i) => { const row = el('div', 'ed-row'), inp = el('input'); inp.type = 'text'; inp.maxLength = 8; inp.value = n; inp.addEventListener('change', () => { const before = arr.length; arr[i] = inp.value; commit(); if (doc.plain[k].length < before) say('名字是空的或重複了，這一筆被拿掉了。'); });
        row.append(inp, btn('刪', 'mini', () => { if (arr.length < 2) return say('每個部位至少要留一個名字。'); arr.splice(i, 1); commit(); })); g.appendChild(row); });
      g.appendChild(btn('新增名字', 'mini go', () => { let n = 1; while (arr.includes(`新${SLOTL[k]}${n}`)) n++; arr.push(`新${SLOTL[k]}${n}`); commit(); }));
      body.appendChild(g);
    }
  },
  shop(body) {
    const mats = Object.keys(S.MATS), a = group('老錨賣的東西和價格'), b = group('老錨收購的價格');
    a.append(note('填 0 就是不賣。'), amounts(['shop', 'buy'], ['potion'].concat(mats), 1, 99999)); b.append(note('填 0 就是不收。裝備的收購價另外照裝等和品質算。'), amounts(['shop', 'sell'], mats, 1, 99999)); body.append(a, b);
  },
  recipes(body) {
    const ul = list();
    doc.recipes.forEach((r, i) => ul.appendChild(card('r:' + r.id, r.name, Object.keys(r.cost).map(k => `${itemName(k)} ${r.cost[k]}`).join('、'), b => b.append(note('填 0 就是不需要這種材料。至少要留一種。'), amounts(['recipes', i, 'cost'], Object.keys(S.MATS), 1, 999)), !same(r.cost, base.recipes[i].cost))));
    body.append(note('工坊裡每樣東西要花的材料。做出來的裝等跟著塔的層數走，目前寫在程式裡。'), ul);
  },
  quests(body) {
    body.appendChild(note('原本的任務可以改標題、目標文字、需要的次數和獎勵（怎麼計數寫在程式裡）。自己新增的任務可以選類型：擊倒有名字的怪、擊倒某一種怪、採集、收集怪身上掉的任務物品、走到地標、通關副本，也可以設成「先交完另一個任務才出現」串成一條任務鏈。獎勵填 0 就是不給那一項。'));
    const named = [], marks = [], maps = Object.keys(doc.maps).map(id => [id, doc.maps[id].name]), kinds = kindsOf(false).map(x => [x, kindName(x)]), runs = Object.keys(doc.dungeons).map(id => [id, doc.dungeons[id].name]);
    for (const [id, nm] of maps) { for (const pk of doc.maps[id].packs) if (pk.name && !named.some(x => x[0] === pk.name)) named.push([pk.name, `${pk.name}（${nm}）`]); for (const m of doc.maps[id].marks || []) if (!marks.some(x => x[0] === m.name)) marks.push([m.name, `${m.name}（${nm}）`]); }
    const nameOf = (list, v) => (list.find(x => x[0] === v) || [v, v])[1], gone = (list, v, why) => (v ? [] : [['', '請選擇']]).concat(!v || list.some(x => x[0] === v) ? list : list.concat([[v, `${v}（${why}）`]]));
    /* the goal line written for the player, kept in step for as long as nobody has typed their own */
    const auto = q => (q.type === 'kill' ? `擊倒${q.kill || '指定的怪'}` : q.type === 'kind' ? `擊倒${kindName(q.kind)}${q.map ? `（${nameOf(maps, q.map)}）` : ''}` : q.type === 'gather' ? `採集${q.node ? NODEL[q.node].split('（')[0] : '任何東西'}${q.map ? `（${nameOf(maps, q.map)}）` : ''}`
      : q.type === 'item' ? `從${q.kill || kindName(q.kind)}身上收集${q.item || '物品'}` : q.type === 'reach' ? `找到${q.reach || '地標'}` : `${q.fast ? '在時限內' : ''}通關${q.run ? nameOf(runs, q.run) : '任何副本'}`).slice(0, S.TEXT.goal);
    const turn = (q, fn) => v => { const was = auto(q); fn(v); if (!q.goal || q.goal === was) q.goal = auto(q); };
    for (const [key, title] of [['main', '主線（照順序）'], ['week', '每週'], ['side', '支線']]) {
      const g = group(title), ul = list();
      doc.quests[key].forEach((q, i) => { const mine = q.type !== undefined, P = ['quests', key, i];
        ul.appendChild(card('q:' + q.id, q.title, mine ? `${q.goal}　${q.need} 次${q.after ? '（接在別的任務後面）' : ''}` : q.goal, b => {
          b.appendChild(form(P, ['title', 'goal', 'need']));
          if (mine) { const f = el('div', 'fields');
            f.appendChild(choice('類型', q.type, Object.entries(S.QUEST_TYPES), turn(q, v => { q.type = v; if (['kill', 'reach'].includes(v)) q.need = 1;
              if (v === 'kill') q.kill = q.kill || (named[0] || [''])[0]; if (v === 'kind' || v === 'item') q.kind = q.kind || kinds[0][0]; if (v === 'item') { q.kill = ''; q.item = q.item || '信物'; } if (v === 'reach') q.reach = q.reach || (marks[0] || [''])[0]; })));
            if (q.type === 'kill') f.appendChild(choice('目標：哪一隻有名字的怪', q.kill, gone(named, q.kill, '地圖上已經沒有這個名字'), turn(q, v => { q.kill = v; })));
            if (q.type === 'kind') f.append(choice('目標：哪一種怪', q.kind, gone(kinds, q.kind, '已經沒有這種怪'), turn(q, v => { q.kind = v; })), choice('在哪張地圖', q.map, [['', '哪張地圖都算']].concat(maps), turn(q, v => { q.map = v; })));
            if (q.type === 'gather') f.append(choice('採什麼', q.node, [['', '什麼都算']].concat(S.NODE_TYPES.map(x => [x, NODEL[x]])), turn(q, v => { q.node = v; })), choice('在哪張地圖', q.map, [['', '哪張地圖都算']].concat(maps), turn(q, v => { q.map = v; })));
            if (q.type === 'item') { const inp = el('input'); inp.type = 'text'; inp.maxLength = 6; inp.value = q.item; inp.autocomplete = 'off'; inp.addEventListener('change', () => { turn(q, v => { q.item = v; })(inp.value); commit(); });
              f.append(field('任務物品的名字', inp), choice('從誰身上掉', q.kill ? 'kill' : 'kind', [['kind', '某一種怪'], ['kill', '有名字的那一隻']], turn(q, v => { if (v === 'kill' && !named.length) return say('地圖上還沒有取了名字的怪。先到「地圖」分頁選一組怪群，替牠取名字。'); q.kill = v === 'kill' ? named[0][0] : ''; q.kind = q.kind || kinds[0][0]; })),
                q.kill ? choice('哪一隻', q.kill, gone(named, q.kill, '地圖上已經沒有這個名字'), turn(q, v => { q.kill = v; })) : choice('哪一種怪', q.kind, gone(kinds, q.kind, '已經沒有這種怪'), turn(q, v => { q.kind = v; })), numField('每次擊倒掉出來的機率', P.concat('chance'), ['', .05, 1, .05])); }
            if (q.type === 'reach') f.appendChild(choice('目標：哪個地標', q.reach, gone(marks, q.reach, '地圖上已經沒有這個地標'), turn(q, v => { q.reach = v; })));
            if (q.type === 'run') f.append(choice('哪個副本', q.run, [['', '哪個副本都算']].concat(runs), turn(q, v => { q.run = v; })), choice('要在時限內打完嗎', q.fast ? '1' : '0', [['0', '不用，通關就算'], ['1', '要，超時不算']], turn(q, v => { q.fast = v === '1'; })));
            f.appendChild(choice('什麼時候出現', q.after, [['', '一開始就有']].concat(doc.quests.main.concat(doc.quests.side).filter(x => x.id !== q.id).map(x => [x.id, `交完「${x.title}」之後`])), v => { q.after = v; }));
            b.appendChild(f);
            if (q.type === 'kill' && !named.length) b.appendChild(note('地圖上還沒有取了名字的怪：到「地圖」分頁選一組怪群，替牠取名字。'));
            if (q.type === 'reach' && !marks.length) b.appendChild(note('地圖上還沒有地標：到「地圖」分頁用「＋地標」放一個。'));
            if (q.type === 'item') b.appendChild(note('任務物品不佔背包，只是任務上的計數：每擊倒一次照機率多一個。'));
          }
          b.append(el('h3', '', '獎勵'), amounts(P.concat('reward'), ['coin', 'xp', 'potion'].concat(Object.keys(S.MATS)), 1, 99999));
          if (mine) b.appendChild(btn('刪除這個任務', 'mini', () => { doc.quests[key].splice(i, 1); commit(); }));
        }, !same(q, base.quests[key][i]))); });
      g.appendChild(ul);
      if (key === 'side') g.appendChild(btn('新增任務', 'mini go', () => {
        let n = 1; while (doc.quests.side.some(x => x.id === 'k' + n)) n++; const id = 'k' + n, q = { id, title: '新任務', goal: '', need: 5, reward: { coin: 30, xp: 150 }, type: 'kind', kind: kinds[0][0], map: '' }; q.goal = auto(q);
        doc.quests.side.push(q); opened['q:' + id] = true; commit(); if (!doc.quests.side.some(x => x.id === id)) say('沒有加進去：自訂任務已經到上限。'); }));
      body.appendChild(g);
    }
  },
  map: mapView
};

/* ---------- maps and dungeon scenes: pick or add one, drag things about, tap to select, add with a tool ----------
 * mapId is a field map's id, or 'd:<dungeon>' for the scene of a laid-out dungeon. */
const LAYERS = [['mobs', '怪', 18], ['chests', '寶箱', 14], ['packs', '怪群', 16], ['nodes', '採集點', 12], ['rocks', '岩石', 0], ['walls', '牆／水／路', 0], ['exits', '出入口', 22], ['events', '事件', 0], ['marks', '地標', 0], ['npcs', '營地的人', 14], ['stalls', '攤位', 14]];
const WALLL = { wall: '牆（擋路）', water: '水（擋路）', road: '路（只是顏色）' }, EVL = { ambush: '伏擊：冒出怪', say: '旁白：畫面上出現一行字', heal: '回復泉：全隊補滿' };
function mapView(body) {
  let isD = mapId.startsWith('d:'), did = mapId.slice(2);
  if (isD ? !(doc.dungeons[did] && doc.dungeons[did].type === 'layout') : !doc.maps[mapId]) { mapId = 'shore'; isD = false; }
  const P = isD ? ['dungeons', did, 'map'] : ['maps', mapId], f = get(doc, P), home = mapId === 'shore', pick = el('div', 'tabs'), tools = el('div', 'tabs'), wrap = el('div', 'ed-map'), cv = el('canvas'), panel = el('div', 'ed-panel');
  const go = id => { mapId = id; sel = null; tool = 'move'; render(); }, soldiers = () => kindsOf(true).filter(k => baseOf(k) !== 'boss'), bosses = () => kindsOf(true).filter(k => baseOf(k) === 'boss');
  for (const id of Object.keys(doc.maps)) pick.appendChild(btn(doc.maps[id].name, 'mini' + (id === mapId ? ' on' : ''), () => go(id)));
  for (const id of Object.keys(doc.dungeons)) if (doc.dungeons[id].type === 'layout') pick.appendChild(btn('副本：' + doc.dungeons[id].name, 'mini' + ('d:' + id === mapId ? ' on' : ''), () => go('d:' + id)));
  pick.appendChild(btn('＋新地圖', 'mini go', () => { const id = freeId(doc.maps, 'map'); doc.maps[id] = { name: '新地圖', w: 900, h: 900, spawn: { x: 450, y: 800 }, gate: null, packs: [], nodes: [], rocks: [], walls: [], exits: [{ x: 450, y: 860, to: 'shore' }] };
    commit(true); if (!doc.maps[id]) { say('沒有加進去：地圖已經到上限。'); return render(); } go(id); say('新地圖開好了，裡面先放了一個回鏽灘的出入口。記得到鏽灘也放一個通到這裡的出入口。'); }));
  const add = isD ? [['move', '移動／選取'], ['mobs', '＋怪'], ['boss', '＋王'], ['rare', '＋稀有精英'], ['chests', '＋寶箱'], ['events', '＋事件'], ['rocks', '＋岩石'], ['wall', '＋牆'], ['water', '＋水'], ['road', '＋路']]
    : [['move', '移動／選取'], ['packs', '＋怪群'], ['nodes', '＋採集點'], ['rocks', '＋岩石'], ['wall', '＋牆'], ['water', '＋水'], ['road', '＋路'], ['exits', '＋出入口'], ['marks', '＋地標']].concat(home ? [['events', '＋漲潮點']] : []).concat(f.gate ? [] : [['gate', '＋副本入口']]);
  for (const [k, t] of add) tools.appendChild(btn(t, 'mini' + (tool === k ? ' on' : ''), () => { tool = k; render(); }));
  const props = el('div', 'fields'); if (!isD) props.appendChild(textField('地圖名字', P.concat('name'), 8));
  if (!home) props.append(numField('寬', P.concat('w'), ['', 360, isD ? 1800 : 2400, 10]), numField('高', P.concat('h'), ['', 440, isD ? 2400 : 3000, 10]));
  body.append(pick, props, note(tool !== 'move' ? '在地圖上點一下要放的位置。' : isD ? '這是副本的場景。拖曳可以移動，點一下可以選取，選到的東西在地圖下面改細節。怪要等玩家靠近才會開戰。' : '拖曳可以移動，點一下可以選取，選到的東西在地圖下面改細節。要捲動頁面請拖地圖左右兩邊或以外的地方。'), tools, wrap, panel); wrap.appendChild(cv);
  if (!home && !isD) body.appendChild(btn('刪除這張地圖', 'mini', ev => { const b = ev.currentTarget; if (b.textContent !== '確定刪除？') { b.textContent = '確定刪除？'; return; } delete doc.maps[mapId]; mapId = 'shore'; sel = null; commit(); say('刪掉了。通到那張地圖的出入口也一起拿掉了。'); }));
  const cw = Math.max(160, Math.min(wrap.clientWidth || 340, Math.floor((window.innerHeight - 110) * f.w / f.h), 480)), k = cw / f.w, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.style.width = cw + 'px'; cv.style.height = Math.round(f.h * k) + 'px'; cv.width = Math.round(cw * dpr); cv.height = Math.round(f.h * k * dpr);
  const c = cv.getContext('2d'), css = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const S1 = n => n * (f.w / 900) / Math.max(.6, cw / 358);      // a size in map units that looks like n on the default map
  const L = key => f[key] || [], at = s0 => s0.single ? f[s0.single] : f[s0.list][s0.i], isSel = (l, i) => sel && sel.list === l && sel.i === i;
  function label(t, x, y, col) { c.font = `700 ${S1(26)}px sans-serif`; c.textAlign = 'center'; c.fillStyle = col; c.fillText(t, x, y); }
  function draw() {
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0); c.fillStyle = css('deep'); c.fillRect(0, 0, f.w, f.h);
    for (const o of L('walls')) { c.globalAlpha = o.type === 'road' ? .6 : 1; c.fillStyle = o.type === 'road' ? css('slate') : o.type === 'water' ? css('glow') : css('ink'); c.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h); c.globalAlpha = 1; c.strokeStyle = css('line'); c.lineWidth = S1(3); c.strokeRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h); }
    if (home) { const cp = S.FIELD.safe; c.strokeStyle = css('line'); c.lineWidth = S1(2); c.setLineDash([10, 10]); c.beginPath(); c.arc(cp.x, cp.y, cp.r, 0, 7); c.stroke(); c.setLineDash([]); label('營地（怪不會進來）', cp.x, cp.y + cp.r + 30, css('mute')); }
    for (const o of L('rocks')) { c.fillStyle = css('line'); c.beginPath(); c.arc(o.x, o.y, o.r, 0, 7); c.fill(); }
    L('events').forEach((o, i) => { const col = isD ? (o.type === 'heal' ? css('heal') : o.type === 'say' ? css('foam') : css('danger')) : css('ember'); c.strokeStyle = col; c.lineWidth = S1(isSel('events', i) ? 6 : 3); c.setLineDash([14, 10]); c.beginPath(); c.arc(o.x, o.y, o.r, 0, 7); c.stroke(); c.setLineDash([]); label(isD ? EVL[o.type].split('：')[0] : '漲潮', o.x, o.y + S1(9), col); });
    L('marks').forEach((o, i) => { c.strokeStyle = css('brass'); c.lineWidth = S1(isSel('marks', i) ? 6 : 3); c.setLineDash([6, 12]); c.beginPath(); c.arc(o.x, o.y, o.r, 0, 7); c.stroke(); c.setLineDash([]); label(o.name, o.x, o.y + S1(9), css('brass')); });
    L('exits').forEach(o => { c.strokeStyle = css('hex'); c.lineWidth = S1(5); c.beginPath(); c.arc(o.x, o.y, S1(30), 0, 7); c.stroke(); label('往 ' + (doc.maps[o.to] ? doc.maps[o.to].name : '？'), o.x, o.y - S1(40), css('foam')); });
    L('packs').forEach(o => {
      if (o.path && o.path.length) { c.strokeStyle = css('rust'); c.lineWidth = S1(3); c.beginPath(); c.moveTo(o.x, o.y); for (const q of o.path) c.lineTo(q.x, q.y); if (o.loop) c.closePath(); c.stroke();
        o.path.forEach((q, j) => { c.fillStyle = css('rust'); c.beginPath(); c.arc(q.x, q.y, S1(14), 0, 7); c.fill(); label(j + 1, q.x, q.y + S1(9), css('ink')); }); }
      c.fillStyle = css('rust'); c.beginPath(); c.arc(o.x, o.y, S1(26), 0, 7); c.fill(); if (o.name) { c.strokeStyle = css('brass'); c.lineWidth = S1(5); c.stroke(); }
      label(o.n, o.x, o.y + S1(9), css('ink')); label(`${o.name || kindName(o.kind).slice(0, 3)} ${o.min}-${o.max}`, o.x, o.y - S1(34), o.name ? css('brass') : css('foam')); });
    L('mobs').forEach(o => { const boss = baseOf(o.kind) === 'boss', r = S1(boss ? 36 : 26);
      if (o.roam > 0) { c.strokeStyle = css('rust'); c.lineWidth = S1(2); c.setLineDash([8, 8]); c.beginPath(); c.arc(o.x, o.y, o.roam, 0, 7); c.stroke(); c.setLineDash([]); }
      if (o.path.length) { c.strokeStyle = css('rust'); c.lineWidth = S1(3); c.beginPath(); c.moveTo(o.x, o.y); for (const q of o.path) c.lineTo(q.x, q.y); if (o.loop) c.closePath(); c.stroke();
        o.path.forEach((q, j) => { c.fillStyle = css('rust'); c.beginPath(); c.arc(q.x, q.y, S1(14), 0, 7); c.fill(); label(j + 1, q.x, q.y + S1(9), css('ink')); }); }
      c.fillStyle = boss ? css('danger') : css('rust'); c.beginPath(); c.arc(o.x, o.y, r, 0, 7); c.fill(); if (o.rare || boss) { c.strokeStyle = css('brass'); c.lineWidth = S1(5); c.stroke(); }
      label(boss ? '王' : o.n, o.x, o.y + S1(9), css('ink')); label(`${o.rare ? '稀有 ' : ''}${kindName(o.kind).slice(0, 4)}${o.chance < 1 ? ` ${Math.round(o.chance * 100)}%` : ''}`, o.x, o.y - r - S1(8), css('foam')); });
    L('chests').forEach(o => { c.fillStyle = css('brass'); c.fillRect(o.x - S1(18), o.y - S1(13), S1(36), S1(26)); label(`寶箱 ${Math.round(o.chance * 100)}%`, o.x, o.y - S1(22), css('brass')); });
    L('nodes').forEach(o => { c.fillStyle = o.type === 'herb' ? css('heal') : o.type === 'salt' ? css('foam') : css('brass'); c.fillRect(o.x - S1(14), o.y - S1(14), S1(28), S1(28)); });
    L('npcs').forEach(o => { c.fillStyle = css('foam'); c.beginPath(); c.arc(o.x, o.y, S1(16), 0, 7); c.fill(); label(window.Story && Story.CAST[o.id] ? Story.CAST[o.id].name : o.id, o.x, o.y - S1(24), css('foam')); });
    L('stalls').forEach(o => { const d = S.FIELD.stalls.find(x => x.id === o.id); c.fillStyle = css('brass'); c.fillRect(o.x - S1(16), o.y - S1(16), S1(32), S1(32)); label(d ? d.name : o.id, o.x, o.y - S1(24), css('brass')); });
    c.fillStyle = css('heal'); c.beginPath(); c.arc(f.spawn.x, f.spawn.y, S1(12), 0, 7); c.fill(); label(isD ? '入口' : '出生點', f.spawn.x, f.spawn.y + S1(40), css('heal'));
    if (f.gate) { const g = f.gate; c.fillStyle = css('brass'); c.beginPath(); c.moveTo(g.x, g.y - S1(34)); c.lineTo(g.x + S1(30), g.y + S1(22)); c.lineTo(g.x - S1(30), g.y + S1(22)); c.closePath(); c.fill(); label(home ? '塔門' : '副本入口', g.x, g.y + S1(56), css('brass')); }
    if (sel) { const o = at(sel); if (o) { c.strokeStyle = css('foam'); c.lineWidth = S1(5); if (sel.list === 'walls') c.strokeRect(o.x - o.w / 2 - S1(6), o.y - o.h / 2 - S1(6), o.w + S1(12), o.h + S1(12)); else { c.beginPath(); const q = sel.h != null && o.path ? o.path[sel.h] || o : o; c.arc(q.x, q.y, (sel.h != null || ['events', 'marks'].includes(sel.list) ? 0 : o.r || 0) + S1(sel.h != null ? 24 : ['events', 'marks'].includes(sel.list) ? 30 : 38), 0, 7); c.stroke(); } } }
  }
  const hit = p => { let best = null, bd = S1(52); const tryOne = (s0, o, r) => { const d = Math.hypot(o.x - p.x, o.y - p.y) - (r || 0) * .6; if (d < bd) { bd = d; best = s0; } };
    if (f.gate) tryOne({ single: 'gate' }, f.gate); tryOne({ single: 'spawn' }, f.spawn);
    for (const l of ['mobs', 'packs']) L(l).forEach((o, i) => (o.path || []).forEach((q, j) => tryOne({ list: l, i, h: j }, q)));      // every point of a patrol route can be dragged too
    for (const [l, , r] of LAYERS) if (l !== 'walls') L(l).forEach((o, i) => tryOne({ list: l, i }, o, l === 'rocks' ? o.r : S1(r)));
    if (!best) L('walls').forEach((o, i) => { if (Math.abs(p.x - o.x) <= o.w / 2 + S1(8) && Math.abs(p.y - o.y) <= o.h / 2 + S1(8)) best = { list: 'walls', i }; });      // a box only when nothing smaller is under the finger
    return best; };
  const pos = ev => { const r = cv.getBoundingClientRect(); return { x: Math.round((ev.clientX - r.left) / k), y: Math.round((ev.clientY - r.top) / k) }; };
  let drag = null;
  cv.addEventListener('pointerdown', ev => {
    ev.preventDefault(); const p = pos(ev);
    if (tool === 'gate') { f.gate = { x: p.x, y: p.y }; sel = { single: 'gate' }; tool = 'move'; return commit(); }
    if (tool !== 'move') {
      const lst = ['wall', 'water', 'road'].includes(tool) ? 'walls' : ['boss', 'rare'].includes(tool) ? 'mobs' : tool, other = Object.keys(doc.maps).find(id => id !== mapId);
      if (lst === 'exits' && !other) { tool = 'move'; say('只有一張地圖，出入口沒有地方可以通。先新增一張地圖。'); return render(); }
      const fresh = lst === 'mobs' ? { kind: tool === 'boss' ? bosses()[0] : soldiers()[0], x: p.x, y: p.y, n: tool === 'mobs' ? 2 : 1, chance: tool === 'rare' ? .3 : 1, rare: tool === 'rare', roam: 0 }
        : lst === 'chests' ? { x: p.x, y: p.y, chance: .5 } : lst === 'events' && isD ? { type: 'ambush', x: p.x, y: p.y, r: 70, kind: soldiers()[0], n: 2, text: '' }
        : lst === 'packs' ? { kind: kindsOf(false)[0], x: p.x, y: p.y, n: 2, min: 1, max: 6 } : lst === 'nodes' ? { id: 1 + f.nodes.reduce((m, o) => Math.max(m, o.id), 0), type: 'herb', x: p.x, y: p.y } : lst === 'rocks' ? { x: p.x, y: p.y, r: 32 }
        : lst === 'marks' ? { x: p.x, y: p.y, r: 80, name: (() => { let n = 1; const all = Object.keys(doc.maps).flatMap(id => (doc.maps[id].marks || []).map(m => m.name)); while (all.includes('地標' + n)) n++; return '地標' + n; })() }
        : lst === 'walls' ? { x: p.x, y: p.y, w: tool === 'road' ? 80 : 200, h: tool === 'road' ? 300 : 40, type: tool } : lst === 'exits' ? { x: p.x, y: p.y, to: other } : { x: p.x, y: p.y, r: 115 };
      if (!f[lst]) f[lst] = []; const before = f[lst].length; f[lst].push(fresh); sel = { list: lst, i: before }; tool = 'move'; commit(); if (get(doc, P)[sel.list].length <= before) { sel = null; say('放不下：已經到這一種的數量上限，或位置太靠邊。'); render(); } return;
    }
    sel = hit(p); if (sel) { drag = { id: ev.pointerId, moved: false }; try { cv.setPointerCapture(ev.pointerId); } catch (e) {} } draw(); showPanel();
  });
  cv.addEventListener('pointermove', ev => { if (!drag || ev.pointerId !== drag.id || !sel) return; const p = pos(ev), o = at(sel), x = Math.max(20, Math.min(f.w - 20, p.x)), y = Math.max(20, Math.min(f.h - 20, p.y));
    if (sel.h != null && o.path && o.path[sel.h]) { o.path[sel.h].x = x; o.path[sel.h].y = y; } else { for (const q of o.path || []) { q.x = Math.max(20, Math.min(f.w - 20, q.x + x - o.x)); q.y = Math.max(20, Math.min(f.h - 20, q.y + y - o.y)); } o.x = x; o.y = y; } drag.moved = true; draw(); });      // moving a creature takes its route along
  const up = ev => { if (!drag || ev.pointerId !== drag.id) return; const moved = drag.moved; drag = null; if (moved) commit(); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  function showPanel() {
    panel.textContent = ''; if (!sel) return panel.appendChild(note('還沒選東西。'));
    const o = at(sel); if (!o) { sel = null; return; }
    const title = sel.single ? (sel.single === 'spawn' ? (isD ? '入口（隊伍進副本時出現的位置）' : '出生點（進這張地圖、或倒下後站起來的位置）') : home ? '塔門' : '副本入口') : isD && sel.list === 'events' ? '事件' : home && sel.list === 'events' ? '漲潮點' : LAYERS.find(l => l[0] === sel.list)[1];
    const p = sel.single ? P.concat(sel.single) : P.concat(sel.list, sel.i), box = el('div', 'fields');
    { const q = sel.h != null && o.path && o.path[sel.h] ? o.path[sel.h] : o; panel.appendChild(el('h3', '', `選到：${title}${sel.h != null ? `的巡邏點 ${sel.h + 1}` : ''}　位置 ${q.x}, ${q.y}`)); }
    if (sel.list === 'packs') { const route = !!(o.path && o.path.length);
      box.append(pickField('怪物', p.concat('kind'), kindsOf(false).map(x => [x, kindName(x)])), numField('數量', p.concat('n'), S.LIM.n), numField('最低等級', p.concat('min'), S.LIM.min), numField('最高等級', p.concat('max'), S.LIM.max),
        textField('自己的名字（留空就用怪物原本的名字）', p.concat('name'), 8), numField('倒下後幾秒重生（留空用預設）', p.concat('respawn'), ['', 5, 900, 5]),
        choice('平常做什麼', route ? 'path' : 'roam', [['roam', '在原地附近遊走'], ['path', '照路線巡邏']], v => { o.path = v === 'path' ? [{ x: Math.min(f.w - 20, o.x + 160), y: o.y }] : []; }));
      if (route) box.appendChild(choice('走到最後一點之後', o.loop ? '1' : '0', [['0', '原路走回來'], ['1', '直接走回起點（繞圈）']], v => { o.loop = v === '1'; })); }
    if (sel.list === 'mobs') { const mode = o.path.length ? 'path' : o.roam > 0 ? 'roam' : 'none';
      box.append(pickField('怪物（選王型的就是王）', p.concat('kind'), kindsOf(true).map(x => [x, kindName(x) + (baseOf(x) === 'boss' ? '（王）' : '')])), numField('這一組幾隻', p.concat('n'), ['', 1, 4, 1]), numField(S.LIM.chance[0], p.concat('chance'), S.LIM.chance),
        choice('稀有精英（更硬、更痛、必掉裝備）', o.rare ? '1' : '0', [['0', '不是'], ['1', '是']], v => { o.rare = v === '1'; }),
        choice('平常做什麼', mode, [['none', '站著不動'], ['roam', '在範圍內遊走'], ['path', '照路線巡邏']], v => { o.path = v === 'path' ? [{ x: Math.min(f.w - 20, o.x + 140), y: o.y }] : []; o.roam = v === 'roam' ? 80 : 0; }));
      if (mode === 'roam') box.appendChild(numField('遊走半徑', p.concat('roam'), ['', 10, 300, 5]));
      if (mode === 'path') box.appendChild(choice('走到最後一點之後', o.loop ? '1' : '0', [['0', '原路走回來'], ['1', '直接走回起點（繞圈）']], v => { o.loop = v === '1'; })); }
    if (sel.list === 'chests') box.append(numField(S.LIM.chance[0], p.concat('chance'), S.LIM.chance));
    if (sel.list === 'nodes') box.append(pickField('種類', p.concat('type'), S.NODE_TYPES.map(x => [x, NODEL[x]])));
    if (sel.list === 'rocks') box.append(numField('大小', p.concat('r'), ['', 10, 80, 1]));
    if (sel.list === 'events' && !isD) box.append(numField('範圍', p.concat('r'), ['', 60, 200, 5]));
    if (sel.list === 'events' && isD) { box.append(pickField('踩進去會發生什麼', p.concat('type'), S.EVENT_TYPES.map(x => [x, EVL[x]])), numField('觸發範圍', p.concat('r'), ['', 30, 250, 5]));
      if (o.type === 'ambush') box.append(pickField('冒出哪種怪', p.concat('kind'), soldiers().map(x => [x, kindName(x)])), numField('幾隻', p.concat('n'), ['', 1, 4, 1]));
      if (o.type !== 'heal') box.append(textField(o.type === 'say' ? '畫面上的字' : '出現時畫面上的字（可不填）', p.concat('text'), 20)); }
    if (sel.list === 'marks') box.append(textField('名字（每個地標要不一樣）', p.concat('name'), 8), numField('範圍', p.concat('r'), ['', 30, 300, 5]));
    if (sel.list === 'walls') box.append(pickField('種類', p.concat('type'), S.WALL_TYPES.map(x => [x, WALLL[x]])), numField('寬', p.concat('w'), ['', 20, 1200, 10]), numField('高', p.concat('h'), ['', 20, 1200, 10]));
    if (sel.list === 'exits') box.append(pickField('通到哪張地圖', p.concat('to'), Object.keys(doc.maps).filter(id => id !== mapId).map(id => [id, doc.maps[id].name])), numField('到了那邊站在 X', p.concat('tx'), ['', 20, 2400, 10]), numField('到了那邊站在 Y', p.concat('ty'), ['', 20, 3000, 10]));
    panel.appendChild(box);
    if (sel.list === 'packs') panel.appendChild(note('野怪的等級會跟著玩家，但不會低於最低等級、不會高於最高等級。取了名字的怪可以當成任務目標：到「任務」分頁新增任務。'));
    if (sel.list === 'marks') panel.appendChild(note('玩家走進圈裡就算到達，畫面上會出現地標的名字。要當成任務目標：到「任務」分頁新增任務，類型選「到達一個地標」。改名字之後，原本指著它的任務要重新選一次。'));
    if (['mobs', 'packs'].includes(sel.list) && o.path && o.path.length) { const row = el('div', 'ed-btns'), last = o.path[o.path.length - 1], lst0 = sel.list;
      if (o.path.length < 6) row.appendChild(btn('加一個巡邏點', 'mini go', () => { o.path.push({ x: Math.max(20, Math.min(f.w - 20, last.x + 80)), y: Math.max(20, Math.min(f.h - 20, last.y + 80)) }); sel = { list: lst0, i: sel.i, h: o.path.length - 1 }; commit(); }));
      if (o.path.length > 1) row.appendChild(btn(sel.h != null ? '刪掉這個巡邏點' : '刪掉最後一個巡邏點', 'mini', () => { o.path.splice(sel.h != null ? sel.h : o.path.length - 1, 1); sel = { list: lst0, i: sel.i }; commit(); }));
      panel.append(row, note(`路線有 ${o.path.length} 個點（最多 6 個），照編號順序走。點是地圖上連著線的小圓點，可以直接拖。`)); }
    else if (sel.list === 'mobs') panel.appendChild(note('同一組的怪會一起開戰。出現機率小於 1 的，每次進副本重新決定在不在。'));
    if (sel.list === 'events' && isD) panel.appendChild(note('每個事件一場只會觸發一次，要有玩家（不是 AI 隊友）走進範圍。'));
    if (sel.list === 'exits') panel.appendChild(note('出入口是單向的：要能走回來，那張地圖也要放一個通回這裡的。'));
    if (sel.single === 'gate' && !home) panel.appendChild(btn('拿掉這個副本入口', 'mini', () => { f.gate = null; sel = null; commit(); }));
    if (sel.list && !['npcs', 'stalls'].includes(sel.list)) panel.appendChild(btn('刪除這個', 'mini', () => { const arr = get(doc, P)[sel.list]; if (home && ['packs', 'nodes', 'events'].includes(sel.list) && arr.length < 2) return say('鏽灘至少要留一個。'); arr.splice(sel.i, 1); sel = null; commit(); }));
  }
  draw(); showPanel();
}

/* ---------- the frame ---------- */
/* Removing a box that still has the cursor in it makes the browser report a change, which asks for another redraw
 * in the middle of this one. Such a request waits, and is done once, afterwards. */
let drawing = false, again = false;
function render() { if (drawing) { again = true; return; } drawing = true; try { paint(); } finally { drawing = false; } if (again) { again = false; render(); } }
function paint() {
  const tabs = root.querySelector('#ed-tabs'), body = root.querySelector('#ed-body'), n = diffCount(doc, base); tabs.textContent = ''; body.textContent = '';
  for (const [k, t] of TABS) tabs.appendChild(btn(t, 'mini' + (tab === k ? ' on' : ''), () => { tab = k; sel = null; tool = 'move'; root.scrollTop = 0; render(); }));
  root.classList.toggle('onmap', tab === 'map');      // on the map the bar at the bottom must not sit over the canvas
  VIEW[tab](body);
  root.querySelector('#ed-status').textContent = n ? `和原本的設定有 ${n} 處不同，已經存在這台裝置上。` : '目前和原本的設定完全一樣。';
  const on = tabs.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}
async function cloud(write) {
  const out = root.querySelector('#ed-out'); let db = null; try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch (e) {}
  if (!db) {      // no cloud store here: hand the text over instead
    if (!write) return say('這個版本沒有雲端儲存。');
    out.hidden = false; out.value = JSON.stringify(doc); out.focus(); out.select(); try { await navigator.clipboard.writeText(out.value); say('這裡沒有雲端儲存。設定已經複製，貼給 Claude 就能寫回遊戲。'); } catch (e) { say('這裡沒有雲端儲存。把下面這段文字複製給 Claude。'); } return;
  }
  try {
    if (write) { await db.doc(CLOUD).set({ json: JSON.stringify(doc), at: Date.now(), changes: diffCount(doc, base) }); say('存到雲端了。跟 Claude 說一聲，就會寫回遊戲。'); }
    else { const snap = await db.doc(CLOUD).get(), d = snap.exists ? snap.data() : null; if (!d || typeof d.json !== 'string') return say('雲端上還沒有存過設定。'); doc = JSON.parse(d.json); commit(); say('已經載入雲端上的設定。'); }
  } catch (e) { say(write ? '沒有存成功，等一下再試。' : '沒有讀到，等一下再試。'); }
}
function build() {
  root = el('section', 'overlay top'); root.id = 'editor'; root.hidden = true;
  const style = el('style'); style.textContent = `
#editor{z-index:8}
#editor .wrap{gap:12px;padding-top:14px}
#editor h2{font-size:24px} #editor .head{align-items:center}
#ed-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
#ed-tabs .mini,#editor .tabs .mini{flex:none}
#editor .mini.on{border-color:var(--brass);color:var(--brass)}
#ed-body{display:flex;flex-direction:column;gap:12px}
#editor .fields label.chg{color:var(--brass)} #editor .fields label.chg input,#editor .fields label.chg select{border-color:var(--brass)}
.ed-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ed-card{border:1.5px solid var(--line);border-radius:8px;background:var(--deep)} .ed-card.chg{border-color:var(--brass)}
.ed-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;width:100%;padding:10px 12px;border:0;background:transparent;color:var(--foam);text-align:left;font:inherit}
.ed-head b{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .ed-head small{grid-column:1;font-size:12px;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ed-head i{grid-row:1 / span 2;grid-column:2;align-self:center;font-style:normal;font-size:12px;color:var(--brass)}
.ed-body{display:flex;flex-direction:column;gap:10px;padding:2px 12px 12px}
.ed-row{display:grid;grid-template-columns:minmax(0,1fr) 72px auto;gap:6px;align-items:center} .ed-row input,.ed-row select{font:inherit;font-size:16px;color:var(--foam);background:var(--deep);border:1.5px solid var(--line);border-radius:8px;height:40px;padding:0 8px;min-width:0}
.ed-row input[type=text]{grid-column:1 / span 2}
.ed-btns{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between}
.ed-wave{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1.5px solid var(--line);border-radius:8px;background:var(--deep)}
.ed-map{display:flex;justify-content:center} .ed-map canvas{touch-action:none;border:1.5px solid var(--line);border-radius:8px}
.ed-panel{display:flex;flex-direction:column;gap:8px} .ed-panel h3,#ed-body h3{margin:4px 0 0;font-size:12px;letter-spacing:.1em;color:var(--mute);font-weight:400}
#ed-foot{position:sticky;bottom:0;display:flex;flex-direction:column;gap:6px;margin:auto calc(-1 * var(--gr)) -20px calc(-1 * var(--gl));padding:10px var(--gr) 14px var(--gl);background:var(--ink);border-top:1px solid var(--line)}
#ed-foot .row{display:flex;gap:6px} #ed-foot .mini{flex:1;min-width:0;padding:0 6px} #ed-foot .note{font-size:11px}
#ed-reset{align-self:flex-start}
#editor.onmap #ed-foot{position:static}
#ed-say{position:sticky;top:6px;z-index:3;padding:8px 12px;border:1.5px solid var(--brass);border-radius:8px;background:var(--slate);font-size:13px}
#ed-out{width:100%;box-sizing:border-box;height:90px;font-size:11px;color:var(--foam);background:var(--deep);border:1.5px solid var(--line);border-radius:8px}`;
  const wrap = el('div', 'wrap'), head = el('div', 'head'), ht = el('div'), foot = el('div'), row = el('div', 'row'), row2 = el('div', 'row'), sayBox = el('div'), out = el('textarea');
  ht.append(el('p', 'eyebrow', '改數值、道具和地圖'), el('h2', '', '編輯器')); head.append(ht, btn('關閉', 'chip', close)); head.lastChild.id = 'ed-close';
  sayBox.id = 'ed-say'; sayBox.hidden = true; out.id = 'ed-out'; out.hidden = true; out.readOnly = true; foot.id = 'ed-foot';
  const tabs = el('div'), body = el('div'), status = el('p', 'note'); tabs.id = 'ed-tabs'; body.id = 'ed-body'; status.id = 'ed-status';
  row.append(btn('關掉去試玩', 'mini go', close), btn('存到雲端', 'mini', () => cloud(true)), btn('讀雲端', 'mini', () => cloud(false)));
  row2.append(btn('全部還原成原本的設定', 'mini', ev => { const b = ev.currentTarget; if (b.textContent !== '確定還原？') { b.textContent = '確定還原？'; setTimeout(() => { b.textContent = '全部還原成原本的設定'; }, 2500); return; }
    try { localStorage.removeItem(KEY); } catch (e) {} window.__dataLocal = false; S.applyData(base); doc = S.exportData(); sel = null; render(); say('已經還原。'); }));
  row.children[0].id = 'ed-play'; row.children[1].id = 'ed-cloud'; row2.children[0].id = 'ed-reset';
  foot.append(status, row, out); wrap.append(head, sayBox, tabs, body, row2, foot); root.append(style, wrap);
  (document.querySelector('#app') || document.body).appendChild(root);
}
function open() {
  if (!root) build();
  base = clone(window.__baseData || S.exportData());
  S.applyData(base); try { const d = localStorage.getItem(KEY); if (d) S.applyData(JSON.parse(d)); } catch (e) {}      // start from the committed numbers plus what this device saved
  doc = S.exportData(); root.hidden = false; root.scrollTop = 0; render();
}
function close() { if (root) root.hidden = true; if (window.__editorClosed) window.__editorClosed(); }
window.Editor = { open, close, get doc() { return doc; } };
})();
