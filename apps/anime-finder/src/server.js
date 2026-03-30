/**
 * TV, Movie & Anime Finder — Personal tracker & AI recommendation engine
 * Runs on Pi, port 3200
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const apiRouter = require("./api");

const app = express();
const PORT = process.env.PORT || 3200;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// Middleware
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
}));

// Static files (no auth needed for CSS/JS)
app.use(express.static(path.join(__dirname, "..", "public")));

// API routes (auth checked inside)
app.use("/api", apiRouter);

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🎬 TV, Movie & Anime Finder running on http://localhost:${PORT}`);
});
