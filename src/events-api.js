// Events: accounts, sessions, rosters and one record per event, with rights checked here.
// Rights come only from being on duty (Decision Record A5): the Event Lead edits everything; a Group Lead
// edits their own group's roles, Acting Group Lead and attendance, the tasks given to their own group's roles
// or members, and their group's kind of document; a small group edits its kind of document; the teacher reads.
// An event is compared with the stored one piece by piece ("units"), and every changed piece must be allowed.
import { SEED } from "./accounts-seed.js";

const GROUPS = ["MC", "Backstage", "Reception"].flatMap((m) => ["A", "B", "C", "D"].map((x) => `${m} Group ${x}`));
export const ACCOUNTS = [
  { id: "Event Lead", type: "lead" }, { id: "Teacher", type: "teacher" },
  ...GROUPS.map((g) => ({ id: g, type: "group", group: g })),
  ...GROUPS.map((g) => ({ id: g + " Lead", type: "gl", group: g }))
];
const DOC_OF = { MC: "script", Backstage: "awardees", Reception: "guests" };
const kindOf = (g) => g.split(" ")[0];
const MAX_EVENT = 900000, SESSION_DAYS = 180, ROUNDS = 100000, MIN_PASSWORD = 8, MAX_FAILS = 5, LOCK_MS = 15 * 60000;
// Passwords ignore capitals and spaces, so a phone keyboard that capitalises or adds a space does not lock anyone out.
const normal = (pw) => String(pw || "").toLowerCase().replace(/\s+/g, "");

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: ROUNDS }, key, 256));
}
async function sha(text) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))); }
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

let ready = null;
export function ensureEventTables(db) {
  if (!ready) ready = db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, changed INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account TEXT NOT NULL, created INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, seq INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS events_seq ON events (seq)"),
    db.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS login_fail (account TEXT PRIMARY KEY, n INTEGER NOT NULL, since INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS photos (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)")
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

// The session's account, or null. Group accounts send the member's chosen name in x-who (for Acting Group Lead).
export async function sessionOf(request, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get("authorization") || "");
  if (!m) return null;
  const row = await env.DB.prepare("SELECT account, created FROM sessions WHERE token = ?").bind(await sha(m[1])).first();
  if (!row || Date.now() - row.created > SESSION_DAYS * 864e5) return null;
  const acct = ACCOUNTS.find((a) => a.id === row.account);
  if (!acct) return null;
  let who = request.headers.get("x-who") || "";
  try { who = decodeURIComponent(who); } catch { who = ""; }
  return { ...acct, who: who.slice(0, 40) };
}

async function hashOf(env, id) {
  const row = await env.DB.prepare("SELECT hash FROM accounts WHERE id = ?").bind(id).first();
  return row ? row.hash : SEED[id] || null;
}
async function login(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const typed = String(body.account || "").trim().toLowerCase().replace(/\s+/g, " ");
  const acct = ACCOUNTS.find((a) => a.id.toLowerCase() === typed);
  if (!acct) { await new Promise((r) => setTimeout(r, 400)); return json({ error: "Wrong account or password" }, 401); }
  // Short passwords are safe because guessing is slow: five wrong tries lock the account for 15 minutes.
  const fail = await env.DB.prepare("SELECT n, since FROM login_fail WHERE account = ?").bind(acct.id).first();
  const now = Date.now(), fresh = fail && now - fail.since < LOCK_MS;
  if (fresh && fail.n >= MAX_FAILS) return json({ error: "Too many tries. Wait 15 minutes, or ask a chair to set a new password." }, 429);
  const stored = await hashOf(env, acct.id), pw = normal(body.password);
  if (!stored || !pw || !same(await pbkdf2(pw, stored.split(":")[0]), stored.split(":")[1])) {
    await env.DB.prepare("INSERT INTO login_fail (account, n, since) VALUES (?1, 1, ?2) ON CONFLICT (account) DO UPDATE SET n = CASE WHEN ?2 - since < ?3 THEN n + 1 ELSE 1 END, since = CASE WHEN ?2 - since < ?3 THEN since ELSE ?2 END").bind(acct.id, now, LOCK_MS).run();
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: "Wrong account or password" }, 401);
  }
  if (fail) await env.DB.prepare("DELETE FROM login_fail WHERE account = ?").bind(acct.id).run();
  const token = hex(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare("INSERT INTO sessions (token, account, created) VALUES (?, ?, ?)").bind(await sha(token), acct.id, Date.now()).run();
  return json({ token, account: acct });
}

