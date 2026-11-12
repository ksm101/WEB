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
const TABS = [['tune', '規則'], ['classes', '職業'], ['skills', '技能'], ['talents', '天賦'], ['enemies', '怪物'], ['waves', '波次'], ['drop', '掉落'], ['sets', '套裝'], ['plain', '裝備名'], ['shop', '商人'], ['recipes', '配方'], ['quests', '任務'], ['map', '地圖']];
let doc = null, base = null, root = null, tab = 'tune', opened = {}, sel = null, tool = 'move', sayT = 0;

const itemName = k => k === 'coin' ? '鐘幣' : k === 'xp' ? '經驗' : S.itemName(k) || k;
const kindName = k => (doc.enemies[k] && doc.enemies[k].name) || k;
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
    const ul = list(), where = { grunt: '沉鐘塔', caster: '沉鐘塔', boss: '沉鐘塔的王', crab: '鏽灘', acolyte: '鏽灘', brute: '漲潮的精英' };
    for (const k of Object.keys(doc.enemies)) ul.appendChild(card('e:' + k, doc.enemies[k].name, `${where[k] || ''}　生命 ${doc.enemies[k].hp}　傷害 ${doc.enemies[k].dmg}`, b => b.appendChild(form(['enemies', k])), !same(doc.enemies[k], base.enemies[k])));
    body.append(note('怪物的基礎數值。塔裡的怪會再乘上層數，野外的怪會再乘上等級。王的招式時間和新的怪物種類目前寫在程式裡。'), ul);
  },
  waves(body) {
    const part = (title, key, kinds, hint) => {
      const g = group(title); g.appendChild(note(hint));
      doc[key].forEach((w, i) => {
        const box = el('div', 'ed-wave'); box.appendChild(el('b', '', `第 ${i + 1} 波`));
        w.forEach((e, j) => { const row = el('div', 'ed-row'), sl = el('select'), n = el('input');
          for (const k of kinds) { const o = el('option', '', kindName(k)); o.value = k; sl.appendChild(o); } sl.value = e[0]; n.type = 'number'; n.min = 1; n.max = 8; n.step = 1; n.inputMode = 'numeric'; n.value = e[1];
          sl.addEventListener('change', () => setAt([key, i, j, 0], sl.value)); n.addEventListener('change', () => setAt([key, i, j, 1], Math.round(parseFloat(n.value) || 1)));
          row.append(sl, n, btn('刪', 'mini', () => { if (w.length < 2) return say('每一波至少要有一種怪。'); w.splice(j, 1); commit(); })); box.appendChild(row); });
        if (w.length < 4) box.appendChild(btn('加一種怪', 'mini', () => { w.push([kinds[0], 1]); commit(); }));
        g.appendChild(box);
      });
      body.appendChild(g);
    };
    part('沉鐘塔', 'waves', S.TOWER_KINDS, '四波，打完最後一波就通關。波數目前固定是四波。');
    part('漲潮（野外事件）', 'evWaves', S.FIELD_KINDS, '三波。螃蟹的數量還會隨在場人數增加。');
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
    body.appendChild(note('可以改標題、目標文字、需要的次數和獎勵。任務怎麼計數寫在程式裡，所以還不能新增任務。獎勵填 0 就是不給那一項。'));
    for (const [key, title] of [['main', '主線（照順序）'], ['week', '每週'], ['side', '支線']]) {
      const g = group(title), ul = list();
      doc.quests[key].forEach((q, i) => ul.appendChild(card('q:' + q.id, q.title, q.goal, b => b.append(form(['quests', key, i]), el('h3', '', '獎勵'), amounts(['quests', key, i, 'reward'], ['coin', 'xp', 'potion'].concat(Object.keys(S.MATS)), 1, 99999)), !same(q, base.quests[key][i]))));
      g.appendChild(ul); body.appendChild(g);
    }
  },
  map: mapView
};

