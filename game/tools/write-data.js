/* Write the editor's numbers into game/data.js.
 *   node tools/write-data.js saved.json     (the text the editor saves or copies)
 *   node tools/write-data.js --reset        (back to the defaults in sim.js)
 * The input goes through Sim.applyData(), so only valid values survive, and only what differs from the defaults in
 * sim.js is written: a later change to a default is not hidden by an old copy of it here. */
'use strict';
const fs = require('fs'), path = require('path');
const Sim = require('../sim.js');                    // sim.js alone: the defaults, without data.js on top
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
/* fields of `now` that differ from `was`, keeping the shape; whole lists and anything that is not a plain object are kept as one piece */
function changed(now, was) {
  if (!isObj(now) || !isObj(was)) return same(now, was) ? undefined : now;
  const out = {}; for (const k of Object.keys(now)) { const v = changed(now[k], was[k]); if (v !== undefined) out[k] = v; }
  return Object.keys(out).length ? out : undefined;
}
function minimal(doc, def) {
  const out = {};
  for (const k of ['tune', 'classes', 'skills', 'enemies', 'drop']) { const v = changed(doc[k], def[k]); if (v) out[k] = v; }
  for (const k of ['shop', 'talents', 'sets', 'plain', 'waves', 'evWaves']) if (!same(doc[k], def[k])) out[k] = doc[k];
  const recipes = doc.recipes.filter((r, i) => !same(r.cost, def.recipes[i].cost)).map(r => ({ id: r.id, cost: r.cost })); if (recipes.length) out.recipes = recipes;
  const quests = {}; for (const g of ['main', 'week', 'side']) { const list = doc.quests[g].filter((q, i) => !same(q, def.quests[g][i])); if (list.length) quests[g] = list; } if (Object.keys(quests).length) out.quests = quests;
  const field = {}; for (const k of ['gate', 'packs', 'nodes', 'rocks', 'events', 'npcs', 'stalls']) if (!same(doc.field[k], def.field[k])) field[k] = doc.field[k]; if (Object.keys(field).length) out.field = field;
  return out;
}
function main(arg) {
  const def = Sim.exportData(); let input = {};
  if (arg !== '--reset') { if (!arg) throw new Error('give a JSON file, or --reset'); input = JSON.parse(fs.readFileSync(arg, 'utf8')); if (typeof input.json === 'string') input = JSON.parse(input.json); }
  Sim.applyData(input); const doc = Sim.exportData(), data = minimal(doc, def);
  const text = `/* The game's numbers, where they differ from the defaults written in sim.js.
 * This file is written by tools/write-data.js from what the editor saved (the 編輯器 button in the game).
 * Anything not listed keeps its default. The server applies it at start; the page loads it before sim.js. */
(function (root, data) {
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.EmbertideData = data;
})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(data, null, 1)});
`;
  fs.writeFileSync(path.join(__dirname, '..', 'data.js'), text);
  return data;
}
if (require.main === module) { const d = main(process.argv[2]); console.log('data.js written; sections changed from the defaults: ' + (Object.keys(d).join(', ') || 'none')); }
module.exports = { minimal, changed };
