/* The game's numbers, where they differ from the defaults written in sim.js.
 * This file is written by tools/write-data.js from what the editor saved (the 編輯器 button in the game).
 * Anything not listed keeps its default. The server applies it at start; the page loads it before sim.js. */
(function (root, data) {
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.EmbertideData = data;
})(typeof self !== 'undefined' ? self : this, {});
