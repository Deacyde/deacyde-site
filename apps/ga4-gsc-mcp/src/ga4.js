/**
 * GA4 Data API wrapper
 * Uses @google-analytics/data to query GA4 properties.
 */

const { BetaAnalyticsDataClient } = require("@google-analytics/data");

function createGA4Client(serviceAccountJson) {
  const creds = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  return new BetaAnalyticsDataClient({ credentials: creds });
}

/**
 * Run a GA4 report.
 * @param {object} opts
 * @param {string} opts.serviceAccountJson - Service account JSON string
 * @param {string} opts.propertyId - GA4 property ID (numbers only)
 * @param {string[]} opts.dimensions - e.g. ["landingPage", "sessionSource"]
 * @param {string[]} opts.metrics - e.g. ["sessions", "totalUsers", "bounceRate"]
 * @param {string} opts.startDate - e.g. "7daysAgo", "30daysAgo", "2024-01-01"
 * @param {string} opts.endDate - e.g. "today", "yesterday", "2024-01-31"
 * @param {number} [opts.limit=25] - Row limit
 * @param {string} [opts.orderBy] - Metric or dimension to sort by
 * @param {string} [opts.orderDirection="desc"] - "asc" or "desc"
 * @param {object[]} [opts.dimensionFilter] - Optional filters
 * @returns {object} { headers, rows, rowCount, metadata }
 */
async function runGA4Report(opts) {
  const client = createGA4Client(opts.serviceAccountJson);

  const request = {
    property: `properties/${opts.propertyId}`,
    dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
    dimensions: (opts.dimensions || []).map((d) => ({ name: d })),
    metrics: (opts.metrics || []).map((m) => ({ name: m })),
    limit: opts.limit || 25,
  };

  // Ordering
  if (opts.orderBy) {
    const isMetric = (opts.metrics || []).includes(opts.orderBy);
    request.orderBys = [
      {
        ...(isMetric
          ? { metric: { metricName: opts.orderBy } }
          : { dimension: { dimensionName: opts.orderBy } }),
        desc: (opts.orderDirection || "desc") === "desc",
      },
    ];
  }

  // Dimension filters
  if (opts.dimensionFilter) {
    request.dimensionFilter = buildDimensionFilter(opts.dimensionFilter);
  }

  const [response] = await client.runReport(request);

  // Format into clean JSON
  const headers = [
    ...(response.dimensionHeaders || []).map((h) => ({ name: h.name, type: "dimension" })),
    ...(response.metricHeaders || []).map((h) => ({ name: h.name, type: h.type })),
  ];

  const rows = (response.rows || []).map((row) => {
    const obj = {};
    (row.dimensionValues || []).forEach((v, i) => {
      obj[response.dimensionHeaders[i].name] = v.value;
    });
    (row.metricValues || []).forEach((v, i) => {
      obj[response.metricHeaders[i].name] = v.value;
    });
    return obj;
  });

  return {
    headers,
    rows,
    rowCount: parseInt(response.rowCount || "0"),
    metadata: {
      propertyId: opts.propertyId,
      dateRange: `${opts.startDate} to ${opts.endDate}`,
    },
  };
}

function buildDimensionFilter(filters) {
  if (!filters || filters.length === 0) return undefined;
  if (filters.length === 1) {
    return { filter: makeSingleFilter(filters[0]) };
  }
  return {
    andGroup: {
      expressions: filters.map((f) => ({ filter: makeSingleFilter(f) })),
    },
  };
}

function makeSingleFilter(f) {
  const filter = { fieldName: f.dimension };
  if (f.matchType === "contains") {
    filter.stringFilter = { matchType: "CONTAINS", value: f.value, caseSensitive: false };
  } else if (f.matchType === "exact") {
    filter.stringFilter = { matchType: "EXACT", value: f.value, caseSensitive: false };
  } else if (f.matchType === "regex") {
    filter.stringFilter = { matchType: "FULL_REGEXP", value: f.value, caseSensitive: false };
  } else if (f.matchType === "beginsWith") {
    filter.stringFilter = { matchType: "BEGINS_WITH", value: f.value, caseSensitive: false };
  } else {
    filter.stringFilter = { matchType: "CONTAINS", value: f.value, caseSensitive: false };
  }
  return filter;
}

// Common GA4 dimension/metric names for reference
const GA4_DIMENSIONS = [
  "date", "landingPage", "pagePath", "pageTitle", "sessionSource",
  "sessionMedium", "sessionCampaignName", "sessionDefaultChannelGroup",
  "country", "city", "deviceCategory", "browser", "operatingSystem",
  "newVsReturning", "firstUserSource", "firstUserMedium",
];

const GA4_METRICS = [
  "sessions", "totalUsers", "newUsers", "activeUsers",
  "screenPageViews", "engagedSessions", "engagementRate", "bounceRate",
  "averageSessionDuration", "sessionsPerUser", "eventCount",
  "conversions", "totalRevenue", "ecommercePurchases",
];

module.exports = { runGA4Report, GA4_DIMENSIONS, GA4_METRICS };