// ---------- Profile photos ----------
const MAX_PHOTO = 80000;  // a 192-pixel square JPEG is about 10-20 KB as text
async function photoVersions(env) {
  const { results } = await env.DB.prepare("SELECT name, updated FROM photos").all();
  return Object.fromEntries(results.map((r) => [r.name, r.updated]));
}
async function settingOf(env, k) {
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k = ?").bind(k).first();
  try { return row ? JSON.parse(row.v) : null; } catch { return null; }
}
// A person changes only their own photo: the name they are signed in as. The Event Lead may also remove anyone's.
async function mayChangePhoto(env, acct, name, data) {
  if (acct.type === "lead") return data === null || (acct.who === name && ((await settingOf(env, "chairs")) || []).includes(name));
  if (acct.type === "teacher") return false;
  const r = ((await settingOf(env, "rosters")) || {})[acct.group] || {};
  if (acct.type === "gl") return !!r.lead && r.lead.name === name;
  return acct.who === name && (r.people || []).some((p) => p.name === name);
}

// ---------- Units: the pieces of an event that rights are checked on ----------
const FIELDS = ["date", "name", "start", "end", "venue", "leading", "support", "lead", "remarks"];
const KNOWN = new Set([...FIELDS, "id", "groups", "lines", "docs", "log", "attendance", "attTime"]);
function units(ev) {
  const u = new Map(), put = (k, v) => u.set(k, JSON.stringify(v === undefined ? null : v));
  if (!ev) return u;
  FIELDS.forEach((f) => put("f:" + f, ev[f]));
  Object.keys(ev).filter((k) => !KNOWN.has(k)).forEach((k) => put("x:" + k, ev[k]));
  put("groups", (ev.groups || []).map((g) => g.name).sort());
  (ev.groups || []).forEach((g) => { put(`g:${g.name}:lead`, g.lead); put(`g:${g.name}:roles`, g.roles); put(`g:${g.name}:acting`, g.acting || null); });
  (ev.lines || []).forEach((l) => {
    put("l:" + l.id, { time: l.time, title: l.title, place: l.place, remarks: l.remarks });
    (l.tasks || []).forEach((t) => put("t:" + t.id, { line: l.id, text: t.text, to: t.to }));
  });
  (ev.docs || []).forEach((d) => put("d:" + d.id, d));
  const some = (x) => !!x && Object.keys(x).length > 0;
  GROUPS.forEach((g) => { const a = (ev.attendance || {})[g], t = (ev.attTime || {})[g]; if (some(a) || some(t)) put("a:" + g, { a: a || {}, t: t || {} }); });
  return u;
}
const onDuty = (ev, g) => !!ev && (ev.groups || []).some((x) => x.name === g);
// The group whose Group Lead rights this session has in this event: a Group Lead on duty, or the member a
// Group Lead named Acting Group Lead, signed in on the group's account.
function leadsGroup(acct, ev) {
  if (!acct.group || !onDuty(ev, acct.group)) return null;
  if (acct.type === "gl") return acct.group;
  const g = ev.groups.find((x) => x.name === acct.group);
  return acct.type === "group" && acct.who && g && g.acting === acct.who ? acct.group : null;
}
function taskOf(ev, id) { for (const l of (ev && ev.lines) || []) for (const t of l.tasks || []) if (t.id === id) return t; return null; }
function docOf(ev, id) { return ((ev && ev.docs) || []).find((d) => d.id === id) || null; }
// A Group Lead's task: given to one of their own roles or members, or not yet given to anyone.
const ownTask = (t, g) => !t || !t.to || (/^[rp]:/.test(t.to) && t.to.split(":")[1] === g);
function allowed(acct, old, key) {
  if (acct.type === "lead") return true;
  if (acct.type === "teacher" || !old) return false;
  const g = leadsGroup(acct, old), mine = acct.group && onDuty(old, acct.group) ? DOC_OF[kindOf(acct.group)] : null;
  return (nw) => {
    if (key.startsWith("d:")) { const a = docOf(old, key.slice(2)), b = docOf(nw, key.slice(2)); return !!mine && (!a || a.type === mine) && (!b || b.type === mine); }
    if (!g) return false;
    if (key === `g:${g}:roles` || key === `g:${g}:acting` || key === "a:" + g) return true;
    if (key.startsWith("t:")) return ownTask(taskOf(old, key.slice(2)), g) && ownTask(taskOf(nw, key.slice(2)), g);
    return false;
  };
}
// What an account may read: attendance only for the Event Lead and the group's own Group Lead.
function visible(acct, ev) {
  if (!ev || acct.type === "lead") return ev;
  const g = leadsGroup(acct, ev), out = { ...ev, attendance: {}, attTime: {} };
  if (g) { out.attendance[g] = (ev.attendance || {})[g] || {}; out.attTime[g] = (ev.attTime || {})[g] || {}; }
  return out;
}
// A write keeps what the writer could not see.
function withHidden(acct, old, nw) {
  if (acct.type === "lead" || !old) return nw;
  const g = leadsGroup(acct, old), a = { ...(old.attendance || {}) }, t = { ...(old.attTime || {}) };
  if (g) { a[g] = (nw.attendance || {})[g] || {}; t[g] = (nw.attTime || {})[g] || {}; }
  return { ...nw, attendance: a, attTime: t };
}
function checkWrite(acct, old, nw) {
  const a = units(old), b = units(nw);
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(k) === b.get(k)) continue;
    const rule = allowed(acct, old, k);
    if (rule === true) continue;
    if (rule && rule(nw)) continue;
    return k;
  }
  return null;
}
// History keeps every entry, but only the latest entries keep a copy to restore from, so an event stays small.
function trimLog(ev) {
  if (!Array.isArray(ev.log)) ev.log = [];
  ev.log = ev.log.slice(0, 300).map((e, i) => (i < 12 ? e : { ...e, snap: undefined }));
  return ev;
}

