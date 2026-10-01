// Events: accounts, sessions, rosters and one record per event, with rights checked here.
// Rights (Decision Record Part A): the Event Lead, and Admin (CA's own teachers), edit everything; a Group Lead on duty puts names on their group's
// tasks and sets its roles, Acting Group Lead, attendance and On Leave; on-duty members and Group Leads edit their
// kind of document; the teacher reads. An event is compared with the stored one piece by piece ("units"), and every
// changed piece must be allowed. The server also records who changed what, for the yellow update dots.
import { SEED } from "./accounts-seed.js";

const GROUPS = ["MC", "Backstage", "Reception"].flatMap((m) => ["A", "B", "C", "D"].map((x) => `${m} Group ${x}`));
export const ACCOUNTS = [
  { id: "Event Lead", type: "lead" }, { id: "Editor", type: "lead", admin: true }, { id: "Viewer", type: "teacher" },
  ...GROUPS.map((g) => ({ id: g, type: "group", group: g })),
  ...GROUPS.map((g) => ({ id: g + " Lead", type: "gl", group: g }))
];
const DOC_OF = { MC: "script", Backstage: "awards", Reception: "guests" };
const kindOf = (g) => g.split(" ")[0];
const MAX_EVENT = 900000, SESSION_DAYS = 180, ROUNDS = 100000, MIN_PASSWORD = 8, RESET_MS = 60 * 60000;
const waitAfter = (n) => (n < 5 ? 0 : [30, 60, 300][n - 5] || 900) * 1000;  // wrong tries so far -> seconds before the next try
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
    db.prepare("CREATE TABLE IF NOT EXISTS photos (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, sealed TEXT NOT NULL)"),
    // Admin and Teacher were renamed Editor and Viewer (Carson, 26/10/02): their password, sign-ins and wrong tries move with them
    ...[["Teacher", "Viewer"], ["Admin", "Editor"]].flatMap(([from, to]) => [
      db.prepare("UPDATE OR IGNORE accounts SET id = ? WHERE id = ?").bind(to, from),
      db.prepare("UPDATE sessions SET account = ? WHERE account = ?").bind(to, from),
      db.prepare("UPDATE OR IGNORE login_fail SET account = ? WHERE account = ?").bind(to, from)])
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
  return row ? row.hash : SEED[id === "Viewer" ? "Teacher" : id] || null;
}
// Passwords the Event Lead and Editor can read back on the Members page, behind an eye (Carson, the CA admin, 26/10/02:
// "the eye should be there. And this is not something very secret"). Sign-in still checks the one-way hash; this copy is
// encrypted with a key derived from the Worker secret FONT_KEY, and is written when a password is set, or when someone signs
// in with it (passwords set before this exist only as hashes).
async function vaultKey(env) {
  if (!env.FONT_KEY) return null;
  const raw = Uint8Array.from(atob(String(env.FONT_KEY).trim()), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(16), info: new TextEncoder().encode("event-centre passwords") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(env, id, pw) {
  const key = await vaultKey(env); if (!key) return;
  const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) }, key, new TextEncoder().encode(pw)));
  await env.DB.prepare("INSERT INTO vault (id, sealed) VALUES (?1, ?2) ON CONFLICT (id) DO UPDATE SET sealed = ?2").bind(id, hex(iv) + hex(ct)).run();
}
async function unsealAll(env) {
  const key = await vaultKey(env); if (!key) return {};
  const { results } = await env.DB.prepare("SELECT id, sealed FROM vault").all(), out = {};
  for (const r of results) { try { const b = unhex(r.sealed); out[r.id] = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12), additionalData: new TextEncoder().encode(r.id) }, key, b.slice(12))); } catch { /* sealed under another key */ } }
  return out;
}
async function login(request, env) {
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const typed = String(body.account || "").trim().toLowerCase().replace(/\s+/g, " ");
  const OLD = { teacher: "viewer", admin: "editor" };  // the names before 26/10/02
  const acct = ACCOUNTS.find((a) => a.id.toLowerCase() === (OLD[typed] || typed));
  if (!acct) { await new Promise((r) => setTimeout(r, 400)); return json({ error: "Wrong account or password" }, 401); }
  // Wrong tries wait longer each time, as an iPhone does (Carson, 26/10/01): after 5, 30 seconds; then 1, 5 and 15 minutes.
  // "since" is the last wrong try; an hour without one starts the count again.
  const fail = await env.DB.prepare("SELECT n, since FROM login_fail WHERE account = ?").bind(acct.id).first();
  const now = Date.now(), n = fail && now - fail.since < RESET_MS ? fail.n : 0, wait = waitAfter(n), left = fail ? fail.since + wait - now : 0;
  if (wait && left > 0) { const sec = Math.ceil(left / 1000); return json({ error: "Too many tries. Try again in " + (sec < 60 ? sec + " seconds." : Math.ceil(sec / 60) + (sec > 60 ? " minutes." : " minute.")) }, 429); }
  const stored = await hashOf(env, acct.id), pw = normal(body.password);
  if (!stored || !pw || !same(await pbkdf2(pw, stored.split(":")[0]), stored.split(":")[1])) {
    await env.DB.prepare("INSERT INTO login_fail (account, n, since) VALUES (?1, ?2, ?3) ON CONFLICT (account) DO UPDATE SET n = ?2, since = ?3").bind(acct.id, n + 1, now).run();
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: "Wrong account or password" }, 401);
  }
  if (fail) await env.DB.prepare("DELETE FROM login_fail WHERE account = ?").bind(acct.id).run();
  try { await seal(env, acct.id, pw); } catch { /* signing in does not depend on it */ }
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
// A person changes only their own photo: the name they are signed in as. The Event Lead and Admin may also remove anyone's.
async function mayChangePhoto(env, acct, name, data) {
  if (acct.type === "lead") return data === null || (acct.who === name && ((await settingOf(env, acct.admin ? "admins" : "chairs")) || []).includes(name));
  if (acct.type === "teacher") return false;
  const r = ((await settingOf(env, "rosters")) || {})[acct.group] || {};
  if (acct.type === "gl") return !!r.lead && r.lead.name === name;
  return acct.who === name && (r.people || []).some((p) => p.name === name);
}

