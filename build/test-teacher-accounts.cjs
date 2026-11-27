// Local-only D1 regression tests. No production accounts, data or credentials are used.
// npm install --prefix /tmp/event-centre-test-tools wrangler@4.168.0 playwright@1.58.2
// NODE_PATH=/tmp/event-centre-test-tools/node_modules node build/test-teacher-accounts.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require('miniflare');
const root = path.resolve(__dirname, '..');
const fixturePassword = 'fixture-only-sign-in';
const fontKey = Buffer.alloc(32, 7).toString('base64');
function event(id, support = []) {
  return { id, v: 4, date: '26/12/05', name: 'Fixture Maths', asmTime: '08:00', venue: 'Fixture Lobby',
    leading: ['LCY'], support, lead: 'Fixture Chair', remarks: '', groups: [], mcs: [], rows: [], tasks: [], awards: {}, guests: null, att: {}, leave: {}, log: [], upd: {} };
}
async function harness() {
  const bundle = await build({ stdin: { contents: `import {handleEvents} from './src/events-api.js';
    export default {fetch(request,env) {const url=new URL(request.url);return handleEvents(request,env,url,url.pathname.slice(5));}};`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'fixture-seed', setup(b) { b.onResolve({ filter: /accounts-seed\.js$/ }, () => ({ path: 'fixture-seed', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const SEED = {};', loader: 'js' })); } }] });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'fixture', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-01',
    d1Databases: ['DB'], bindings: { FONT_KEY: fontKey } }], log: new Log(LogLevel.NONE) }));
  const db = await mf.getD1Database('DB');
  const raw = (p, token, method = 'GET', data) => mf.dispatchFetch('http://fixture/api/' + p, { method,
    headers: { 'x-page': '4', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}) });
  await raw('state'); // Creates the same tables as the real Worker, with no production seed.
  const salt = '11'.repeat(16), digest = crypto.pbkdf2Sync(fixturePassword, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
  await db.prepare('INSERT INTO accounts (id,hash,changed) VALUES (?,?,?)').bind('Event Lead', salt + ':' + digest, 1).run();
  for (const [k, v] of [['chairs', ['Fixture Chair']], ['admins', ['LCY']], ['rosters', {}]])
    await db.prepare('INSERT INTO settings (k,v) VALUES (?,?)').bind(k, JSON.stringify(v)).run();
  async function login(account, password) { const r = await raw('login', null, 'POST', { account, password }); assert.ok(r.ok, 'fixture login succeeds'); return (await r.json()).token; }
  const token = await login('Event Lead', fixturePassword);
  async function api(p, method = 'GET', data, t = token) { const r = await raw(p, t, method, data); return { status: r.status, body: await r.json() }; }
  async function save(ev, rev = 0) { return api('events/' + ev.id, 'PUT', { data: JSON.stringify(ev), rev }); }
  async function seed(ev) { await db.prepare('INSERT INTO events (id,data,deleted,updated,seq) VALUES (?,?,0,?,(SELECT COALESCE(MAX(seq),0)+1 FROM events))').bind(ev.id, JSON.stringify(ev), Date.now()).run(); }
  async function storedHash(code) { return (await db.prepare('SELECT hash FROM accounts WHERE id=?').bind(code).first())?.hash; }
  return { mf, db, raw, api, save, seed, login, token, storedHash, dispose: () => mf.dispose() };
}
async function newAccounts() {
  const h = await harness();
  try {
    const first = await h.save(event('new', ['NCL', ' wkw2 '])); assert.equal(first.status, 200);
    assert.ok(first.body.made?.some(x => x.id === 'WKW2'), 'adding WKW2 creates its own account and notification');
    assert.ok(first.body.made.some(x => x.id === 'NCL'), 'letter-only NCL remains supported');
    const before = await h.storedHash('WKW2'), ncl = await h.storedHash('NCL');
    const again = await h.save(event('new', ['NCL', 'WKW2']), first.body.rev);
    assert.ok(!again.body.made?.length, 'saving again does not recreate or renotify');
    assert.ok(before === await h.storedHash('WKW2') && ncl === await h.storedHash('NCL'), 'existing account credentials remain unchanged');
    const valid = ['AB1', 'ABCDE9'];
    for (const [i, c] of valid.entries()) assert.ok((await h.save(event('valid' + i, [c]))).body.made?.some(x => x.id === c), 'one suffix digit is supported');
    const invalid = ['A2', 'WKW22', 'W2KW', '2WKW', 'ABCDEF2', 'WKW-2', 'teacher@example.test', 'Editor', 'Viewer', 'Event Lead'];
    for (const [i, c] of invalid.entries()) assert.ok(!(await h.save(event('invalid' + i, [c]))).body.made?.length, 'unrelated usernames are not teacher codes');
    // Simultaneous saves must not each overwrite the new teacher's sign-in.
    const pair = await Promise.all([h.save(event('race1', ['RAC2'])), h.save(event('race2', ['RAC2']))]);
    assert.equal(pair.flatMap(x => x.body.made || []).filter(x => x.id === 'RAC2').length, 1, 'concurrent creation has one account owner and notification');
  } finally { await h.dispose(); }
  console.log('PASS new numeric-suffix accounts, letter controls, narrow policy and concurrent saves');
}
async function recovery() {
  const h = await harness();
  try {
    const existing = await h.save(event('ncl', ['NCL'])); const nclHash = await h.storedHash('NCL');
    await h.api('fresh', 'DELETE');
    const old = event('legacy', ['WKW2']); await h.seed(old); await h.seed(event('unrelated', ['OTHER']));
    const snap = await h.db.prepare('SELECT data,seq FROM events WHERE id=?').bind('legacy').first();
    const state = await h.api('state');
    assert.ok(state.body.fresh?.some(x => x.id === 'WKW2'), 'opening an existing event recovers its missing suffix account');
    assert.ok(nclHash === await h.storedHash('NCL'), 'recovery preserves the existing NCL credential');
    assert.ok(!await h.storedHash('OTHER'), 'recovery does not revive deliberately missing letter-only accounts');
    const after = await h.db.prepare('SELECT data,seq FROM events WHERE id=?').bind('legacy').first();
    assert.deepEqual(after, snap, 'recovery never rewrites the saved event or revision');
    const recoveredHash = await h.storedHash('WKW2');
    const teacherToken = await h.login('wkw2', state.body.fresh.find(x => x.id === 'WKW2').password);
    const teacher = await h.api('state', 'GET', null, teacherToken);
    assert.deepEqual(teacher.body.rows.filter(x => !x.deleted).map(x => x.id), ['legacy'], 'teacher only receives its assigned event');
    assert.ok(!teacher.body.fresh, 'teacher does not receive the account notification');
    assert.equal((await h.api('events/legacy', 'PUT', { rev: snap.seq, data: JSON.stringify({ ...old, name: 'Fixture altered' }) }, teacherToken)).status, 403, 'teacher stays read-only');
    await h.api('fresh', 'DELETE');
    const again = await h.api('state?full=1');
    assert.ok(!again.body.fresh?.length && recoveredHash === await h.storedHash('WKW2'), 'reopening neither resets the sign-in nor repeats the acknowledged notification');
    await h.api('account', 'DELETE', { id: 'WKW2' });
    await h.api('state?full=1');
    assert.ok(!await h.storedHash('WKW2'), 'one-time recovery respects a later deliberate account deletion');
    assert.ok(existing.body.made.some(x => x.id === 'NCL'), 'NCL control account was created through the original save path');
  } finally { await h.dispose(); }
  console.log('PASS saved-event recovery, no repeat/reset, existing deletion semantics and teacher access scope');
}
async function main() { await newAccounts(); await recovery(); }
async function serve(h) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://fixture');
      if (u.pathname.startsWith('/api/')) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const response = await h.mf.dispatchFetch('http://fixture' + req.url, { method: req.method, headers: req.headers,
          ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (u.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const file = u.pathname === '/' ? path.join(root, 'src/events.html') : path.resolve(root, 'public', '.' + u.pathname);
      if (u.pathname !== '/' && !file.startsWith(path.join(root, 'public') + path.sep)) { res.writeHead(404); res.end(); return; }
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(500); res.end('Fixture request failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
if (require.main === module) main().catch(e => { console.error(e.name + ': ' + e.message); console.error('FAIL teacher-account regression; no credential values printed'); process.exitCode = 1; });
module.exports = { harness, event, fixturePassword, root, serve };
