/**
 * Google Search Console API wrapper
 * Uses googleapis to query GSC search analytics + URL inspection.
 */

const { google } = require("googleapis");

function createGSCAuth(serviceAccountJson) {
  const creds = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
}

/**
 * Query GSC search analytics.
 * @param {object} opts
 * @param {string} opts.serviceAccountJson
 * @param {string} opts.siteUrl - e.g. "https://www.example.com" or "sc-domain:example.com"
 * @param {string} opts.startDate - YYYY-MM-DD
 * @param {string} opts.endDate - YYYY-MM-DD
 * @param {string[]} [opts.dimensions] - ["query","page","country","device","date","searchAppearance"]
 * @param {string} [opts.type] - "web","image","video","news","discover","googleNews"
 * @param {number} [opts.rowLimit=25]
 * @param {object[]} [opts.dimensionFilterGroups] - Filter groups
 * @param {string} [opts.aggregationType] - "auto","byPage","byProperty"
 * @returns {object} { rows, metadata }
 */
async function queryGSC(opts) {
  const auth = createGSCAuth(opts.serviceAccountJson);
  const searchconsole = google.searchconsole({ version: "v1", auth });

  const requestBody = {
    startDate: opts.startDate,
    endDate: opts.endDate,
    dimensions: opts.dimensions || ["query"],
    rowLimit: opts.rowLimit || 25,
  };

  if (opts.type) requestBody.type = opts.type;
  if (opts.aggregationType) requestBody.aggregationType = opts.aggregationType;

  if (opts.dimensionFilterGroups) {
    requestBody.dimensionFilterGroups = opts.dimensionFilterGroups;
  }

  const response = await searchconsole.searchanalytics.query({
    siteUrl: opts.siteUrl,
    requestBody,
  });

  const rows = (response.data.rows || []).map((row) => {
    const obj = {};
    (opts.dimensions || ["query"]).forEach((dim, i) => {
      obj[dim] = row.keys[i];
    });
    obj.clicks = row.clicks;
    obj.impressions = row.impressions;
    obj.ctr = (row.ctr * 100).toFixed(2) + "%";
    obj.position = row.position.toFixed(1);
    return obj;
  });

  return {
    rows,
    rowCount: rows.length,
    metadata: {
      siteUrl: opts.siteUrl,
      dateRange: `${opts.startDate} to ${opts.endDate}`,
      type: opts.type || "web",
    },
  };
}

/**
 * Inspect a URL in GSC.
 * @param {object} opts
 * @param {string} opts.serviceAccountJson
 * @param {string} opts.siteUrl
 * @param {string} opts.inspectionUrl - Full URL to inspect
 * @returns {object} Inspection result
 */
async function inspectUrl(opts) {
  const creds = typeof opts.serviceAccountJson === "string" ? JSON.parse(opts.serviceAccountJson) : opts.serviceAccountJson;
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/webmasters"],
  });
  const searchconsole = google.searchconsole({ version: "v1", auth });

  const response = await searchconsole.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl: opts.inspectionUrl,
      siteUrl: opts.siteUrl,
    },
  });

  const result = response.data.inspectionResult;
  return {
    url: opts.inspectionUrl,
    indexStatus: result.indexStatusResult?.verdict || "UNKNOWN",
    coverageState: result.indexStatusResult?.coverageState || "UNKNOWN",
    crawledAs: result.indexStatusResult?.crawledAs || "UNKNOWN",
    lastCrawlTime: result.indexStatusResult?.lastCrawlTime || null,
    pageFetchState: result.indexStatusResult?.pageFetchState || "UNKNOWN",
    robotsTxtState: result.indexStatusResult?.robotsTxtState || "UNKNOWN",
    mobileUsability: result.mobileUsabilityResult?.verdict || "UNKNOWN",
    richResults: result.richResultsResult?.detectedItems?.map((i) => i.richResultType) || [],
  };
}

// Helper: resolve relative dates to YYYY-MM-DD for GSC
function resolveDate(dateStr) {
  const now = new Date();
  if (dateStr === "today") return formatDate(now);
  if (dateStr === "yesterday") {
    now.setDate(now.getDate() - 1);
    return formatDate(now);
  }
  const match = dateStr.match(/^(\d+)daysAgo$/);
  if (match) {
    now.setDate(now.getDate() - parseInt(match[1]));
    return formatDate(now);
  }
  return dateStr; // Assume YYYY-MM-DD
}

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

const GSC_DIMENSIONS = ["query", "page", "country", "device", "date", "searchAppearance"];

module.exports = { queryGSC, inspectUrl, resolveDate, GSC_DIMENSIONS };
