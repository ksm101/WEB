/* Account storage for the Embertide server.
 * Records live in memory and are written to one JSON file when a data directory is available.
 * Every record can also be packed into a signed backup string that the player's own device keeps:
 * if the server loses its disk (free hosting often does), the device hands the backup back and the
 * signature proves the server wrote it. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore(dir, secretOpt) {
  const recs = new Map(); let file = null, timer = null, secret = secretOpt || process.env.EMBERTIDE_SECRET || '';
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true }); file = path.join(dir, 'accounts.json');
      if (fs.existsSync(file)) {
        try { for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) if (r && r.id) recs.set(r.id, r); }
        catch (e) { const bad = path.join(dir, 'accounts.bad-' + Date.now() + '.json'); fs.renameSync(file, bad); console.warn('store: could not read accounts.json, moved it to ' + bad); }
      }
      if (!secret) {
        const sf = path.join(dir, 'secret');
        if (fs.existsSync(sf)) secret = fs.readFileSync(sf, 'utf8').trim();
        else { secret = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(sf, secret, { mode: 0o600 }); }
      }
    } catch (e) { console.warn('store: no disk persistence (' + e.message + ')'); file = null; }
  }
  if (!secret) secret = crypto.randomBytes(32).toString('hex');   // backups from before a restart will not verify

  const write = () => {
    timer = null; if (!file) return;
    try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(Array.from(recs.values()))); fs.renameSync(tmp, file); }
    catch (e) { console.warn('store: write failed (' + e.message + ')'); }
  };
  const sign = s => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  const same = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return {
    persistent: !!file,
    get: id => recs.get(id),
    all: () => recs.values(),
    size: () => recs.size,
    put(rec) { recs.set(rec.id, rec); if (file && !timer) timer = setTimeout(write, 1500); },
    flush() { if (timer) clearTimeout(timer); write(); },
    token: id => sign('tok:' + id).slice(0, 32),
    checkToken(id, token) { return same(token, sign('tok:' + id).slice(0, 32)); },
    pack(rec) { const body = Buffer.from(JSON.stringify(rec)).toString('base64url'); return body + '.' + sign('bk:' + body); },
    unpack(bk) {
      if (typeof bk !== 'string' || bk.length > 12000) return null;
      const i = bk.lastIndexOf('.'); if (i < 1) return null;
      const body = bk.slice(0, i); if (!same(bk.slice(i + 1), sign('bk:' + body))) return null;
      try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
    }
  };
}
module.exports = { createStore };