/* ---------- the map: drag things about, tap to select, add with a tool ---------- */
const LAYERS = [['packs', '怪群', 16], ['nodes', '採集點', 12], ['rocks', '岩石', 0], ['events', '漲潮點', 20], ['npcs', '營地的人', 14], ['stalls', '攤位', 14]];
function mapView(body) {
  const f = doc.field, tools = el('div', 'tabs'), wrap = el('div', 'ed-map'), cv = el('canvas'), panel = el('div', 'ed-panel');
  for (const [k, t] of [['move', '移動／選取'], ['packs', '＋怪群'], ['nodes', '＋採集點'], ['rocks', '＋岩石'], ['events', '＋漲潮點']]) tools.appendChild(btn(t, 'mini' + (tool === k ? ' on' : ''), () => { tool = k; render(); }));
  body.append(note(tool === 'move' ? '拖曳可以移動，點一下可以選取，選到的東西在地圖下面改細節。要捲動頁面請拖地圖以外的地方。' : '在地圖上點一下要放的位置。'), tools, wrap, panel); wrap.appendChild(cv);
  const cw = Math.min(wrap.clientWidth || 340, Math.floor((window.innerHeight - 330) * f.w / f.h), 480), k = cw / f.w, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.style.width = cw + 'px'; cv.style.height = Math.round(f.h * k) + 'px'; cv.width = Math.round(cw * dpr); cv.height = Math.round(f.h * k * dpr);
  const c = cv.getContext('2d'), css = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim() || '#888';
  const col = { packs: css('rust'), nodes: css('heal'), rocks: css('line'), events: css('ember'), npcs: css('foam'), stalls: css('brass') };
  const at = s => s.single ? f[s.single] : f[s.list][s.i], isSel = (l, i) => sel && sel.list === l && sel.i === i;
  function draw() {
    c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0); c.fillStyle = css('deep'); c.fillRect(0, 0, f.w, f.h);
    c.strokeStyle = css('line'); c.lineWidth = 2; c.setLineDash([10, 10]); c.beginPath(); c.arc(S.FIELD.safe.x, S.FIELD.safe.y, S.FIELD.safe.r, 0, 7); c.stroke(); c.setLineDash([]);
    c.font = '700 26px sans-serif'; c.textAlign = 'center'; c.fillStyle = css('mute'); c.fillText('營地（怪不會進來）', S.FIELD.safe.x, S.FIELD.safe.y + S.FIELD.safe.r + 30);
    for (const o of f.rocks) { c.fillStyle = col.rocks; c.beginPath(); c.arc(o.x, o.y, o.r, 0, 7); c.fill(); }
    f.events.forEach((o, i) => { c.strokeStyle = col.events; c.lineWidth = isSel('events', i) ? 6 : 3; c.setLineDash([14, 10]); c.beginPath(); c.arc(o.x, o.y, o.r, 0, 7); c.stroke(); c.setLineDash([]); c.fillStyle = col.events; c.fillText('漲潮', o.x, o.y + 9); });
    f.packs.forEach((o, i) => { c.fillStyle = col.packs; c.beginPath(); c.arc(o.x, o.y, 26, 0, 7); c.fill(); c.fillStyle = css('ink'); c.fillText(o.n, o.x, o.y + 9); c.fillStyle = css('foam'); c.fillText(`${kindName(o.kind).slice(0, 3)} ${o.min}-${o.max}`, o.x, o.y - 34); });
    f.nodes.forEach(o => { c.fillStyle = o.type === 'herb' ? col.nodes : o.type === 'salt' ? css('foam') : css('brass'); c.fillRect(o.x - 14, o.y - 14, 28, 28); });
    f.npcs.forEach(o => { c.fillStyle = col.npcs; c.beginPath(); c.arc(o.x, o.y, 16, 0, 7); c.fill(); c.fillText(window.Story && Story.CAST[o.id] ? Story.CAST[o.id].name : o.id, o.x, o.y - 24); });
    f.stalls.forEach(o => { const d = S.FIELD.stalls.find(x => x.id === o.id); c.fillStyle = col.stalls; c.fillRect(o.x - 16, o.y - 16, 32, 32); c.fillText(d ? d.name : o.id, o.x, o.y - 24); });
    c.fillStyle = css('brass'); c.beginPath(); c.moveTo(f.gate.x, f.gate.y - 34); c.lineTo(f.gate.x + 30, f.gate.y + 22); c.lineTo(f.gate.x - 30, f.gate.y + 22); c.closePath(); c.fill(); c.fillText('塔門', f.gate.x, f.gate.y + 56);
    if (sel) { const o = at(sel); if (o) { c.strokeStyle = css('foam'); c.lineWidth = 5; c.beginPath(); c.arc(o.x, o.y, (o.r || 26) + 12, 0, 7); c.stroke(); } }
  }
  const hit = p => { let best = null, bd = 44 / Math.max(k, .3) * .5 + 30; const tryOne = (s, o, r) => { const d = Math.hypot(o.x - p.x, o.y - p.y) - (r || 0) * .6; if (d < bd) { bd = d; best = s; } };
    tryOne({ single: 'gate' }, f.gate); for (const [l, , r] of LAYERS) f[l].forEach((o, i) => tryOne({ list: l, i }, o, l === 'rocks' ? o.r : r)); return best; };
  const pos = ev => { const r = cv.getBoundingClientRect(); return { x: Math.round((ev.clientX - r.left) / k), y: Math.round((ev.clientY - r.top) / k) }; };
  let drag = null;
  cv.addEventListener('pointerdown', ev => {
    ev.preventDefault(); const p = pos(ev);
    if (tool !== 'move') {
      const fresh = tool === 'packs' ? { kind: 'crab', x: p.x, y: p.y, n: 2, min: 1, max: 6 } : tool === 'nodes' ? { id: 1 + f.nodes.reduce((m, o) => Math.max(m, o.id), 0), type: 'herb', x: p.x, y: p.y } : tool === 'rocks' ? { x: p.x, y: p.y, r: 32 } : { x: p.x, y: p.y, r: 115 };
      const before = f[tool].length; f[tool].push(fresh); sel = { list: tool, i: before }; tool = 'move'; commit(); if (doc.field[sel.list].length <= before) { sel = null; say('放不下：已經到這一種的數量上限，或位置太靠邊。'); render(); } return;
    }
    sel = hit(p); if (sel) { drag = { id: ev.pointerId, moved: false }; try { cv.setPointerCapture(ev.pointerId); } catch (e) {} } draw(); showPanel();
  });
  cv.addEventListener('pointermove', ev => { if (!drag || ev.pointerId !== drag.id || !sel) return; const p = pos(ev), o = at(sel); o.x = Math.max(20, Math.min(f.w - 20, p.x)); o.y = Math.max(20, Math.min(f.h - 20, p.y)); drag.moved = true; draw(); });
  const up = ev => { if (!drag || ev.pointerId !== drag.id) return; const moved = drag.moved; drag = null; if (moved) commit(); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  function showPanel() {
    panel.textContent = ''; if (!sel) return panel.appendChild(note('還沒選東西。'));
    const o = at(sel); if (!o) { sel = null; return; }
    const title = sel.single ? '塔門' : LAYERS.find(l => l[0] === sel.list)[1], p = sel.single ? ['field', 'gate'] : ['field', sel.list, sel.i], box = el('div', 'fields');
    panel.appendChild(el('h3', '', `選到：${title}　位置 ${o.x}, ${o.y}`));
    if (sel.list === 'packs') box.append(pickField('怪物', p.concat('kind'), S.FIELD_KINDS.map(x => [x, kindName(x)])), numField('數量', p.concat('n'), S.LIM.n), numField('最低等級', p.concat('min'), S.LIM.min), numField('最高等級', p.concat('max'), S.LIM.max));
    if (sel.list === 'nodes') box.append(pickField('種類', p.concat('type'), S.NODE_TYPES.map(x => [x, NODEL[x]])));
    if (sel.list === 'rocks') box.append(numField('大小', p.concat('r'), ['', 10, 80, 1]));
    if (sel.list === 'events') box.append(numField('範圍', p.concat('r'), ['', 60, 200, 5]));
    panel.appendChild(box);
    if (sel.list === 'packs') panel.appendChild(note('野怪的等級會跟著玩家，但不會低於最低等級、不會高於最高等級。'));
    if (['packs', 'nodes', 'rocks', 'events'].includes(sel.list)) panel.appendChild(btn('刪除這個', 'mini', () => { const arr = doc.field[sel.list]; if (sel.list !== 'rocks' && arr.length < 2) return say('至少要留一個。'); arr.splice(sel.i, 1); sel = null; commit(); }));
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
.ed-wave{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1.5px solid var(--line);border-radius:8px;background:var(--deep)}
.ed-map{display:flex;justify-content:center} .ed-map canvas{touch-action:none;border:1.5px solid var(--line);border-radius:8px}
.ed-panel{display:flex;flex-direction:column;gap:8px} .ed-panel h3,#ed-body h3{margin:4px 0 0;font-size:12px;letter-spacing:.1em;color:var(--mute);font-weight:400}
#ed-foot{position:sticky;bottom:0;display:flex;flex-direction:column;gap:6px;margin:auto calc(-1 * var(--gr)) -20px calc(-1 * var(--gl));padding:10px var(--gr) 14px var(--gl);background:var(--ink);border-top:1px solid var(--line)}
#ed-foot .row{display:flex;gap:6px} #ed-foot .mini{flex:1;min-width:0;padding:0 6px} #ed-foot .note{font-size:11px}
#ed-reset{align-self:flex-start}
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
