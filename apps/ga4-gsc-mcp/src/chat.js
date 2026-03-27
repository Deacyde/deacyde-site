/**
 * Chat API routes
 */

const express = require("express");
const db = require("./db");
const { chat } = require("./llm");

const router = express.Router();

// POST /api/chat — send a message and get LLM response
router.post("/api/chat", async (req, res) => {
  const { message, clientId, model } = req.body;

  if (!message) return res.status(400).json({ error: "Message is required" });
  if (!clientId) return res.status(400).json({ error: "Client is required" });

  const clientConfig = db.getClient(clientId);
  if (!clientConfig) return res.status(404).json({ error: "Client not found" });

  // Save user message
  db.saveChatMessage(clientId, "user", message);

  // Build message history — limit to last 10 messages and truncate long ones
  const history = db.getChatHistory(clientId, 10);
  const MAX_MSG_CHARS = 3000;
  const messages = history.map((h) => ({
    role: h.role,
    content: h.content.length > MAX_MSG_CHARS
      ? h.content.substring(0, MAX_MSG_CHARS) + "\n...[truncated for brevity]"
      : h.content,
  }));

  try {
    const response = await chat(messages, clientConfig, model);

    // Save assistant response
    db.saveChatMessage(clientId, "assistant", response.content, {
      toolCalls: response.toolCalls,
    });

    // Check if response contains tabular data (rows array)
    let tableData = null;
    if (response.toolCalls && response.toolCalls.length > 0) {
      // Extract the last tool result if it had rows
      const lastHistory = db.getChatHistory(clientId, 2);
      const assistantMsg = lastHistory.find((h) => h.role === "assistant" && h.metadata);
      if (assistantMsg && assistantMsg.metadata) {
        try {
          const meta = JSON.parse(assistantMsg.metadata);
          tableData = meta.tableData || null;
        } catch {}
      }
    }

    res.json({
      content: response.content,
      tableData,
    });
  } catch (err) {
    console.error("Chat error:", err);
    const errorMsg = err.message || "An error occurred";
    db.saveChatMessage(clientId, "assistant", `Error: ${errorMsg}`);
    res.status(500).json({ error: errorMsg });
  }
});

// GET /api/chat/history/:clientId
router.get("/api/chat/history/:clientId", (req, res) => {
  const history = db.getChatHistory(req.params.clientId, 50);
  res.json(history);
});

// DELETE /api/chat/history/:clientId
router.delete("/api/chat/history/:clientId", (req, res) => {
  db.clearChatHistory(req.params.clientId);
  res.json({ ok: true });
});

// POST /api/chat/export — generate CSV from data
router.post("/api/chat/export", (req, res) => {
  const { headers, rows } = req.body;
  if (!headers || !rows) return res.status(400).json({ error: "headers and rows required" });

  const csvLines = [];
  csvLines.push(headers.join(","));
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = (row[h] || "").toString();
      return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    });
    csvLines.push(values.join(","));
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=export.csv");
  res.send(csvLines.join("\n"));
});

module.exports = router;
