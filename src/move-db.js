// One-off move from the first database (named mc-scripts, which D1 cannot rename) to the database event-centre.
// The first request after the deploy copies every table from OLD_DB into DB, then leaves a mark so it never runs again.
// Rows already in DB are kept (INSERT OR IGNORE): a save made after the copy is never overwritten by an older row.
// Remove this file, its call in worker.js and the OLD_DB binding once the old database has been deleted.
const MARK = "moved_from_mc_scripts";
let done = null;

async function copyAll(env) {
  const db = env.DB, old = env.OLD_DB;
  const has = await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(MARK).first();
  if (has) return;
  const { results: objects } = await old.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY type = 'index'"
  ).all();
  for (const o of objects) {
    await db.prepare(o.sql.replace(/^CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/i, "CREATE $1 IF NOT EXISTS ")).run();
  }
  for (const t of objects.filter((o) => o.type === "table")) {
    const table = '"' + t.name.replace(/"/g, '""') + '"';
    for (let offset = 0; ; offset += 20) {
      const { results: rows } = await old.prepare(`SELECT * FROM ${table} LIMIT 20 OFFSET ${offset}`).all();
      if (!rows.length) break;
      const cols = Object.keys(rows[0]);
      const sql = `INSERT OR IGNORE INTO ${table} (${cols.map((c) => '"' + c + '"').join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
      await db.batch(rows.map((r) => db.prepare(sql).bind(...cols.map((c) => r[c]))));
      if (rows.length < 20) break;
    }
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${MARK} (at INTEGER NOT NULL)`).run();
  await db.prepare(`INSERT INTO ${MARK} (at) VALUES (?)`).bind(Date.now()).run();
}

export function moveDatabase(env) {
  if (!env.OLD_DB) return Promise.resolve();
  if (!done) done = copyAll(env).catch((e) => { done = null; throw e; });
  return done;
}
