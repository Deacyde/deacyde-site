/**
 * Database — SQLite via better-sqlite3
 * Tables: settings, library, recommendations
 */

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "data", "anime-finder.db");

// Ensure data dir exists
const fs = require("fs");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS library (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    source      TEXT DEFAULT 'anilist',
    media_type  TEXT DEFAULT 'anime',
    title       TEXT NOT NULL,
    title_alt   TEXT,
    cover_url   TEXT,
    banner_url  TEXT,
    synopsis    TEXT,
    score       INTEGER CHECK(score BETWEEN 1 AND 10),
    status      TEXT DEFAULT 'watched' CHECK(status IN ('watched','watching','dropped','plan')),
    priority    INTEGER CHECK(priority BETWEEN 1 AND 10),
    genres      TEXT DEFAULT '[]',
    tags        TEXT DEFAULT '[]',
    user_tags   TEXT DEFAULT '[]',
    episodes    INTEGER,
    format      TEXT,
    year        INTEGER,
    streaming   TEXT DEFAULT '[]',
    notes       TEXT,
    added_at    TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(external_id, source, media_type)
  );

  CREATE TABLE IF NOT EXISTS recommendations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    source      TEXT DEFAULT 'anilist',
    media_type  TEXT DEFAULT 'anime',
    title       TEXT NOT NULL,
    cover_url   TEXT,
    synopsis    TEXT,
    genres      TEXT DEFAULT '[]',
    streaming   TEXT DEFAULT '[]',
    reason      TEXT,
    score_pred  REAL,
    dub_platform TEXT,
    dismissed   INTEGER DEFAULT 0,
    added_to_lib INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// ── Auto-migrations — safely adds new columns without wiping data ──
function migrate() {
  function hasColumn(table, col) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some(c => c.name === col);
  }
  function addCol(table, col, def) {
    if (!hasColumn(table, col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      console.log(`✅ Migration: added ${table}.${col}`);
    }
  }

  // Library columns — add future columns here, never delete the DB
  addCol("library", "user_tags", "TEXT DEFAULT '[]'");
  addCol("library", "priority", "INTEGER");
  addCol("library", "banner_url", "TEXT");
  addCol("library", "notes", "TEXT");

  // Recommendation columns
  addCol("recommendations", "dub_platform", "TEXT");
  addCol("recommendations", "year", "INTEGER");
}
migrate();

// ── Encryption (for API keys) ──
const ENC_KEY = process.env.ANIME_ENCRYPTION_SECRET ||
  process.env.MCP_ENCRYPTION_SECRET ||
  crypto.randomBytes(32).toString("hex");

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENC_KEY, "hex"), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text) {
  const [ivHex, encrypted] = text.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENC_KEY, "hex"), iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── Settings helpers ──
function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