// ---------- Old events: the shape before 26/10/01, read as the new one ----------
// An event stored in the old shape (Rundown lines holding their tasks, documents in a list, roles on each group)
// is upgraded every time it is read; the stored row changes only when someone saves the event.
// The upgrade depends only on the stored event, so every read gives the same result.
const lastSentence = (text) => {
  const s = String(text || "").trim(), parts = s.split(/(?<=[。！？!?])/).map((x) => x.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : s;
  return last.length > 40 ? "…" + last.slice(-40) : last;
};
export function upgrade(ev) {
  if (!ev || typeof ev !== "object" || ev.v === 4) return ev;
  const arr = (x) => (Array.isArray(x) ? x.filter((y) => typeof y === "string") : []);
  const out = { id: ev.id, v: 4, date: ev.date || "", name: ev.name || "", asmTime: ev.asmTime || ev.start || "", venue: ev.venue || "",
    leading: arr(ev.leading), support: arr(ev.support), lead: ev.lead || "", remarks: ev.remarks || "",
    groups: [], mcs: [], rows: [], tasks: [], awards: {}, guests: null, att: {}, leave: {}, log: Array.isArray(ev.log) ? ev.log : [], upd: {} };
  const groups = Array.isArray(ev.groups) ? ev.groups : [];
  const holder = (gn, rid) => { const g = groups.find((x) => x.name === gn); const r = g && (g.roles || []).find((x) => x.id === rid); return r && r.who ? r.who : ""; };
  groups.forEach((g) => out.groups.push({ name: g.name, ...(g.covers ? { covers: g.covers } : {}), ...(g.acting ? { acting: g.acting } : {}) }));
  let k = 0;
  groups.forEach((g) => (g.roles || []).filter((r) => r.who).forEach((r) => out.tasks.push({ id: "o" + ++k, text: r.name || r.id, role: true, to: [g.name], names: [r.who] })));
  const lines = Array.isArray(ev.lines) ? ev.lines : [], docs = Array.isArray(ev.docs) ? ev.docs : [];
  lines.filter((l) => !l.before).forEach((l) => out.rows.push({ id: l.id, time: l.time || "", title: l.title || "", place: l.place || "",
    remark: [l.end ? "至 " + l.end : "", l.remarks || ""].filter(Boolean).join("；"), say: [] }));
  // The MC who speaks a paragraph: the name written on it, or whoever held its role in the MC group
  const mcGroup = (groups.find((g) => (g.roles || []).some((r) => r.id === "Host 1")) || {}).name;
  const speaker = (b) => b.name || (mcGroup ? holder(mcGroup, b.sp) : "");
  const paraOf = (bid) => { for (const d of docs) if (d.type === "script" && Array.isArray(d.blocks)) { const b = d.blocks.find((x) => x.id === bid); if (b) return b; } return null; };
  // A task tied to a script paragraph: its moment in words. After an MC line, the line's last sentence; after a stage direction, the direction.
  const momentOf = (bid) => { const b = paraOf(bid); if (!b || !String(b.text || "").trim()) return "";
    const said = lastSentence(b.text); return b.type === "line" ? "司儀說「" + said + "」後" : /^【.*】$/.test(said) ? said + "後" : "「" + said + "」後"; };
  lines.forEach((l) => (l.tasks || []).forEach((t) => {
    const to = [], names = [];
    String(t.to || "").split(",").filter(Boolean).forEach((x) => {
      if (x === "all") { to.push("All"); return; }
      const [kind, gn, r] = x.split(":"); if (!gn) return;
      to.push(gn);
      if (kind === "p" && r) names.push(r);
      if (kind === "r") (r === "Hosts" ? ["Host 1", "Host 2"] : [r]).map((id) => holder(gn, id)).filter(Boolean).forEach((n) => names.push(n));
    });
    const all = to.includes("All");
    out.tasks.push({ id: t.id, text: t.text || "", ...(l.before ? { date: "" } : { row: l.id }), to: all ? ["All"] : [...new Set(to)],
      names: all ? [] : [...new Set(names)], remark: t.at ? momentOf(t.at) : "" });
  }));
  // Documents: one Script (each old script joins its Rundown line, or a line of its own), one Participant List (people who go on stage: awardees, office holders), one Guest List
  const mcs = [];
  docs.filter((d) => d.type === "script").forEach((d) => {
    let row = out.rows.find((r) => r.id === d.line);
    if (!row && d.q) { row = { id: "q" + d.id, time: "", title: d.q, place: "", remark: "", say: [] }; out.rows.push(row); }
    if (!row) row = out.rows[0];
    if (!row) { row = { id: "s" + d.id, time: out.asmTime, title: "", place: out.venue, remark: "", say: [] }; out.rows.push(row); }
    (d.blocks || []).forEach((b) => {
      if (b.type === "line") { const n = speaker(b); if (n && !mcs.includes(n)) mcs.push(n); row.say.push({ id: b.id, type: "line", sp: n, text: b.text || "" }); }
      else if (b.type === "award") row.say.push({ id: b.id, type: "award", list: "aw", award: b.award });
      else row.say.push({ id: b.id, type: "cue", text: b.text || "" });
    });
  });
  out.mcs = mcs.map((n) => ["", n]);
  const aw = docs.filter((d) => d.type === "awardees").flatMap((d) => (d.awards || []).map((a) => ({ id: a.id, award: [d.q, a.award].filter(Boolean).join(" "),
    rows: (a.rows || []).map((r) => [String(r.cls || "").toUpperCase(), r.name || ""]) })));
  if (docs.some((d) => d.type === "awardees")) out.awards = { aw: { name: "Participant List", awards: aw } };
  if (docs.some((d) => d.type === "guests")) out.guests = docs.filter((d) => d.type === "guests").flatMap((d) => (d.guests || []).map((g) => ({ id: g.id, name: g.name || "", role: g.role || "" })));
  // Attendance: a tick keeps the time it was made; Off before the day becomes On Leave
  Object.entries(ev.attendance || {}).forEach(([g, m]) => Object.entries(m || {}).forEach(([n, s]) => {
    if (s === "Attended") (out.att[g] = out.att[g] || {})[n] = ((ev.attTime || {})[g] || {})[n] || out.asmTime || "✓";
    if (s === "Off") (out.leave[g] = out.leave[g] || {})[n] = true;
  }));
  Object.entries(ev.leave || {}).forEach(([g, m]) => Object.entries(m || {}).forEach(([n, v]) => { if (v) (out.leave[g] = out.leave[g] || {})[n] = true; }));
  return out;
}

// ---------- Units: the pieces of an event that rights are checked on ----------
// Event Lead: everything. A Group Lead on duty (or the Acting Group Lead on the day): names on their group's tasks,
// roles in their group, Acting Group Lead, attendance and On Leave. On-duty members and Group Lead: their kind of
// document (MC the Script, Backstage the Participant List, Reception the Guest List). The teacher reads.
const FIELDS = ["date", "name", "asmTime", "venue", "leading", "support", "lead", "remarks"];
const KNOWN = new Set([...FIELDS, "id", "v", "groups", "mcs", "rows", "tasks", "awards", "guests", "att", "leave", "log", "upd", "roll"]);
function units(ev) {
  const u = new Map(), put = (k, v) => u.set(k, JSON.stringify(v === undefined ? null : v));
  if (!ev) return u;
  FIELDS.forEach((f) => put("f:" + f, ev[f]));
  Object.keys(ev).filter((k) => !KNOWN.has(k)).forEach((k) => put("x:" + k, ev[k]));
  put("groups", (ev.groups || []).map((g) => g.name).sort());
  (ev.groups || []).forEach((g) => { put(`g:${g.name}`, { covers: g.covers || null, since: g.since || null, x: Object.keys(g).filter((k) => !["name", "covers", "since", "acting"].includes(k)).sort() }); put(`g:${g.name}:acting`, g.acting || null); });
  put("rows", (ev.rows || []).map((r) => r.id));
  (ev.rows || []).forEach((r) => {
    put("r:" + r.id, { time: r.time, title: r.title, place: r.place, remark: r.remark || "" });
    put("so:" + r.id, (r.say || []).map((s) => s.id));
    (r.say || []).forEach((s) => put("s:" + s.id, { ...s, row: r.id }));
  });
  put("mcs", ev.mcs || []);
  (ev.tasks || []).forEach((t) => { const { names, ...rest } = t; put("t:" + t.id, rest); put("tn:" + t.id, names || []); });
  Object.entries(ev.awards || {}).forEach(([id, l]) => put("aw:" + id, l));
  put("gu", ev.guests === undefined ? null : ev.guests);
  // Roll call (Carson, 26/10/02): who of the Participant List and the Guest List is here; the Script reads only those ticked
  put("ra", (ev.roll || {}).aw || {}); put("rg", (ev.roll || {}).gu || {});
  GROUPS.forEach((g) => { const a = (ev.att || {})[g], v = (ev.leave || {})[g]; if (a && Object.keys(a).length) put("a:" + g, a); if (v && Object.keys(v).length) put("v:" + g, v); });
  return u;
}
const onDuty = (ev, g) => !!ev && (ev.groups || []).some((x) => x.name === g);
// An Acting Group Lead has the Group Lead's rights only on the day of the event (the Group Lead does the work before it).
const todayHK = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(2, 10).replace(/-/g, "/");
function leadsGroup(acct, ev) {
  if (!acct.group || !onDuty(ev, acct.group)) return null;
  if (acct.type === "gl") return acct.group;
  const g = ev.groups.find((x) => x.name === acct.group);
  return acct.type === "group" && acct.who && g && g.acting === acct.who && ev.date === todayHK() ? acct.group : null;
}
const taskOf = (ev, id) => ((ev && ev.tasks) || []).find((t) => t.id === id) || null;
const DOC_KEY = { script: ["s:", "so:", "mcs"], awards: ["aw:", "ra"], guests: ["gu", "rg"] };
const docOfKey = (key) => Object.keys(DOC_KEY).find((d) => DOC_KEY[d].some((p) => (p.endsWith(":") ? key.startsWith(p) : key === p)));
function allowed(acct, old, key) {
  if (acct.type === "lead") return true;
  if (acct.type === "teacher" || !old) return false;
  const g = leadsGroup(acct, old), mine = acct.group && onDuty(old, acct.group) ? DOC_OF[kindOf(acct.group)] : null;
  const d = docOfKey(key);
  if (d) return mine === d;
  // The first Rundown line, made with a new Script when the Rundown is still empty
  if ((key === "rows" || key.startsWith("r:")) && mine === "script" && !(old.rows || []).length) return true;
  if (!g) return false;
  if (key === `g:${g}:acting` || key === "a:" + g || key === "v:" + g) return true;
  // Names on a task given to their group; a role (a task with role) in their group
  if (key.startsWith("tn:")) return (nw) => [taskOf(old, key.slice(3)), taskOf(nw, key.slice(3))].every((t) => !t || (t.to || []).includes(g));
  if (key.startsWith("t:")) return (nw) => [taskOf(old, key.slice(2)), taskOf(nw, key.slice(2))].every((t) => !t || (t.role === true && JSON.stringify(t.to) === JSON.stringify([g])));
  return false;
}
// What an account may read: attendance and On Leave only for the Event Lead and the group's own Group Lead.
function visible(acct, ev) {
  if (!ev || acct.type === "lead") return ev;
  const g = leadsGroup(acct, ev), out = { ...ev, att: {}, leave: {} };
  if (g) { out.att[g] = (ev.att || {})[g] || {}; out.leave[g] = (ev.leave || {})[g] || {}; }
  return out;
}
// A write keeps what the writer could not see.
function withHidden(acct, old, nw) {
  if (acct.type === "lead" || !old) return nw;
  const g = leadsGroup(acct, old), a = { ...(old.att || {}) }, v = { ...(old.leave || {}) };
  if (g) { a[g] = (nw.att || {})[g] || {}; v[g] = (nw.leave || {})[g] || {}; }
  return { ...nw, att: a, leave: v };
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
// What changed, and who changed it: the yellow dots. Keys: event id; id:f:field; id:t:task; id:d:document;
// id:s:paragraph; id:mcs; id:r:line; id:a:award; id:g:guest. Role tasks, attendance and On Leave make no dot.
function stamp(old, nw, by) {
  const upd = { ...((old && old.upd) || {}) }, at = Date.now(), id = nw.id, J = (x) => JSON.stringify(x === undefined ? null : x);
  let any = false;
  const bump = (k) => { upd[`${id}:${k}`] = { by, at }; any = true; };
  const o = old || {};
  FIELDS.forEach((f) => { if (J(o[f]) !== J(nw[f])) bump("f:" + (f === "support" ? "leading" : f)); });
  const byId = (list) => new Map((list || []).map((x) => [x.id, J(x)]));
  const diff = (oldList, newList, k) => { const m = byId(oldList); let c = false; (newList || []).forEach((x) => { if (m.get(x.id) !== J(x)) { bump(k + ":" + x.id); c = true; } }); const ids = (l) => J((l || []).map((x) => x.id)); return c || ids(oldList) !== ids(newList); };
  if (diff((o.tasks || []).filter((t) => !t.role), (nw.tasks || []).filter((t) => !t.role), "t")) any = true;
  const says = (e) => (e.rows || []).flatMap((r) => r.say || []);
  const mcs = J(o.mcs || []) !== J(nw.mcs || []);
  if (mcs) bump("mcs");
  if (diff(says(o), says(nw), "s") || mcs) bump("d:script");
  const bare = (e) => (e.rows || []).map((r) => ({ ...r, say: 0 }));
  if (diff(bare(o), bare(nw), "r")) bump("d:rundown");
  const lists = new Set([...Object.keys(o.awards || {}), ...Object.keys(nw.awards || {})]);
  lists.forEach((l) => { const x = (o.awards || {})[l], y = (nw.awards || {})[l]; if (y && (diff(x ? x.awards : [], y.awards, "a") || J(x) !== J(y))) bump("d:aw:" + l); });
  if (nw.guests && (diff(o.guests || [], nw.guests, "g") || J(o.guests) !== J(nw.guests))) bump("d:guests");
  if (J((o.groups || []).map((g) => g.name)) !== J((nw.groups || []).map((g) => g.name))) any = true;
  if (any) upd[id] = { by, at };
  // Keep the newest 400
  const keys = Object.keys(upd);
  if (keys.length > 400) keys.sort((x, y) => upd[y].at - upd[x].at).slice(400).forEach((k) => delete upd[k]);
  return upd;
}
// History keeps every entry, but only the latest entries keep a copy to restore from, so an event stays small.
function trimLog(ev) {
  if (!Array.isArray(ev.log)) ev.log = [];
  ev.log = ev.log.slice(0, 300).map((e, i) => (i < 12 ? e : { ...e, snap: undefined }));
  return ev;
}

// The person a change is credited to (the yellow dots are not shown to them)
async function whoOf(env, acct) {
  if (acct.type === "gl") { const r = ((await settingOf(env, "rosters")) || {})[acct.group]; return (r && r.lead && r.lead.name) || acct.id; }
  return acct.who || acct.id;
}
// ---------- CA Support applications: the Google Sheet of the form, read as CSV ----------
// The Event Lead pastes the sheet's link once (Account). Every 5 minutes at most, the first page that loads makes the
// Worker read the sheet, and each application not seen before becomes an event with its basic information: date, name,
// Assembly (CA's default), Leading and Supporting Teachers, a Rundown line at the start and end times, and the
// teacher's Remark with the links they attached under it. An application whose date and name match an event already there (made by hand) is only marked seen.
const APPS_EVERY = 5 * 60000;
function csv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
// "07/10/2026" or "7/10/2026" (day first, as the form writes it) -> "26/10/07"
const ymd = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s).trim()); return m ? `${m[3].slice(2)}/${m[2].padStart(2, "0")}/${m[1].padStart(2, "0")}` : ""; };
// "07:50:00", "7:50" or "4:00:00 PM" -> "07:50"
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(String(s).trim()); if (!m) return "";
  let h = +m[1]; if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0); return `${String(h).padStart(2, "0")}:${m[2]}`; };
