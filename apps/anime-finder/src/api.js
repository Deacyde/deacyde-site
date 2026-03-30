/**
 * API routes — auth, search, library, recommendations, settings
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const OpenAI = require("openai");
const db = require("./db");

const router = express.Router();

// ── Auth middleware ──
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: "unauthorized" });
}

// Check if first-run (no password set yet)
router.get("/auth/status", (req, res) => {
  const hasPassword = !!db.getSetting("password_hash");
  const authenticated = !!(req.session && req.session.authenticated);
  res.json({ hasPassword, authenticated, needsSetup: !hasPassword });
});

// First-run: set password
router.post("/auth/setup", (req, res) => {
  if (db.getSetting("password_hash")) {
    return res.status(400).json({ error: "Password already set" });
  }
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.setSetting("password_hash", hash);
  req.session.authenticated = true;
  res.json({ ok: true });
});

// Login
router.post("/auth/login", (req, res) => {
  const hash = db.getSetting("password_hash");
  if (!hash) return res.status(400).json({ error: "No password set — use setup" });

  const { password } = req.body;
  if (!bcrypt.compareSync(password || "", hash)) {
    return res.status(401).json({ error: "Wrong password" });
  }
  req.session.authenticated = true;
  res.json({ ok: true });
});

// Logout
router.post("/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ── Settings (protected) ──
router.get("/settings", requireAuth, (req, res) => {
  const hasKey = !!db.getEncryptedSetting("openai_key");
  const hasTMDB = !!db.getSetting("tmdb_api_key");
  res.json({ hasOpenAIKey: hasKey, hasTMDBKey: hasTMDB });
});

router.post("/settings/openai-key", requireAuth, (req, res) => {
  const { key } = req.body;
  if (!key || !key.startsWith("sk-")) {
    return res.status(400).json({ error: "Invalid OpenAI API key" });
  }
  db.setEncryptedSetting("openai_key", key);
  res.json({ ok: true });
});

router.post("/settings/tmdb-key", requireAuth, (req, res) => {
  const { key } = req.body;
  if (!key || key.length < 10) {
    return res.status(400).json({ error: "Invalid TMDB API key" });
  }
  db.setSetting("tmdb_api_key", key);
  res.json({ ok: true });
});

router.post("/settings/change-password", requireAuth, (req, res) => {
  const { current, newPassword } = req.body;
  const hash = db.getSetting("password_hash");
  if (!bcrypt.compareSync(current || "", hash)) {
    return res.status(401).json({ error: "Current password is wrong" });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "New password must be at least 4 characters" });
  }
  db.setSetting("password_hash", bcrypt.hashSync(newPassword, 10));
  res.json({ ok: true });
});

// ── Search (AniList + Kitsu) ──
router.get("/search", requireAuth, async (req, res) => {
  const { q, type } = req.query;
  if (!q) return res.status(400).json({ error: "Query required" });

  const mediaType = type || "anime"; // anime, tv, movie
  try {
    if (mediaType === "tv" || mediaType === "movie") {
      // Use TMDB for TV shows and movies
      const tmdbKey = db.getSetting("tmdb_api_key");
      if (!tmdbKey) return res.json({ results: [], error: "Add your TMDB API key in Settings to search TV shows & movies" });

      const tmdbResults = await searchTMDB(q, mediaType, tmdbKey);
      return res.json({ results: tmdbResults.slice(0, 20) });
    }

    // Anime: AniList + Kitsu
    const [anilistResults, kitsuResults] = await Promise.allSettled([
      searchAniList(q, mediaType),
      searchKitsu(q, mediaType),
    ]);

    const results = [];
    const seen = new Set();

    if (anilistResults.status === "fulfilled") {
      for (const r of anilistResults.value) {
        seen.add(r.title.toLowerCase());
        results.push(r);
      }
    }

    if (kitsuResults.status === "fulfilled") {
      for (const r of kitsuResults.value) {
        if (!seen.has(r.title.toLowerCase())) {
          results.push(r);
        }
      }
    }

    res.json({ results: results.slice(0, 20) });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

async function searchAniList(query, mediaType) {
  const typeMap = { anime: "ANIME", tv: "ANIME", movie: "ANIME" };
  const formatFilter = mediaType === "movie" ? ", format: MOVIE" : mediaType === "tv" ? ", format: TV" : "";

  const gql = `
    query($search: String) {
      Page(perPage: 20) {
        media(search: $search, type: ${typeMap[mediaType] || "ANIME"}${formatFilter}, sort: SEARCH_MATCH) {
          id
          title { english romaji native }
          coverImage { extraLarge large }
          description
          episodes
          status
          format
          genres
          averageScore
          seasonYear
          startDate { year }
          tags { name }
          externalLinks { url site type }
          relations {
            edges {
              relationType
              node { id title { english romaji } }
            }
          }
        }
      }
    }
  `;

  const resp = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables: { search: query } }),
  });

  const { data } = await resp.json();
  if (!data || !data.Page) return [];

  // Build a set of IDs that are sequels/prequels of another result
  const allIds = new Set(data.Page.media.map(m => m.id));
  const sequelOf = new Map(); // childId -> parentId
  for (const m of data.Page.media) {
    for (const edge of (m.relations?.edges || [])) {
      if (edge.relationType === "SEQUEL" && allIds.has(edge.node.id)) {
        sequelOf.set(edge.node.id, m.id);
      }
    }
  }

  // Find root parent for each show
  function getRoot(id) {
    let cur = id;
    const visited = new Set();
    while (sequelOf.has(cur) && !visited.has(cur)) {
      visited.add(cur);
      cur = sequelOf.get(cur);
    }
    return cur;
  }

  // Group by franchise root
  const groups = new Map();
  for (const m of data.Page.media) {
    const rootId = getRoot(m.id);
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId).push(m);
  }

  // For each group, return the root entry with season count + total episodes
  const results = [];
  for (const [rootId, entries] of groups) {
    const root = entries.find(e => e.id === rootId) || entries[0];
    const totalEps = entries.reduce((sum, e) => sum + (e.episodes || 0), 0);
    const seasons = entries.length;
    const year = root.seasonYear || root.startDate?.year || null;

    results.push({
      external_id: String(root.id),
      source: "anilist",
      media_type: (root.format === "MOVIE" ? "movie" : root.format === "TV" ? "tv" : "anime"),
      title: root.title.english || root.title.romaji || root.title.native || "Unknown",
      title_alt: root.title.romaji !== (root.title.english || root.title.romaji) ? root.title.romaji : null,
      cover_url: root.coverImage?.extraLarge || root.coverImage?.large,
      synopsis: root.description ? root.description.replace(/<[^>]+>/g, "").slice(0, 500) : null,
      episodes: totalEps || null,
      seasons,
      format: root.format,
      genres: root.genres || [],
      tags: (root.tags || []).map(t => t.name).slice(0, 10),
      year,
      score: root.averageScore ? Math.round(root.averageScore / 10) : null,
      streaming: (root.externalLinks || []).filter(l => l.type === "STREAMING").map(l => ({ site: l.site, url: l.url })),
      status: root.status,
    });
  }

  return results;
}

async function searchKitsu(query, mediaType) {
  const url = `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=10`;
  const resp = await fetch(url, {
    headers: { Accept: "application/vnd.api+json" },
  });

  const { data } = await resp.json();
  if (!data) return [];

  return data.map(a => {
    const attr = a.attributes;
    return {
      external_id: a.id,
      source: "kitsu",
      media_type: attr.showType === "movie" ? "movie" : "anime",
      title: attr.titles?.en || attr.titles?.en_jp || attr.canonicalTitle || "Unknown",
      title_alt: attr.titles?.ja_jp || null,
      cover_url: attr.posterImage?.large || attr.posterImage?.medium,
      synopsis: attr.synopsis ? attr.synopsis.slice(0, 500) : null,
      episodes: attr.episodeCount,
      format: attr.showType?.toUpperCase(),
      genres: [],
      tags: [],
      year: attr.startDate ? parseInt(attr.startDate) : null,
      score: attr.averageRating ? Math.round(parseFloat(attr.averageRating) / 10) : null,
      streaming: [],
      status: attr.status,
    };
  });
}

async function searchTMDB(query, mediaType, apiKey) {
  const tmdbType = mediaType === "tv" ? "tv" : "movie";
  const url = `https://api.themoviedb.org/3/search/${tmdbType}?query=${encodeURIComponent(query)}&api_key=${apiKey}&language=en-US&page=1`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!data.results) return [];

  const results = [];
  for (const item of data.results.slice(0, 15)) {
    const title = item.title || item.name || "Unknown";
    const year = (item.release_date || item.first_air_date || "").slice(0, 4);
    const detailUrl = `https://api.themoviedb.org/3/${tmdbType}/${item.id}?api_key=${apiKey}&language=en-US&append_to_response=watch/providers,credits,external_ids`;

    let detail = null;
    try {
      const dResp = await fetch(detailUrl);
      detail = await dResp.json();
    } catch {}

    // Extract US streaming providers
    const streaming = [];
    const providers = detail?.["watch/providers"]?.results?.US;
    if (providers) {
      for (const p of (providers.flatrate || []).concat(providers.ads || []).slice(0, 5)) {
        streaming.push({ site: p.provider_name, url: `https://www.themoviedb.org/${tmdbType}/${item.id}/watch` });
      }
    }

    const seasons = detail?.number_of_seasons || null;
    const episodes = detail?.number_of_episodes || null;
    const genres = (detail?.genres || item.genre_ids || []).map(g => g.name || g).filter(g => typeof g === "string");

    results.push({
      external_id: String(item.id),
      source: "tmdb",
      media_type: tmdbType === "tv" ? "tv" : "movie",
      title,
      title_alt: null,
      cover_url: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      synopsis: (item.overview || "").slice(0, 500),
      episodes,
      seasons,
      format: tmdbType === "tv" ? "TV" : "MOVIE",
      genres,
      tags: [],
      year: year ? parseInt(year) : null,
      score: item.vote_average ? Math.round(item.vote_average) : null,
      streaming,
      status: detail?.status || null,
    });

    await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

// ── Library (protected) ──
router.get("/library", requireAuth, (req, res) => {
  const filters = {
    media_type: req.query.type,
    status: req.query.status,
    genre: req.query.genre,
    user_tag: req.query.user_tag,
    min_score: req.query.min_score ? parseInt(req.query.min_score) : undefined,
    max_score: req.query.max_score ? parseInt(req.query.max_score) : undefined,
    search: req.query.search,
    sort: req.query.sort,
  };
  const items = db.getLibrary(filters);
  res.json({ items, stats: db.getLibraryStats() });
});

router.post("/library", requireAuth, (req, res) => {
  const item = req.body;
  if (!item.title) return res.status(400).json({ error: "Title required" });

  db.addToLibrary({
    external_id: item.external_id || null,
    source: item.source || "manual",
    media_type: item.media_type || "anime",
    title: item.title,
    title_alt: item.title_alt || null,
    cover_url: item.cover_url || null,
    banner_url: item.banner_url || null,
    synopsis: item.synopsis || null,
    score: item.score || null,
    status: item.status || "watched",
    priority: item.priority || null,
    genres: JSON.stringify(item.genres || []),
    tags: JSON.stringify(item.tags || []),
    user_tags: JSON.stringify(item.user_tags || []),
    episodes: item.episodes || null,
    format: item.format || null,
    year: item.year || null,
    streaming: JSON.stringify(item.streaming || []),
    notes: item.notes || null,
  });
  res.json({ ok: true });
});

router.put("/library/:id", requireAuth, (req, res) => {
  db.updateLibraryItem(parseInt(req.params.id), req.body);
  res.json({ ok: true });
});

router.delete("/library/:id", requireAuth, (req, res) => {
  db.removeFromLibrary(parseInt(req.params.id));
  res.json({ ok: true });
});

// ── Bulk import ──
router.post("/import", requireAuth, async (req, res) => {
  const { format, data } = req.body;
  let count = 0;

  try {
    if (format === "text") {
      // Plain text: one title per line
      const lines = data.split("\n").map(l => l.trim()).filter(Boolean);
      for (const title of lines) {
        try {
          const results = await searchAniList(title, "anime");
          if (results.length > 0) {
            const r = results[0];
            db.addToLibrary({
              external_id: r.external_id,
              source: r.source,
              media_type: r.media_type,
              title: r.title,
              title_alt: r.title_alt,
              cover_url: r.cover_url,
              banner_url: null,
              synopsis: r.synopsis,
              score: null,
              status: "watched",
              genres: JSON.stringify(r.genres),
              tags: JSON.stringify(r.tags),
              episodes: r.episodes,
              format: r.format,
              year: r.year,
              streaming: JSON.stringify(r.streaming),
              notes: null,
            });
            count++;
          }
          // Rate limit AniList
          await new Promise(r => setTimeout(r, 300));
        } catch {}
      }
    } else if (format === "mal-xml") {
      // MAL XML export
      const entries = data.match(/<anime>([\s\S]*?)<\/anime>/g) || [];
      for (const entry of entries) {
        const get = (tag) => { const m = entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? m[1].trim() : null; };
        const title = get("anime_title");
        const malScore = parseInt(get("my_score")) || null;
        const malStatus = get("my_status");
        const statusMap = { "1": "watching", "2": "watched", "3": "watching", "4": "dropped", "6": "plan" };

        if (title) {
          try {
            const results = await searchAniList(title, "anime");
            if (results.length > 0) {
              const r = results[0];
              db.addToLibrary({
                external_id: r.external_id, source: r.source, media_type: r.media_type,
                title: r.title, title_alt: r.title_alt, cover_url: r.cover_url, banner_url: null,
                synopsis: r.synopsis, score: malScore, status: statusMap[malStatus] || "watched",
                genres: JSON.stringify(r.genres), tags: JSON.stringify(r.tags),
                episodes: r.episodes, format: r.format, year: r.year,
                streaming: JSON.stringify(r.streaming), notes: null,
              });
              count++;
            }
            await new Promise(r => setTimeout(r, 300));
          } catch {}
        }
      }
    } else if (format === "json") {
      // AniList JSON or generic JSON array
      const items = typeof data === "string" ? JSON.parse(data) : data;
      for (const item of (Array.isArray(items) ? items : [])) {
        const title = item.title || item.media?.title?.english || item.media?.title?.romaji;
        if (title) {
          try {
            const results = await searchAniList(title, "anime");
            if (results.length > 0) {
              const r = results[0];
              db.addToLibrary({
                external_id: r.external_id, source: r.source, media_type: r.media_type,
                title: r.title, title_alt: r.title_alt, cover_url: r.cover_url, banner_url: null,
                synopsis: r.synopsis, score: item.score || item.rating || null,
                status: "watched", genres: JSON.stringify(r.genres), tags: JSON.stringify(r.tags),
                episodes: r.episodes, format: r.format, year: r.year,
                streaming: JSON.stringify(r.streaming), notes: null,
              });
              count++;
            }
            await new Promise(r => setTimeout(r, 300));
          } catch {}
        }
      }
    }

    res.json({ ok: true, imported: count });
  } catch (err) {
    console.error("Import error:", err);
    res.status(500).json({ error: "Import failed" });
  }
});

// ── Taste Profile ──
router.get("/taste", requireAuth, (req, res) => {
  const profile = db.getTasteProfile({ media_type: req.query.type, user_tag: req.query.user_tag });
  if (!profile) return res.json({ error: "Rate some shows first" });
  res.json(profile);
});

// ── AI Recommendations ──
router.post("/recommend", requireAuth, async (req, res) => {
  const apiKey = db.getEncryptedSetting("openai_key");
  if (!apiKey) return res.status(400).json({ error: "Set your OpenAI API key in settings first" });

  const { media_type, user_tag, genres } = req.body;
  const profile = db.getTasteProfile({ media_type, user_tag });
  if (!profile || profile.totalRated < 3) {
    return res.status(400).json({ error: "Rate at least 3 shows before getting recommendations" });
  }

  const typeLabel = media_type === "tv" ? "TV shows" : media_type === "movie" ? "movies" : "anime";
  const forWhom = user_tag ? ` (based on ${user_tag}'s taste)` : "";
  const genreFilter = genres && genres.length ? genres : null;

  // Get ALL library titles to exclude — recs should never suggest anything already in library regardless of who tagged it
  const allLibrary = db.getLibrary({ media_type });
  const existing = allLibrary.map(i => i.title.toLowerCase());

  const isAnime = media_type === "anime" || !media_type;
  const langRule = isAnime
    ? `CRITICAL RULE: ONLY recommend anime that have an ENGLISH DUB available. The user does NOT watch subtitled content. If a show is sub-only, do NOT recommend it.`
    : `CRITICAL RULE: ONLY recommend ${typeLabel} that are in English or have English audio available. Do NOT recommend foreign-language-only content.`;

  const platformHint = isAnime
    ? `Stick to well-known dubbed titles from platforms like Crunchyroll, Funimation, Netflix, Hulu, etc.`
    : `Recommend titles available on major streaming platforms like Netflix, Hulu, HBO Max, Disney+, Amazon Prime, Apple TV+, Peacock, etc.`;

  const systemPrompt = `You are a ${typeLabel} recommendation expert. Analyze the user's taste profile and recommend exactly 8 ${typeLabel} they haven't seen.

${langRule}
${platformHint}

${isAnime ? '' : `IMPORTANT: Only recommend ${typeLabel}. Do NOT recommend anime or animated shows unless they are mainstream Western animation (like Invincible, Arcane, etc).`}

For each recommendation, provide:
- title: The official English title
- reason: 2-3 sentences explaining WHY this specific user would love it based on their taste
- score_prediction: Your predicted score (1-10) this user would give it
- genres: Array of genres
- ${isAnime ? 'dub_platform' : 'streaming_platform'}: Where to watch (e.g., "${isAnime ? 'Crunchyroll' : 'Netflix'}")

Respond in JSON: { "recommendations": [ { "title": "...", "reason": "...", "score_prediction": 8, "genres": ["..."], "${isAnime ? 'dub_platform' : 'streaming_platform'}": "..." } ] }

IMPORTANT: Do NOT recommend anything the user has already watched. Be creative — mix popular classics with hidden gems.`;

  const userPrompt = `My taste profile:

Top genres (avg score): ${profile.genreAvg.slice(0, 8).map(g => `${g.genre}: ${g.avg}/10 (${g.count} shows)`).join(", ")}

Favorite shows (rated highest):
${profile.topRated.map(t => `- ${t.title} (${t.score}/10) [${t.media_type}]`).join("\n")}

Least favorite:
${profile.bottomRated.map(t => `- ${t.title} (${t.score}/10)`).join("\n")}

Top tags: ${profile.tagAvg.slice(0, 10).map(t => `${t.tag}: ${t.avg}`).join(", ")}

Total rated: ${profile.totalRated}

Already watched (DO NOT recommend these): ${existing.slice(0, 50).join(", ")}

Give me 8 ${typeLabel} recommendations.${isAnime ? ' REMEMBER: English dub available is REQUIRED — no sub-only titles.' : ` ONLY ${typeLabel} — no anime.`}${genreFilter ? `\n\nIMPORTANT: ONLY recommend titles in these genres: ${genreFilter.join(', ')}. Every recommendation MUST fit at least one of these genres.` : ''}`;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    const content = JSON.parse(completion.choices[0].message.content);
    const recs = content.recommendations || [];

    // Enrich with metadata — AniList for anime, TMDB for TV/movies
    const enriched = [];
    const tmdbKey = db.getSetting("tmdb_api_key");
    for (const rec of recs) {
      try {
        let match = null;
        if (isAnime) {
          const results = await searchAniList(rec.title, "anime");
          match = results[0];
        } else if (tmdbKey) {
          const results = await searchTMDB(rec.title, media_type, tmdbKey);
          match = results[0];
        }
        enriched.push({
          external_id: match?.external_id || null,
          source: match?.source || "ai",
          media_type: media_type || "anime",
          title: match?.title || rec.title,
          cover_url: match?.cover_url || null,
          synopsis: match?.synopsis || null,
          genres: JSON.stringify(rec.genres || match?.genres || []),
          streaming: JSON.stringify(match?.streaming || []),
          reason: rec.reason,
          score_pred: rec.score_prediction,
          dub_platform: rec.dub_platform || rec.streaming_platform || null,
          year: match?.year || null,
        });
        await new Promise(r => setTimeout(r, 200));
      } catch {
        enriched.push({
          external_id: null, source: "ai", media_type: media_type || "anime",
          title: rec.title, cover_url: null, synopsis: null,
          genres: JSON.stringify(rec.genres || []), streaming: "[]",
          reason: rec.reason, score_pred: rec.score_prediction,
          dub_platform: rec.dub_platform || rec.streaming_platform || null,
          year: null,
        });
      }
    }

    // Filter out any recs that match existing library titles (AI sometimes ignores the exclusion list)
    const filtered = enriched.filter(r => !existing.includes(r.title.toLowerCase()));

    // Clear old non-dismissed recs and save new ones
    db.saveRecommendations(filtered);
    res.json({ recommendations: db.getRecommendations() });
  } catch (err) {
    console.error("AI recommendation error:", err);
    res.status(500).json({ error: `Recommendation failed: ${err.message}` });
  }
});

router.get("/recommendations", requireAuth, (req, res) => {
  res.json({ recommendations: db.getRecommendations() });
});

router.post("/recommendations/clear", requireAuth, (req, res) => {
  db.clearCurrentRecs();
  res.json({ ok: true });
});

router.get("/recommendations/skipped", requireAuth, (req, res) => {
  res.json({ recommendations: db.getRecommendations(true) });
});

router.post("/recommendations/:id/dismiss", requireAuth, (req, res) => {
  db.dismissRecommendation(parseInt(req.params.id));
  res.json({ ok: true });
});

router.post("/recommendations/:id/add", requireAuth, (req, res) => {
  db.markRecAdded(parseInt(req.params.id));
  res.json({ ok: true });
});

router.post("/recommendations/:id/undismiss", requireAuth, (req, res) => {
  db.undismissRecommendation(parseInt(req.params.id));
  res.json({ ok: true });
});

// ── Refresh missing metadata ──
router.post("/library/refresh-metadata", requireAuth, async (req, res) => {
  const items = db.getLibrary({});
  const needsRefresh = items.filter(i => !i.year || !i.cover_url);
  if (!needsRefresh.length) return res.json({ updated: 0, message: "All titles already have metadata" });

  const tmdbKey = db.getSetting("tmdb_api_key");
  let updated = 0;
  const errors = [];

  for (const item of needsRefresh) {
    try {
      const updates = {};
      const isAnime = item.media_type === "anime" || (!item.media_type && item.source === "anilist");
      const isTMDB = item.source === "tmdb" || item.media_type === "movie" || item.media_type === "tv";

      if (isAnime && item.external_id && item.source === "anilist") {
        // Fetch directly by AniList ID
        const gql = `query($id: Int) { Media(id: $id, type: ANIME) { id coverImage { extraLarge large } seasonYear startDate { year } } }`;
        const resp = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: gql, variables: { id: parseInt(item.external_id) } }),
        });
        const data = await resp.json();
        const m = data?.data?.Media;
        if (m) {
          if (!item.year && (m.seasonYear || m.startDate?.year)) updates.year = m.seasonYear || m.startDate.year;
          if (!item.cover_url && (m.coverImage?.extraLarge || m.coverImage?.large)) updates.cover_url = m.coverImage.extraLarge || m.coverImage.large;
        }
      } else if (isTMDB && item.external_id && tmdbKey) {
        // Fetch directly by TMDB ID
        const tmdbType = item.media_type === "tv" ? "tv" : "movie";
        const resp = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${item.external_id}?api_key=${tmdbKey}&language=en-US`);
        const d = await resp.json();
        if (d && !d.status_code) {
          const yr = (d.release_date || d.first_air_date || "").slice(0, 4);
          if (!item.year && yr) updates.year = parseInt(yr);
          if (!item.cover_url && d.poster_path) updates.cover_url = `https://image.tmdb.org/t/p/w342${d.poster_path}`;
        }
      } else if (!item.external_id && tmdbKey) {
        // No external_id — search TMDB by title
        const tmdbType = item.media_type === "tv" ? "tv" : "movie";
        const resp = await fetch(`https://api.themoviedb.org/3/search/${tmdbType}?query=${encodeURIComponent(item.title)}&api_key=${tmdbKey}&language=en-US&page=1`);
        const data = await resp.json();
        const match = (data.results || [])[0];
        if (match) {
          const yr = (match.release_date || match.first_air_date || "").slice(0, 4);
          if (!item.year && yr) updates.year = parseInt(yr);
          if (!item.cover_url && match.poster_path) updates.cover_url = `https://image.tmdb.org/t/p/w342${match.poster_path}`;
          if (!item.external_id) { updates.external_id = String(match.id); updates.source = "tmdb"; }
        }
      } else if (isAnime && !item.external_id) {
        // No external_id — search AniList by title
        const gql = `query($search: String) { Page(perPage: 1) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { id coverImage { extraLarge large } seasonYear startDate { year } } } }`;
        const resp = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: gql, variables: { search: item.title } }),
        });
        const data = await resp.json();
        const m = (data?.data?.Page?.media || [])[0];
        if (m) {
          if (!item.year && (m.seasonYear || m.startDate?.year)) updates.year = m.seasonYear || m.startDate.year;
          if (!item.cover_url && (m.coverImage?.extraLarge || m.coverImage?.large)) updates.cover_url = m.coverImage.extraLarge || m.coverImage.large;
          if (!item.external_id) { updates.external_id = String(m.id); updates.source = "anilist"; }
        }
      }

      if (Object.keys(updates).length) {
        try {
          db.updateLibraryItem(item.id, updates);
          updated++;
          console.log(`✅ Refreshed: ${item.title} →`, updates);
        } catch (e) {
          if (e.message && e.message.includes("UNIQUE constraint")) {
            // External ID conflicts with existing entry — save just year/cover without the ID
            delete updates.external_id;
            delete updates.source;
            if (Object.keys(updates).length) {
              db.updateLibraryItem(item.id, updates);
              updated++;
              console.log(`✅ Refreshed (no ID, dupe): ${item.title} →`, updates);
            }
          } else {
            throw e;
          }
        }
      }
      await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      errors.push(`${item.title}: ${err.message}`);
    }
  }

  res.json({ updated, total: needsRefresh.length, errors: errors.length ? errors : undefined });
});

module.exports = router;