export async function handleEvents(request, env, url, path) {
  await ensureEventTables(env.DB);
  if (path === "login" && request.method === "POST") return login(request, env);
  const acct = await sessionOf(request, env);
  if (!acct) return json({ error: "signin" }, 401);

  if (path === "logout" && request.method === "POST") {
    const m = /^Bearer (.+)$/.exec(request.headers.get("authorization") || "");
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha(m[1])).run();
    return json({ ok: true });
  }

  if (path === "state" && request.method === "GET") {
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    const { results } = await env.DB.prepare("SELECT id, data, deleted, seq FROM events WHERE seq > ? ORDER BY seq").bind(since).all();
    const rows = results.map((r) => ({ id: r.id, rev: r.seq, deleted: !!r.deleted, data: r.deleted ? null : JSON.stringify(visible(acct, JSON.parse(r.data))) }));
    const out = { account: { id: acct.id, type: acct.type, group: acct.group || null }, rows, photos: await photoVersions(env) };
    if (!since || url.searchParams.get("full")) {
      const s = await env.DB.prepare("SELECT k, v FROM settings WHERE k IN ('rosters', 'chairs')").all();
      const map = Object.fromEntries(s.results.map((r) => [r.k, JSON.parse(r.v)]));
      out.rosters = map.rosters || {}; out.chairs = map.chairs || [];
    }
    return json(out);
  }

  // Save one event. "rev" is the version the writer started from (0 for a new event); if someone else saved
  // in between, the answer is 409 with the current version, which the page merges and sends again.
  const m = /^events\/([A-Za-z0-9_-]{1,40})$/.exec(path);
  if (m && request.method === "PUT") {
    let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
    const id = m[1], rev = Number(body.rev) || 0;
    const row = await env.DB.prepare("SELECT data, deleted, seq FROM events WHERE id = ?").bind(id).first();
    if ((row ? row.seq : 0) !== rev) return json({ error: "conflict", rev: row ? row.seq : 0, deleted: row ? !!row.deleted : false, data: row && !row.deleted ? JSON.stringify(visible(acct, JSON.parse(row.data))) : null }, 409);
    const old = row && !row.deleted ? JSON.parse(row.data) : null;
    const next = "(SELECT COALESCE(MAX(seq), 0) + 1 FROM events)";
    if (body.deleted) {
      if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
      const saved = await env.DB.prepare("INSERT INTO events (id, data, deleted, updated, seq) VALUES (?1, ?2, 1, ?3, " + next + ") ON CONFLICT (id) DO UPDATE SET deleted = 1, updated = ?3, seq = " + next + " RETURNING seq").bind(id, row ? row.data : "{}", Date.now()).first();
      return json({ rev: saved.seq });
    }
    if (typeof body.data !== "string" || body.data.length > MAX_EVENT) return json({ error: "bad request" }, 400);
    let nw; try { nw = JSON.parse(body.data); } catch { return json({ error: "bad request" }, 400); }
    if (!nw || typeof nw !== "object" || nw.id !== id) return json({ error: "bad request" }, 400);
    nw = trimLog(withHidden(acct, old, nw));
    const denied = checkWrite(acct, old, nw);
    if (denied) return json({ error: "forbidden", unit: denied }, 403);
    const data = JSON.stringify(nw);
    if (data.length > MAX_EVENT) return json({ error: "too large" }, 413);
    const saved = row
      ? await env.DB.prepare("UPDATE events SET data = ?1, deleted = 0, updated = ?2, seq = " + next + " WHERE id = ?3 AND seq = ?4 RETURNING seq").bind(data, Date.now(), id, rev).first()
      : await env.DB.prepare("INSERT INTO events (id, data, deleted, updated, seq) VALUES (?1, ?2, 0, ?3, " + next + ") ON CONFLICT (id) DO NOTHING RETURNING seq").bind(id, data, Date.now()).first();
    if (!saved) return json({ error: "conflict", rev: -1 }, 409);
    return json({ rev: saved.seq, data: JSON.stringify(visible(acct, nw)) });
  }

  // Profile photos: every signed-in account sees them; each person changes their own, and the Event Lead can remove anyone's.
  if (path === "photos" && request.method === "GET") {
    let names = []; try { names = JSON.parse(url.searchParams.get("names") || "[]"); } catch { names = []; }
    if (!Array.isArray(names)) names = [];
    const out = {};
    for (const n of names.slice(0, 120)) {
      const row = await env.DB.prepare("SELECT data, updated FROM photos WHERE name = ?").bind(String(n)).first();
      out[n] = row ? { v: row.updated, d: row.data } : null;
    }
    return json(out);
  }
  if (path === "photo" && request.method === "PUT") {
    let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
    const name = String(body.name || "").slice(0, 40), data = body.data;
    if (!name || !(await mayChangePhoto(env, acct, name, data))) return json({ error: "forbidden" }, 403);
    if (data === null) {
      await env.DB.prepare("DELETE FROM photos WHERE name = ?").bind(name).run();
      return json({ ok: true, v: 0 });
    }
    if (typeof data !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > MAX_PHOTO) return json({ error: "bad request" }, 400);
    const v = Date.now();
    await env.DB.prepare("INSERT INTO photos (name, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT (name) DO UPDATE SET data = ?2, updated = ?3").bind(name, data, v).run();
    return json({ ok: true, v });
  }

  // Rosters and the chairs' names: the Event Lead keeps them (copied from List of Members).
  if ((path === "rosters" || path === "chairs") && request.method === "PUT") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    const text = await request.text();
    if (text.length > 200000) return json({ error: "too large" }, 413);
    try { JSON.parse(text); } catch { return json({ error: "bad request" }, 400); }
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(path, text).run();
    return json({ ok: true });
  }

  // Passwords: the Event Lead sets any account's password (8 characters or more; Carson 26/09/30: long ones were too hard to type).
  if (path === "accounts" && request.method === "GET") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    const { results } = await env.DB.prepare("SELECT id, changed FROM accounts").all();
    const changed = Object.fromEntries(results.map((r) => [r.id, r.changed]));
    return json({ accounts: ACCOUNTS.map((a) => ({ id: a.id, type: a.type, changed: changed[a.id] || 0 })) });
  }
  if (path === "password" && request.method === "POST") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
    const target = ACCOUNTS.find((a) => a.id === body.account), pw = normal(body.password);
    if (!target || [...pw].length < MIN_PASSWORD || pw.length > 200) return json({ error: "bad request" }, 400);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.prepare("INSERT INTO accounts (id, hash, changed) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET hash = ?2, changed = ?3").bind(target.id, salt + ":" + await pbkdf2(pw, salt), Date.now()).run();
    await env.DB.prepare("DELETE FROM sessions WHERE account = ?").bind(target.id).run();  // everyone on the old password signs in again
    await env.DB.prepare("DELETE FROM login_fail WHERE account = ?").bind(target.id).run();
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}
