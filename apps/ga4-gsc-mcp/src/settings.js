/**
 * Settings + Client management API routes
 */

const express = require("express");
const db = require("./db");

const router = express.Router();

// ── LLM API Keys ──────────────────────────────────────────

// GET /api/settings/llm
router.get("/api/settings/llm", (req, res) => {
  const openaiKey = db.getEncryptedSetting("openai_api_key");
  const anthropicKey = db.getEncryptedSetting("anthropic_api_key");
  const activeProvider = db.getSetting("active_llm_provider") || "openai";

  res.json({
    openai_configured: !!openaiKey,
    anthropic_configured: !!anthropicKey,
    active_provider: activeProvider,
  });
});

// POST /api/settings/llm
router.post("/api/settings/llm", (req, res) => {
  const { openai_api_key, anthropic_api_key, active_provider } = req.body;

  if (openai_api_key !== undefined) {
    if (openai_api_key) {
      db.setEncryptedSetting("openai_api_key", openai_api_key);
    } else {
      db.setSetting("openai_api_key", "");
    }
  }
  if (anthropic_api_key !== undefined) {
    if (anthropic_api_key) {
      db.setEncryptedSetting("anthropic_api_key", anthropic_api_key);
    } else {
      db.setSetting("anthropic_api_key", "");
    }
  }
  if (active_provider) {
    db.setSetting("active_llm_provider", active_provider);
  }

  res.json({ ok: true });
});

// ── Clients ───────────────────────────────────────────────

// GET /api/clients
router.get("/api/clients", (req, res) => {
  res.json(db.getClients());
});

// POST /api/clients
router.post("/api/clients", (req, res) => {
  try {
    const { name, ga4_property_id, gsc_site_url, service_account_json } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const id = db.createClient({ name, ga4_property_id, gsc_site_url, service_account_json });
    res.json({ id, ok: true });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(400).json({ error: "Client name already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id
router.put("/api/clients/:id", (req, res) => {
  try {
    const { name, ga4_property_id, gsc_site_url, service_account_json } = req.body;
    db.updateClient(req.params.id, { name, ga4_property_id, gsc_site_url, service_account_json });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id
router.delete("/api/clients/:id", (req, res) => {
  db.deleteClient(req.params.id);
  res.json({ ok: true });
});

// GET /api/clients/:id/test — test Google API credentials
router.get("/api/clients/:id/test", async (req, res) => {
  const client = db.getClient(req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (!client.service_account_json) {
    return res.status(400).json({ error: "No service account configured" });
  }

  const results = { ga4: null, gsc: null };

  // Test GA4
  if (client.ga4_property_id) {
    try {
      const { BetaAnalyticsDataClient } = require("@google-analytics/data");
      const creds = JSON.parse(client.service_account_json);
      const analyticsClient = new BetaAnalyticsDataClient({ credentials: creds });
      await analyticsClient.runReport({
        property: `properties/${client.ga4_property_id}`,
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        metrics: [{ name: "sessions" }],
        limit: 1,
      });
      results.ga4 = "connected";
    } catch (err) {
      results.ga4 = `error: ${err.message}`;
    }
  }

  // Test GSC
  if (client.gsc_site_url) {
    try {
      const { google } = require("googleapis");
      const creds = JSON.parse(client.service_account_json);
      const auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
      });
      const searchconsole = google.searchconsole({ version: "v1", auth });
      await searchconsole.searchanalytics.query({
        siteUrl: client.gsc_site_url,
        requestBody: {
          startDate: "2024-01-01",
          endDate: "2024-01-02",
          dimensions: ["query"],
          rowLimit: 1,
        },
      });
      results.gsc = "connected";
    } catch (err) {
      results.gsc = `error: ${err.message}`;
    }
  }

  res.json(results);
});

module.exports = router;