const minus30 = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number), x = (h * 60 + m - 30 + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
const people = (s) => String(s || "").split(/[,，、\/]|\s{2,}/).map((x) => x.trim()).filter(Boolean);
const hkNow = () => { const d = new Date(Date.now() + 8 * 3600e3).toISOString(); return d.slice(2, 10).replace(/-/g, "/") + " " + d.slice(11, 16); };
async function saveSetting(env, k, v) {
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, JSON.stringify(v)).run();
}
export async function importApplications(env, force) {
  const cfg = await settingOf(env, "applications");
  if (!cfg || !cfg.id || (!force && Date.now() - (cfg.at || 0) < APPS_EVERY)) return null;
  cfg.at = Date.now(); await saveSetting(env, "applications", cfg);  // claimed first, so two pages loading together read it once
  let rows;
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${cfg.id}/export?format=csv${cfg.gid ? "&gid=" + cfg.gid : ""}`);
    const text = r.ok ? await r.text() : "";
    if (!text || /^\s*</.test(text)) throw new Error("unreadable");
    rows = csv(text);
  } catch { cfg.error = true; await saveSetting(env, "applications", cfg); return { error: "unreadable" }; }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase()), col = (w) => head.findIndex((h) => h.startsWith(w));
  const C = { ts: col("timestamp"), name: col("event"), date: col("date"), start: col("start"), end: col("end"), lead: col("leading"), sup: col("supporting"), roles: col("roles"), files: col("materials"), rmk: col("remark") };
  if (C.ts < 0 || C.name < 0 || C.date < 0) { cfg.error = true; await saveSetting(env, "applications", cfg); return { error: "unreadable" }; }
  const seen = cfg.seen || {}, claimed = new Set(Object.values(seen));
  const { results } = await env.DB.prepare("SELECT id, data FROM events").all();
  const events = results.map((r) => { try { const e = JSON.parse(r.data); return { id: r.id, date: e.date || "", name: String(e.name || "").trim() }; } catch { return { id: r.id, date: "", name: "" }; } });
  const apps = rows.map((row) => { const v = (k) => (C[k] < 0 ? "" : String(row[C[k]] || "").trim()); return { ts: v("ts"), date: ymd(v("date")), name: v("name"), v }; })
    .filter((a) => a.ts && a.date && a.name && seen[a.ts] === undefined);
  // Same date and same name first, then same date and the same first two characters (陸運會（頒獎台 黃色帳篷） is 陸運會（頒獎台）)
  for (const same of [(e, a) => e.name === a.name, (e, a) => e.name.slice(0, 2) === a.name.slice(0, 2)])
    apps.forEach((a) => { if (seen[a.ts] !== undefined) return; const e = events.find((x) => !claimed.has(x.id) && x.date === a.date && same(x, a)); if (e) { seen[a.ts] = e.id; claimed.add(e.id); } });
  let added = 0;
  for (const { ts, date, name, v } of apps) {
    if (seen[ts] !== undefined) continue;
    const start = hm(v("start")), end = hm(v("end"));
    const id = "e" + date.replace(/\//g, "") + (await sha(ts)).slice(0, 4);
    const ev = { id, v: 4, date, name, asmTime: /早會/.test(name) ? "07:45" : minus30(start), venue: "", leading: people(v("lead")), support: people(v("sup")), lead: "",
      remarks: [v("rmk"), ...(v("files").match(/https?:\/\/[^\s,，]+/g) || []), v("roles") ? "所需人力：" + v("roles") : ""].filter(Boolean).join("\n"), groups: [], mcs: [],
      rows: [start ? { id: "r1", time: start, title: "開始", place: "", remark: "", say: [] } : null, end ? { id: "r2", time: end, title: "完結", place: "", remark: "", say: [] } : null].filter(Boolean),
      tasks: [], awards: {}, guests: null, att: {}, leave: {}, log: [{ at: hkNow(), ts: Date.now(), who: "CA Support Form", what: "Added from a CA Support application" }], upd: {} };
    ev.upd = stamp(null, ev, "CA Support Form");
    const saved = await env.DB.prepare("INSERT INTO events (id, data, deleted, updated, seq) VALUES (?1, ?2, 0, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events)) ON CONFLICT (id) DO NOTHING RETURNING seq").bind(id, JSON.stringify(ev), Date.now()).first();
    seen[ts] = id; claimed.add(id); events.push({ id, date, name });
    if (saved) added++;
  }
  cfg.seen = seen; cfg.error = false; await saveSetting(env, "applications", cfg);
  return { added };
}

// Pages from before 26/10/01 read events in the old shape; they get nothing new until they are reloaded.
const PAGE = "4";

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
    if (request.headers.get("x-page") !== PAGE) return json({ error: "reload" }, 503);
    const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
    try { await importApplications(env, false); } catch (e) { /* the events already there still load */ }
    const { results } = await env.DB.prepare("SELECT id, data, deleted, seq FROM events WHERE seq > ? ORDER BY seq").bind(since).all();
    const rows = results.map((r) => ({ id: r.id, rev: r.seq, deleted: !!r.deleted, data: r.deleted ? null : JSON.stringify(visible(acct, upgrade(JSON.parse(r.data)))) }));
    const out = { account: { id: acct.id, type: acct.type, group: acct.group || null }, rows, photos: await photoVersions(env) };
    if (!since || url.searchParams.get("full")) {
      const s = await env.DB.prepare("SELECT k, v FROM settings WHERE k IN ('rosters', 'chairs', 'admins')").all();
      const map = Object.fromEntries(s.results.map((r) => [r.k, JSON.parse(r.v)]));
      out.rosters = map.rosters || {}; out.chairs = map.chairs || []; out.admins = map.admins || [];
      if (acct.type === "lead") { const a = await settingOf(env, "applications"); out.apps = a ? { url: a.url || "", error: !!a.error } : { url: "", error: false }; }
    }
    return json(out);
  }

  // Recently Deleted (Carson, 26/10/02: a deleted event must come back): a deleted event keeps its data; the Event Lead and
  // Editor see those deleted in the last 30 days and restore one by saving it again (a save turns "deleted" off).
  if (path === "deleted" && request.method === "GET") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    const { results } = await env.DB.prepare("SELECT id, data, seq, updated FROM events WHERE deleted = 1 AND updated > ? ORDER BY updated DESC").bind(Date.now() - 30 * 864e5).all();
    return json(results.map((r) => { let d = {}; try { d = upgrade(JSON.parse(r.data)); } catch { /* unreadable */ } return { id: r.id, rev: r.seq, at: r.updated, name: d.name || "", date: d.date || "", data: JSON.stringify(d) }; }).filter((x) => x.name || x.date));
  }

  // Save one event. "rev" is the version the writer started from (0 for a new event); if someone else saved
  // in between, the answer is 409 with the current version, which the page merges and sends again.
  const m = /^events\/([A-Za-z0-9_-]{1,40})$/.exec(path);
  if (m && request.method === "PUT") {
    let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
    const id = m[1], rev = Number(body.rev) || 0;
    const row = await env.DB.prepare("SELECT data, deleted, seq FROM events WHERE id = ?").bind(id).first();
    if ((row ? row.seq : 0) !== rev) return json({ error: "conflict", rev: row ? row.seq : 0, deleted: row ? !!row.deleted : false, data: row && !row.deleted ? JSON.stringify(visible(acct, upgrade(JSON.parse(row.data)))) : null }, 409);
    const old = row && !row.deleted ? upgrade(JSON.parse(row.data)) : null;
    const next = "(SELECT COALESCE(MAX(seq), 0) + 1 FROM events)";
    if (body.deleted) {
      if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
      const saved = await env.DB.prepare("INSERT INTO events (id, data, deleted, updated, seq) VALUES (?1, ?2, 1, ?3, " + next + ") ON CONFLICT (id) DO UPDATE SET deleted = 1, updated = ?3, seq = " + next + " RETURNING seq").bind(id, row ? row.data : "{}", Date.now()).first();
      return json({ rev: saved.seq });
    }
    if (typeof body.data !== "string" || body.data.length > MAX_EVENT) return json({ error: "bad request" }, 400);
    let nw; try { nw = JSON.parse(body.data); } catch { return json({ error: "bad request" }, 400); }
    if (!nw || typeof nw !== "object" || nw.id !== id) return json({ error: "bad request" }, 400);
    if (nw.v !== 4) return json({ error: "reload" }, 403);  // a page from before 26/10/01
    nw = trimLog(withHidden(acct, old, nw));
    // One document of each kind per event
    if (Object.keys(nw.awards || {}).length > Math.max(1, Object.keys((old && old.awards) || {}).length)) return json({ error: "one list" }, 400);
    const denied = checkWrite(acct, old, nw);
    if (denied) return json({ error: "forbidden", unit: denied }, 403);
    nw.upd = stamp(old, nw, await whoOf(env, acct));
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

  // Rosters, the chairs' names and Admin's teachers: the Event Lead (or Admin) keeps them (copied from List of Members).
  if ((path === "rosters" || path === "chairs" || path === "admins") && request.method === "PUT") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    const text = await request.text();
    if (text.length > 200000) return json({ error: "too large" }, 413);
    try { JSON.parse(text); } catch { return json({ error: "bad request" }, 400); }
    await env.DB.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(path, text).run();
    return json({ ok: true });
  }

  // The CA Support form's sheet: the Event Lead pastes its link; it is read at once, then every 5 minutes at most.
  if (path === "applications" && request.method === "PUT") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
    const link = String(body.url || "").trim().slice(0, 500);
    if (!link) { await env.DB.prepare("DELETE FROM settings WHERE k = 'applications'").run(); return json({ ok: true }); }
    const m = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(link), g = /[#&?]gid=(\d+)/.exec(link);
    if (!m) return json({ error: "unreadable" }, 400);
    const old = (await settingOf(env, "applications")) || {};
    await saveSetting(env, "applications", { url: link, id: m[1], gid: g ? g[1] : "", seen: old.id === m[1] ? old.seen || {} : {}, at: 0 });
    const r = await importApplications(env, true);
    return json(r && r.error ? r : { ok: true, added: (r && r.added) || 0 }, r && r.error ? 400 : 200);
  }

  // Passwords: the Event Lead sets any account's password (8 characters or more; Carson 26/09/30: long ones were too hard to type).
  if (path === "accounts" && request.method === "GET") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    const { results } = await env.DB.prepare("SELECT id, changed FROM accounts").all();
    const changed = Object.fromEntries(results.map((r) => [r.id, r.changed]));
    return json({ accounts: ACCOUNTS.map((a) => ({ id: a.id, type: a.type, changed: changed[a.id] || 0 })) });
  }
  if (path === "passwords" && request.method === "GET") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    return json(await unsealAll(env));
  }
  if (path === "password" && request.method === "POST") {
    if (acct.type !== "lead") return json({ error: "forbidden" }, 403);
    let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
    const target = ACCOUNTS.find((a) => a.id === body.account), pw = normal(body.password);
    if (!target || [...pw].length < MIN_PASSWORD || pw.length > 200) return json({ error: "bad request" }, 400);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.prepare("INSERT INTO accounts (id, hash, changed) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET hash = ?2, changed = ?3").bind(target.id, salt + ":" + await pbkdf2(pw, salt), Date.now()).run();
    try { await seal(env, target.id, pw); } catch { /* the hash above is what signs in */ }
    await env.DB.prepare("DELETE FROM sessions WHERE account = ?").bind(target.id).run();  // everyone on the old password signs in again
    await env.DB.prepare("DELETE FROM login_fail WHERE account = ?").bind(target.id).run();
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}
