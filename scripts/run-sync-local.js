/**
 * Run the sync logic locally, e.g. `node scripts/run-sync-local.js`,
 * without needing Vercel. Reads the same env vars as production
 * (load a .env file yourself, e.g. with `node --env-file=.env`).
 */
const handler = require('../api/sync');

const req = { method: 'GET', headers: {} };
const res = {
  status(code) { this._status = code; return this; },
  json(body) { console.log(`HTTP ${this._status}`); console.log(JSON.stringify(body, null, 2)); },
};

handler(req, res).catch(err => { console.error(err); process.exit(1); });
