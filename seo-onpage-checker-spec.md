# SEO Onpage Checker — Build Spec v2

## Overview

Build a server-side on-page SEO checker tool at `dev.deacyde.com` under the SEO app section.
Title: **SEO Onpage Checker**

The tool accepts a URL, fetches the actual HTML source server-side via a Cloudflare Worker or Pi server worker, parses the real DOM, and runs deterministic SEO checks. It also accepts raw HTML paste (for WordPress draft HTML, pre-publish content, etc.) and plain text copy.

Because this runs on your own infrastructure, you can actually fetch the page HTML with a real HTTP request — no API proxy, no LLM guessing from search snippets. Parse the real DOM. Every check below should be computed from actual HTML elements, not inferred or summarized.

---

## Architecture — Fetch Worker

### Worker Toggle
The app already has several tools that use either a Cloudflare Worker or Pi server worker for HTTP fetch tasks. Add a toggle (persistent via localStorage or user setting) that lets the user choose which worker handles the fetch:

- **Cloudflare Worker** (default) — faster, edge-located
- **Pi Server Worker** — local fallback, useful for sites that block Cloudflare IPs

Both workers do the same thing:
1. Accept a URL parameter
2. Perform an HTTP GET with a standard User-Agent header: `Mozilla/5.0 (compatible; SEOChecker/1.0)`
3. Follow redirects (up to 5 hops)
4. Timeout after 15 seconds
5. Return the raw HTML response body + response headers (status code, content-type, etc.)
6. Handle errors gracefully: connection refused, timeout, 4xx/5xx, SSL errors

### Endpoint Shape
```
GET /api/seo/fetch?url=<encoded_url>

Response:
{
  "html": "<full raw HTML string>",
  "statusCode": 200,
  "headers": { "content-type": "text/html; charset=UTF-8", ... },
  "finalUrl": "https://example.com/resolved-url-after-redirects",
  "error": null
}
```

---

## Input Modes

### 1. URL Mode (primary)
- User enters a URL
- App calls the selected worker to fetch raw HTML
- Parse it client-side with DOMParser (or server-side with cheerio/jsdom)
- Run all checks against the parsed DOM

### 2. Paste Mode
- User pastes raw HTML (from Ctrl+U view source, WordPress "Edit as HTML" block, or any CMS draft)
- Parse it client-side with DOMParser
- Run identical checks