function getEncryptedSetting(key) {
  const val = getSetting(key);
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

function setEncryptedSetting(key, value) {
  setSetting(key, encrypt(value));
}

// ── Library helpers ──
function addToLibrary(item) {
  return db.prepare(`
    INSERT INTO library (external_id, source, media_type, title, title_alt, cover_url, banner_url, synopsis, score, status, priority, genres, tags, user_tags, episodes, format, year, streaming, notes)
    VALUES (@external_id, @source, @media_type, @title, @title_alt, @cover_url, @banner_url, @synopsis, @score, @status, @priority, @genres, @tags, @user_tags, @episodes, @format, @year, @streaming, @notes)
    ON CONFLICT(external_id, source, media_type) DO UPDATE SET
      score = excluded.score, status = excluded.status, priority = excluded.priority, user_tags = excluded.user_tags, notes = excluded.notes, updated_at = datetime('now')
  `).run(item);
}

function getLibrary(filters = {}) {
  let where = [];
  let params = {};

  if (filters.media_type) { where.push("media_type = @media_type"); params.media_type = filters.media_type; }
  if (filters.status) { where.push("status = @status"); params.status = filters.status; }
  if (filters.genre) { where.push("genres LIKE @genre"); params.genre = `%${filters.genre}%`; }
  if (filters.user_tag) { where.push("user_tags LIKE @user_tag"); params.user_tag = `%${filters.user_tag}%`; }
  if (filters.min_score) { where.push("score >= @min_score"); params.min_score = filters.min_score; }
  if (filters.max_score) { where.push("score <= @max_score"); params.max_score = filters.max_score; }
  if (filters.search) { where.push("(title LIKE @search OR title_alt LIKE @search)"); params.search = `%${filters.search}%`; }

  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const sort = filters.sort === "score" ? "score DESC" : filters.sort === "title" ? "title ASC" : filters.sort === "year" ? "year DESC" : filters.sort === "priority" ? "priority DESC NULLS LAST" : "updated_at DESC";

  return db.prepare(`SELECT * FROM library ${clause} ORDER BY ${sort}`).all(params);
}

function updateLibraryItem(id, updates) {
  const fields = [];
  const params = { id };
  for (const [k, v] of Object.entries(updates)) {
    if (["score", "status", "priority", "user_tags", "media_type", "notes", "year", "cover_url", "external_id", "source", "synopsis", "genres", "streaming", "episodes", "format", "tags", "title_alt"].includes(k)) {
      fields.push(`${k} = @${k}`);
      params[k] = k === "user_tags" ? JSON.stringify(v) : v;
    }
  }
  if (!fields.length) return;
  fields.push("updated_at = datetime('now')");
  db.prepare(`UPDATE library SET ${fields.join(", ")} WHERE id = @id`).run(params);
}

function removeFromLibrary(id) {
  db.prepare("DELETE FROM library WHERE id = ?").run(id);
}

function getLibraryStats() {
  const total = db.prepare("SELECT COUNT(*) as c FROM library").get().c;
  const byType = db.prepare("SELECT media_type, COUNT(*) as c FROM library GROUP BY media_type").all();
  const byStatus = db.prepare("SELECT status, COUNT(*) as c FROM library GROUP BY status").all();
  const avgScore = db.prepare("SELECT AVG(score) as avg FROM library WHERE score IS NOT NULL").get().avg;
  return { total, byType, byStatus, avgScore: avgScore ? Math.round(avgScore * 10) / 10 : null };
}

// ── Taste Profile ──
function getTasteProfile(opts = {}) {
  let where = ["score IS NOT NULL"];
  let params = {};
  if (opts.media_type) { where.push("media_type = @media_type"); params.media_type = opts.media_type; }
  if (opts.user_tag) { where.push("user_tags LIKE @user_tag"); params.user_tag = `%${opts.user_tag}%`; }
  const clause = where.join(" AND ");

  const items = db.prepare(`SELECT genres, tags, score, media_type, format FROM library WHERE ${clause}`).all(params);
  if (!items.length) return null;

  const genreScores = {};
  const tagScores = {};
  const formatCounts = {};
  const typeCounts = {};

  for (const item of items) {
    const genres = JSON.parse(item.genres || "[]");
    const tags = JSON.parse(item.tags || "[]");

    for (const g of genres) {
      if (!genreScores[g]) genreScores[g] = { total: 0, count: 0 };
      genreScores[g].total += item.score;
      genreScores[g].count++;
    }
    for (const t of tags) {
      if (!tagScores[t]) tagScores[t] = { total: 0, count: 0 };
      tagScores[t].total += item.score;
      tagScores[t].count++;
    }
    if (item.format) formatCounts[item.format] = (formatCounts[item.format] || 0) + 1;
    if (item.media_type) typeCounts[item.media_type] = (typeCounts[item.media_type] || 0) + 1;
  }

  const genreAvg = Object.entries(genreScores)
    .map(([g, s]) => ({ genre: g, avg: Math.round(s.total / s.count * 10) / 10, count: s.count }))
    .sort((a, b) => b.avg - a.avg);

  const tagAvg = Object.entries(tagScores)
    .filter(([, s]) => s.count >= 2)
    .map(([t, s]) => ({ tag: t, avg: Math.round(s.total / s.count * 10) / 10, count: s.count }))
    .sort((a, b) => b.avg - a.avg);

  const topRated = db.prepare(`SELECT title, score, genres, media_type, year FROM library WHERE ${clause} ORDER BY score DESC LIMIT 10`).all(params);
  const bottomRated = db.prepare(`SELECT title, score, genres, media_type, year FROM library WHERE ${clause} ORDER BY score ASC LIMIT 5`).all(params);

  return { genreAvg, tagAvg: tagAvg.slice(0, 20), formatCounts, typeCounts, topRated, bottomRated, totalRated: items.length };
}

// ── Recommendations ──
function saveRecommendations(recs) {
  const stmt = db.prepare(`
    INSERT INTO recommendations (external_id, source, media_type, title, cover_url, synopsis, genres, streaming, reason, score_pred, dub_platform, year)
    VALUES (@external_id, @source, @media_type, @title, @cover_url, @synopsis, @genres, @streaming, @reason, @score_pred, @dub_platform, @year)
  `);
  const tx = db.transaction((items) => { for (const r of items) stmt.run(r); });
  tx(recs);
}

function getRecommendations(showDismissed = false) {
  const where = showDismissed ? "WHERE dismissed = 1" : "WHERE dismissed = 0 AND added_to_lib = 0";
  return db.prepare(`SELECT * FROM recommendations ${where} ORDER BY created_at DESC`).all();
}

function dismissRecommendation(id) {
  db.prepare("UPDATE recommendations SET dismissed = 1 WHERE id = ?").run(id);
}

function undismissRecommendation(id) {
  db.prepare("UPDATE recommendations SET dismissed = 0 WHERE id = ?").run(id);
}

function clearCurrentRecs() {
  db.prepare("DELETE FROM recommendations WHERE dismissed = 0 AND added_to_lib = 0").run();
}

function markRecAdded(id) {
  db.prepare("UPDATE recommendations SET added_to_lib = 1 WHERE id = ?").run(id);
}

module.exports = {
  getSetting, setSetting, getEncryptedSetting, setEncryptedSetting,
  addToLibrary, getLibrary, updateLibraryItem, removeFromLibrary, getLibraryStats,
  getTasteProfile,
  saveRecommendations, getRecommendations, dismissRecommendation, undismissRecommendation, clearCurrentRecs, markRecAdded,
};
