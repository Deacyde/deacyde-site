/**
 * Database layer — SQLite via better-sqlite3
 * Stores admin password, API keys (encrypted), client configs, chat history.
 */

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "..", "data", "mcp.db");

// Encryption key derived from a secret stored in env or generated on first run
function getEncryptionKey() {
  const secret = process.env.MCP_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("MCP_ENCRYPTION_SECRET env var is required");
  }
  return crypto.scryptSync(secret, "ga4-gsc-mcp-salt", 32);
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(data) {
  const key = getEncryptionKey();
  const [ivHex, encrypted] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function initDb() {
  const fs = require("fs");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      ga4_property_id TEXT,
      gsc_site_url TEXT,
      service_account_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
    );
  `);

  return db;
}

let _db = null;
function getDb() {
  if (!_db) _db = initDb();
  return _db;
}

// Settings
function getSetting(key) {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run(key, value);
}

// Encrypted settings (API keys)
function getEncryptedSetting(key) {
  const val = getSetting(key);
  if (!val) return null;
  try {
    return decrypt(val);
  } catch {
    return null;
  }
}

function setEncryptedSetting(key, value) {
  setSetting(key, encrypt(value));
}

// Clients
function getClients() {
  return getDb().prepare("SELECT id, name, ga4_property_id, gsc_site_url, created_at FROM clients ORDER BY name").all();
}

function getClient(id) {
  const row = getDb().prepare("SELECT * FROM clients WHERE id = ?").get(id);
  if (row && row.service_account_json) {
    try {
      row.service_account_json = decrypt(row.service_account_json);
    } catch {
      row.service_account_json = null;
    }
  }
  return row;
}

function createClient({ name, ga4_property_id, gsc_site_url, service_account_json }) {
  const encrypted_sa = service_account_json ? encrypt(service_account_json) : null;
  const result = getDb()
    .prepare(
      "INSERT INTO clients (name, ga4_property_id, gsc_site_url, service_account_json) VALUES (?, ?, ?, ?)"
    )
    .run(name, ga4_property_id || null, gsc_site_url || null, encrypted_sa);
  return result.lastInsertRowid;
}

function updateClient(id, { name, ga4_property_id, gsc_site_url, service_account_json }) {
  const fields = ["name = ?", "ga4_property_id = ?", "gsc_site_url = ?", "updated_at = datetime('now')"];
  const params = [name, ga4_property_id || null, gsc_site_url || null];

  if (service_account_json !== undefined) {
    fields.push("service_account_json = ?");
    params.push(service_account_json ? encrypt(service_account_json) : null);
  }

  params.push(id);
  getDb().prepare(`UPDATE clients SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

function deleteClient(id) {
  getDb().prepare("DELETE FROM clients WHERE id = ?").run(id);
}

// Chat history
function saveChatMessage(clientId, role, content, metadata = null) {
  getDb()
    .prepare("INSERT INTO chat_history (client_id, role, content, metadata) VALUES (?, ?, ?, ?)")
    .run(clientId, role, content, metadata ? JSON.stringify(metadata) : null);
}

function getChatHistory(clientId, limit = 50) {
  return getDb()
    .prepare("SELECT * FROM chat_history WHERE client_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(clientId, limit)
    .reverse();
}

function clearChatHistory(clientId) {
  getDb().prepare("DELETE FROM chat_history WHERE client_id = ?").run(clientId);
}

module.exports = {
  getDb,
  getSetting,
  setSetting,
  getEncryptedSetting,
  setEncryptedSetting,
  getClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  saveChatMessage,
  getChatHistory,
  clearChatHistory,
  encrypt,
  decrypt,
};