### 3. Plain Text Mode
- Auto-detected when input contains no HTML tags
- Wrap in `<body><p>...</p></body>` splitting on double newlines
- Run applicable checks (headings, AI signals, content depth, keyword — links/meta won't apply)

### Shared Inputs
- **Target Keyword** (optional text field) — for keyword placement checks
- **Run Analysis** button
- **Worker Toggle** — Cloudflare / Pi Server (small toggle near the URL input)

---

## Tabbed Layout

After analysis completes, results display in a **tabbed interface**. Reference the Detailed SEO Extension layout:

```
[ Overview ] [ Headings ] [ Links ] [ Images ] [ Schema ] [ Social ] [ Advanced ]
```

Each tab shows its relevant data. The Overview tab is the default landing view with the SEO score and all check results. The other tabs show extracted raw data from the page.

---

## Tab 1: Overview (SEO Checks)

This is the main analysis tab with the score and all check results.

### Overall Score
- Circular badge: 0-100
- Color: green (#10b981) ≥80, yellow (#f59e0b) 50-79, red (#ef4444) <50
- Formula: `(pass_count × 1 + warn_count × 0.5) / scorable_checks × 100`
- Info-status items don't count toward score

### Summary Bar (like the extension screenshot)
Quick-glance row showing key counts:

```
┌──────────────────────────────────────────────────────────────┐
│  H1   H2   H3   H4   H5   H6  │  Images  │  Links         │
│   1   10   48    6    0    0   │    16    │   313          │
└──────────────────────────────────────────────────────────────┘
```

### Category Filter Pills
- All | Headings | AI Detection | Links | Content | Keyword | Meta
- Each pill shows a colored dot for worst status in that category
- Clicking filters the results list

### SEO Check Cards
Each check renders as a card with:
- Left border colored by status (green=pass, red=fail, yellow=warn, purple=info)
- Status icon: ✓ / ✕ / ! / i
- Check name + category label (right-aligned, muted)
- Detail text (multi-line, monospace for items with → arrows)
- Info rows should be **collapsible** (especially heading sequence, link lists)

---

### Check 1: H1 — Page Title

**Parse:** All `<h1>` elements.

- PASS: Exactly 1 H1, 10-70 chars
- WARN: Multiple H1s, or length >70 or <10
- FAIL: No H1

Show: H1 text + character count.

---

### Check 2: Heading Hierarchy

**Parse:** All `<h1>` through `<h6>` in document order.

Walk the sequence. If any heading jumps more than 1 level down (e.g., H2 → H4), flag it. Show the EXACT heading text where the skip occurs:

```
Skipped levels found:
H2 → H4 (skipped H3) near "Revenue Per Employee Metrics"
H3 → H6 (skipped H4, H5) near "Additional Resources"
```

Also show heading inventory: `H1: 1, H2: 10, H3: 48, H4: 6`

---

### Check 3: LLM / AI Generation Signals

**Em dashes (—):** Count every `—` in body text.
- >3 = warn, >6 = fail

**AI-typical phrases** (case-insensitive body text match):
```
"it's important to note", "it's worth noting", "delve into", "delve deeper",
"dive into", "deep dive", "let's explore", "in this comprehensive",
"navigate the complexities", "unlock the power", "ever-evolving",
"cutting-edge", "leverage the power", "leverage", "holistic approach",
"paradigm shift", "in the realm of", "furthermore,", "moreover,",
"robust", "seamlessly", "multifaceted", "tapestry", "synergy",
"at the end of the day", "it goes without saying", "spearhead",
"in an era where", "game-changer", "game changer", "revolutionize",
"in conclusion,", "to summarize,", "as we've seen,"
```

**URL signals:** Flag if URL contains `chatgpt`, `openai`, `claude`, `bard`, `gemini`, `ai-generated`.

**Severity:**
- PASS: 0-2 em dashes AND 0 phrases
- WARN: 3-5 em dashes OR 1-2 phrases
- FAIL: 6+ em dashes OR 3+ phrases

Show: exact em dash count + specific phrases found.

---

### Check 4: Internal Links

**Parse:** All `<a href="...">` in the page.

Skip: `#` anchors, `javascript:`, `mailto:`, `tel:`.

**Internal detection:**
- Relative paths (`/path`, `./path`) = internal
- Absolute URLs where hostname matches page domain (strip `www.` from both sides) = internal
- Everything else with `http` = external

**Counts:**
- PASS: 3+ internal links
- WARN: 1-2
- FAIL: 0

**Anchor text quality — flag ONLY exact matches** (case-insensitive) against:
```
"read more", "click here", "learn more", "see more", "view more",
"find out more", "check it out", "go here", "continue reading", "read on",
"here", "this", "link", "more", "read", "go"
```
For the short words (here/this/link/more/read/go), only flag if the ENTIRE anchor text is that word.

**DO NOT flag** descriptive anchors like "What is a KPI?", "SAP migration guide", "financial reporting best practices".

Show: info row with all found internal links (collapsible): `"anchor text" → /href`

---

### Check 5: Content Depth

**Parse:** Word count of article body only.

Smart container detection — try these selectors in order, use first match:
`<article>`, `<main>`, `.entry-content`, `.post-content`, `.blog-content`, `[role="main"]`

Fallback: `<body>` minus `<nav>`, `<header>`, `<footer>`, `<aside>`, `<script>`, `<style>`.

**Thresholds:**
- FAIL: <300 words
- WARN: 300-599
- PASS: 600-999 ("decent length")
- PASS: 1000+ ("strong depth")

---

### Check 6: Structure & Scannability

4 sub-checks:

1. **Subheadings:** 3+ headings = ✓
2. **Lists:** ≥1 `<ul>` or `<ol>` = ✓
3. **Paragraph length:** Any `<p>` with 150+ words = ✗ (count them). All under = ✓
4. **Images:** ≥1 `<img>` = ✓, none = △

Score: 3-4 ✓ = PASS, 2 = WARN, 0-1 = FAIL

---

### Check 7: Target Keyword Placement

Only if keyword provided.

- **In H1:** case-insensitive substring match
- **In any H2:** same
- **Body occurrences + density:** `(occurrences × keyword_word_count) / total_words × 100`
- **In first 100 words:** substring match

```
✓ Found in H1
✗ NOT found in any H2
✓ 12 occurrences in body (1.4% density)
✓ Appears in first 100 words
```

Score: 3 = PASS, 1-2 = WARN, 0 = FAIL. Warn if density >3%.

---

### Check 8: Meta Tags

**Title tag (`<title>`):**
- Show text + char count
- WARN if >60 chars
- PASS if ≤60

**Meta description (`<meta name="description">`):**
- Show char count
- WARN if >160 or <50
- PASS if 50-160
- FAIL if missing

---

### Check 9: Image Alt Text

- Count all `<img>` tags
- Count those with empty/missing `alt`
- PASS: All have alt
- WARN: Some missing
- Show: `N of M missing alt text`

---

### Check 10: URL / Slug

Only in URL mode.

- All lowercase? (warn if not)
- Hyphens vs underscores? (warn on underscores)
- Path length >90 chars? (warn)
- Contains AI tool references in URL? (flag)
- Contains target keyword in slug? (if keyword provided)

---

## Tab 2: Headings

### Visual Heading Tree

Render headings as an **indented, visually hierarchical tree** with heading level badges. Reference the Detailed SEO Extension's Headings tab:

```
<H1>  40+ Top Operational KPIs & Metrics for Reporting and More          [Copy]
  <H2>  What are Operational KPIs?
  <H2>  Operational Metrics: Why Your Company Needs Them to Stay Competitive
  <H2>  Financial and Sales Operations KPIs for Managers
    <H3>  1. Accounts Receivable Turnover
    <H3>  2. Days Sales Outstanding (DSO)
    <H3>  3. Gross Profit Margin
    <H3>  4. Working Capital (Net Working Capital)
    <H3>  5. Return on Equity (ROE)
    <H3>  6. Operating Cash Flow
    <H3>  7. Quick Ratio
  <H2>  Staffing Operational KPIs
    <H3>  Employee Turnover Rate
    <H3>  Quality of Hire
  <H2>  Manufacturing Operational KPIs
  ...
```

**Implementation details:**
- Each heading gets a colored badge showing its level: `<H1>`, `<H2>`, `<H3>`, `<H4>`, `<H5>`, `<H6>`
- Badge colors (suggest): H1 = purple/violet, H2 = blue, H3 = teal, H4 = gray, H5/H6 = muted
- Indentation increases per level (e.g., H1 = 0px, H2 = 24px, H3 = 48px, H4 = 72px)
- Heading text shown next to badge
- H1 gets a "Copy" button
- If a hierarchy skip exists, visually highlight the offending heading (red border or warning icon)
- Heading count summary at top: `H1: 1 | H2: 10 | H3: 48 | H4: 6 | H5: 0 | H6: 0`

---

## Tab 3: Links

### Link Summary Bar
```
Total Links    Unique    Internal    External
    313          252        282         31
```

### Link Table
Sortable/filterable table of all links:

| Anchor Text | URL | Type | Status |
|---|---|---|---|
| What is a KPI? | /encyclopedia/what-is-a-kpi/ | Internal | — |
| Gartner report | https://gartner.com/... | External | — |

**Filters:**
- All / Internal / External
- Has anchor text / Missing anchor text (empty `<a>` tags)

**Export options** (nice to have):
- Export Incomplete Links (missing anchor or broken)
- Export Complete Links

---

## Tab 4: Images

### Image Summary Bar
```
Images    Without Alt    Without Title
  16          7              16
```

### Image Table
| Thumbnail | Alt Text | Title | Src |
|---|---|---|---|
| [thumb] | "KPI dashboard screenshot" | — | /wp-content/uploads/... |
| [thumb] | MISSING | — | /wp-content/uploads/... |

Highlight rows where alt is missing in red/yellow.

**Export options** (nice to have):
- Export Incomplete Images
- Export Complete Images

---

## Tab 5: Schema

### Parse all structured data from the page:

**JSON-LD (`<script type="application/ld+json">`):**
- Parse each JSON-LD block
- Display as a readable key-value tree

**Microdata (itemscope/itemprop attributes):**
- Note if present

### Display format (reference the Detailed SEO Extension):
```
@type         Article
url           https://insightsoftware.com/blog/35-operational-kpis-and-metric-examples/
headline      40+ Top Operational KPIs & Metrics for Reporting and More
description   This post takes you through 40+ of the most important...

author
  @type       Organization
  name        insightsoftware
  url         https://insightsoftware.com/

datePublished   2025-07-11T09:45:02-04:00
dateModified    2025-07-25T13:26:45-04:00

publisher
  @type       Brand
  ...
```

**Hreflang tags:**
- Parse all `<link rel="alternate" hreflang="...">` tags
- Display as a table: `Language → URL`

Nice to have: "Export Schema" button (copies JSON-LD to clipboard).

---

## Tab 6: Social

### Open Graph (Facebook)
Parse all `<meta property="og:...">` tags and display:
```
og:locale        en_US
og:type          article
og:title         40+ Top Operational KPIs & Metrics for Reporting and More
og:description   This post takes you through 40+ of the most important...
og:url           https://insightsoftware.com/blog/35-operational-kpis-and-metric-examples/
og:site_name     insightsoftware
og:image         https://insightsoftware.com/wp-content/uploads/2021/01/...
og:image:width   1200
og:image:height  626
```

Show the OG image as a preview thumbnail if available.

### Twitter Card
Parse all `<meta name="twitter:..." >` or `<meta property="twitter:...">` tags:
```
twitter:card          summary_large_image
twitter:title         ...
twitter:description   ...
twitter:image         ...
```

Show Twitter card image preview if available.

---

## Tab 7: Advanced

### Robots Directives
**Meta robots tag:** Parse `<meta name="robots" content="...">`:
```
Robots Tag: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1
```

**X-Robots-Tag:** From HTTP response headers (if available from the worker response):
```
X-Robots-Tag: Missing (or show value if present)
```

### Canonical
Parse `<link rel="canonical" href="...">`:
```
Canonical: https://insightsoftware.com/blog/35-operational-kpis-and-metric-examples/
Self-referencing: ✓ (or ✗ if canonical points elsewhere)
```

### Meta Keywords
Parse `<meta name="keywords" content="...">`:
```
Keywords: Missing (or show content)
```

### Language
Parse `<html lang="...">`:
```
Lang: en-US
```

### Word Count
```
Word Count: 5,217
```

### Publisher
Parse from JSON-LD or `<link rel="publisher">`:
```
Publisher: Missing (or show value)
```

### Additional Meta
- `<meta name="author">`
- `<meta name="viewport">`
- `<link rel="sitemap">` — link to sitemap if found via `/sitemap.xml`
- `<link rel="robots">` — link to robots.txt

### Response Info (from worker)
```
Status Code: 200
Content-Type: text/html; charset=UTF-8
Final URL: https://... (after redirects)
```

---

## UI / UX Design

### Theme
- Dark theme (matches dev.deacyde.com)
- Clean, utilitarian — developer/SEO tool, not marketing
- Monospace font for URLs, code, and technical data
- Sans-serif for labels and descriptions

### Color Reference
- Pass: `#10b981` (green)
- Fail: `#ef4444` (red)
- Warn: `#f59e0b` (amber)
- Info: `#6366f1` (indigo/purple)
- Background: `#08080c` or similar near-black
- Card background: `#0d0d14`
- Borders: `#1a1a28`
- Muted text: `#555`

### Heading Level Badge Colors (for Headings tab tree)
- H1: `#8b5cf6` (purple)
- H2: `#3b82f6` (blue)
- H3: `#14b8a6` (teal)
- H4: `#6b7280` (gray)
- H5: `#4b5563` (dark gray)
- H6: `#374151` (darker gray)

### Tab Bar
- Horizontal tabs across the top of the results area
- Active tab highlighted with bottom border or background change
- Icons next to tab names (optional):
  - Overview: grid/dashboard icon
  - Headings: list icon
  - Links: link icon
  - Images: image icon
  - Schema: code icon
  - Social: share icon
  - Advanced: settings/gear icon

### Collapsible Sections
Long data (full heading sequence, all internal links, schema trees) should be collapsible with a toggle. Default collapsed for lists >10 items.

---

## Tech Notes

### All checks are deterministic
Pure DOM parsing. Zero AI/LLM calls needed for any check. The analysis is:
1. Fetch HTML (via worker)
2. Parse with DOMParser (client) or cheerio/jsdom (server)
3. Query selectors + string operations
4. Return structured results

### Smart Content Container Detection
For word count and content-specific checks, find the article body (not nav/footer):
```
Selectors to try (first match wins):
  article
  main
  .entry-content
  .post-content
  .blog-content
  [role="main"]

Fallback: <body> minus <nav>, <header>, <footer>, <aside>, <script>, <style>
```

### Internal Link Domain Matching
```javascript
function isInternal(href, pageDomain) {
  if (href.startsWith('/') || href.startsWith('./')) return true;
  if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  try {
    const linkDomain = new URL(href).hostname.replace(/^www\./, '');
    const srcDomain = pageDomain.replace(/^www\./, '');
    return linkDomain === srcDomain;
  } catch { return false; }
}
```

### Generic Anchor Text — Exact Match List
```javascript
const GENERIC_EXACT = [
  "read more", "click here", "learn more", "see more", "view more",
  "find out more", "check it out", "go here", "continue reading", "read on"
];
const GENERIC_SINGLE_WORD = ["here", "this", "link", "more", "read", "go"];

function isGenericAnchor(text) {
  const t = text.trim().toLowerCase();
  return GENERIC_EXACT.includes(t) || GENERIC_SINGLE_WORD.includes(t);
}
// "What is a KPI?" → NOT generic (descriptive question = good anchor text)
// "click here" → generic
// "here" → generic (exact single word match)
// "here are the results" → NOT generic (not an exact match)
```

---

## Test URLs

Validate against these:

| URL | Keyword | Expected |
|-----|---------|----------|
| `https://insightsoftware.com/blog/35-operational-kpis-and-metric-examples/` | Operational KPIs | H1: 1, H2: 10, H3: 48, H4: 6, Word count ~5,200, Internal links: 282, Images: 16 (7 missing alt) |
| `https://insightsoftware.com/blog/sap-data-migration-and-the-2027-deadline-what-every-business-needs-to-know-before-its-too-late/` | SAP data migration | Should show 6+ internal links, multiple headings |

If your checker shows 0-1 internal links on the KPIs page, the domain matching for absolute URLs is broken.

---

## Common Pitfalls

1. **Internal link detection:** Pages use absolute URLs (`https://insightsoftware.com/blog/...`) not just relative paths (`/blog/...`). Match BOTH. Strip `www.` from both sides when comparing.

2. **Generic anchor false positives:** "What is a KPI?" is descriptive. Only flag exact matches from the generic list.

3. **Word count from body only:** Don't count nav/footer/sidebar. Use smart container detection.

4. **Heading hierarchy needs heading text:** "H2 → H4 skip" is useless without showing WHICH heading.

5. **JS-rendered pages:** Raw HTML fetch won't get SPA content. Note it in results. Paste mode is the fallback.

6. **Schema parsing edge cases:** Some pages have multiple JSON-LD blocks. Parse all of them. Handle malformed JSON gracefully.

7. **OG/Twitter tags:** Some sites use `property` attr, some use `name` attr for OG tags. Check both.
