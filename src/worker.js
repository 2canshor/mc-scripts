// Event Centre: serves the event tool at "/" and the script editor at "/scripts", and keeps both in one D1 database.
// The event tool signs in with an account (see events-api.js). The script editor sends the CA passcode with each request. The passcode is the Worker secret PASSCODE,
// which the chairs change in the Cloudflare dashboard (Settings > Variables and Secrets).
// Until that secret exists, the passcode whose SHA-256 is below still works.
// Word files carry their fonts (see embedFonts in build/gen.js). Noto Serif TC (SIL OFL) is a public
// file under /fonts/. Anthropic Serif may not be published, so it is stored here encrypted and sent
// only with the passcode; the key is the Worker secret FONT_KEY. Without that secret, Word files
// carry Noto Serif TC only.
import PAGE from "./index.html";
import EVENTS_PAGE from "./events.html";
import { handleEvents, sessionOf, ensureEventTables } from "./events-api.js";
import { moveDatabase } from "./move-db.js";
import TEXT_MEDIUM from "./fonts/AnthropicSerif-Text-Medium.bin";
import TEXT_MEDIUM_ITALIC from "./fonts/AnthropicSerif-Text-MediumItalic.bin";
import DISPLAY_MEDIUM from "./fonts/AnthropicSerif-Display-Medium.bin";
import DISPLAY_MEDIUM_ITALIC from "./fonts/AnthropicSerif-Display-MediumItalic.bin";
const PRIVATE_FONTS = {
  "AnthropicSerif-Text-Medium": TEXT_MEDIUM, "AnthropicSerif-Text-MediumItalic": TEXT_MEDIUM_ITALIC,
  "AnthropicSerif-Display-Medium": DISPLAY_MEDIUM, "AnthropicSerif-Display-MediumItalic": DISPLAY_MEDIUM_ITALIC
};
async function privateFont(name, env) {
  const sealed = PRIVATE_FONTS[name];
  if (!sealed || !env.FONT_KEY) return null;
  const raw = Uint8Array.from(atob(String(env.FONT_KEY).trim()), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const data = new Uint8Array(sealed);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, key, data.slice(12));
}

const PASSCODE_SHA256 = "ce2325ecb6f8053ce8b4a754665425454d7a6cbd0460f64c8daa1155c2116845";
const MAX_SCRIPT = 500000;

let tablesReady = null;
function ensureTables(db) {
  if (!tablesReady) tablesReady = db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS scripts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS scripts_seq ON scripts (seq)")
  ]).catch((e) => { tablesReady = null; throw e; });
  return tablesReady;
}
async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const html = { "/": EVENTS_PAGE, "/scripts": PAGE }[url.pathname];
      if (!html) return Response.redirect(url.origin + "/", 302);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", "x-robots-tag": "noindex" } });
    }
    await moveDatabase(env);
    const path = url.pathname.slice("/api/".length);
    if (/^(login|logout|state|events\/[A-Za-z0-9_-]+|rosters|chairs|accounts|password)$/.test(path)) return handleEvents(request, env, url, path);
    // The script editor: the CA passcode, or a signed-in account of the event tool (not the teacher's, which only reads)
    const expected = env.PASSCODE ? await sha256(String(env.PASSCODE).replace(/\s+/g, "").toLowerCase()) : PASSCODE_SHA256;
    let given = request.headers.get("x-passcode") || "";
    try { given = decodeURIComponent(given); } catch { given = ""; }
    if (await sha256(given.replace(/\s+/g, "").toLowerCase()) !== expected) {
      let acct = null;
      if (request.headers.get("authorization")) { await ensureEventTables(env.DB); acct = await sessionOf(request, env); }
      if (!acct || acct.type === "teacher") return json({ error: "passcode" }, 403);
    }

    const font = /^fonts\/([A-Za-z-]{1,60})$/.exec(path);
    if (font && request.method === "GET") {
      let bytes = null;
      try { bytes = await privateFont(font[1], env); } catch { bytes = null; }
      if (!bytes) return json({ error: "not found" }, 404);
      return new Response(bytes, { headers: { "content-type": "font/ttf", "cache-control": "private, max-age=604800" } });
    }

    await ensureTables(env.DB);

    if (path === "join" && request.method === "POST") return json({ ok: true });

    // Everything changed after version "since", oldest first.
    if (path === "scripts" && request.method === "GET") {
      const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
      const { results } = await env.DB.prepare("SELECT id, data, updated, deleted, seq FROM scripts WHERE seq > ? ORDER BY seq").bind(since).all();
      return json({ rows: results.map((r) => ({ id: r.id, data: r.data, updated: r.updated, deleted: !!r.deleted, rev: r.seq })) });
    }

    // Save one script. "rev" is the version the writer started from (0 for a new script);
    // if someone else saved in between, nothing is written and the answer is 409.
    const match = /^scripts\/([A-Za-z0-9_-]{1,40})$/.exec(path);
    if (match && request.method === "PUT") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
      if (typeof body.data !== "string" || body.data.length > MAX_SCRIPT || !Number.isFinite(body.updated)) return json({ error: "bad request" }, 400);
      const id = match[1], deleted = body.deleted ? 1 : 0, rev = Number(body.rev) || 0;
      const next = "(SELECT COALESCE(MAX(seq), 0) + 1 FROM scripts)";
      const saved = rev
        ? await env.DB.prepare("UPDATE scripts SET data = ?1, updated = ?2, deleted = ?3, seq = " + next + " WHERE id = ?4 AND seq = ?5 RETURNING seq").bind(body.data, body.updated, deleted, id, rev).first()
        : await env.DB.prepare("INSERT INTO scripts (id, data, updated, deleted, seq) VALUES (?1, ?2, ?3, ?4, " + next + ") ON CONFLICT (id) DO NOTHING RETURNING seq").bind(id, body.data, body.updated, deleted).first();
      if (saved) return json({ rev: saved.seq });
      if (!rev) return json({ error: "conflict" }, 409);
      const exists = await env.DB.prepare("SELECT 1 FROM scripts WHERE id = ?").bind(id).first();
      return json({ error: exists ? "conflict" : "missing" }, exists ? 409 : 404);
    }
    return json({ error: "not found" }, 404);
  }
};
