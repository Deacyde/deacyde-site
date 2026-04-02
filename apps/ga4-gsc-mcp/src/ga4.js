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

  // Dimension filters - supports both simple array and native GA4 format
  if (opts.dimensionFilter) {
    request.dimensionFilter = normalizeDimensionFilter(opts.dimensionFilter);
  }

  // Metric filters - native GA4 FilterExpression format
  if (opts.metricFilter) {
    request.metricFilter = opts.metricFilter;
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

/**
 * Run a GA4 realtime report.
 * @param {object} opts
 * @param {string} opts.serviceAccountJson
 * @param {string} opts.propertyId
 * @param {string[]} opts.dimensions - Realtime dimensions
 * @param {string[]} opts.metrics - Realtime metrics
 * @param {number} [opts.limit=25]
 * @param {object} [opts.dimensionFilter] - FilterExpression
 * @param {object} [opts.metricFilter] - FilterExpression
 * @returns {object} { headers, rows, rowCount, metadata }
 */
async function runRealtimeReport(opts) {
  const client = createGA4Client(opts.serviceAccountJson);

  const request = {
    property: `properties/${opts.propertyId}`,
    dimensions: (opts.dimensions || []).map((d) => ({ name: d })),
    metrics: (opts.metrics || []).map((m) => ({ name: m })),
    limit: opts.limit || 25,
  };

  if (opts.dimensionFilter) {
    request.dimensionFilter = normalizeDimensionFilter(opts.dimensionFilter);
  }
  if (opts.metricFilter) {
    request.metricFilter = opts.metricFilter;
  }

  const [response] = await client.runRealtimeReport(request);

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
    metadata: { propertyId: opts.propertyId, type: "realtime" },
  };
}

/**
 * Normalize dimension filter - accepts both simple array and native GA4 format.
 * Simple format: [{ dimension: "country", matchType: "exact", value: "US" }]
 * Native format: { filter: {...} } or { andGroup: {...} } or { orGroup: {...} } or { notExpression: {...} }
 */
function normalizeDimensionFilter(filter) {
  if (Array.isArray(filter)) {
    return buildDimensionFilterFromArray(filter);
  }
  return filter;
}

function buildDimensionFilterFromArray(filters) {
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
  const matchMap = {
    contains: "CONTAINS",
    exact: "EXACT",
    regex: "FULL_REGEXP",
    beginsWith: "BEGINS_WITH",
    endsWith: "ENDS_WITH",
    partial_regexp: "PARTIAL_REGEXP",
  };
  filter.stringFilter = {
    matchType: matchMap[f.matchType] || "CONTAINS",
    value: f.value,
    caseSensitive: f.caseSensitive || false,
  };
  return filter;
}

// ── Comprehensive dimension/metric lists ──

const GA4_DIMENSIONS = [
  // Traffic source
  "sessionSource", "sessionMedium", "sessionSourceMedium", "sessionCampaignName",
  "sessionDefaultChannelGroup", "firstUserSource", "firstUserMedium",
  "firstUserSourceMedium", "firstUserCampaignName", "firstUserDefaultChannelGroup",
  // Content
  "pagePath", "pageTitle", "landingPage", "landingPagePlusQueryString",
  "pageReferrer", "contentGroup",
  // User / Geo
  "country", "city", "region", "continent", "language",
  "deviceCategory", "browser", "operatingSystem", "platform", "newVsReturning",
  // Time
  "date", "dateHour", "dayOfWeek", "dayOfWeekName", "hour",
  "isoWeek", "month", "week", "year",
  // Event
  "eventName", "isConversionEvent",
  // Ecommerce
  "itemName", "itemCategory", "itemBrand", "transactionId",
];

const GA4_METRICS = [
  // Sessions
  "sessions", "engagedSessions", "engagementRate", "bounceRate",
  "averageSessionDuration", "sessionsPerUser",
  // Users
  "totalUsers", "newUsers", "activeUsers", "dauPerMau", "dauPerWau", "wauPerMau",
  // Pages
  "screenPageViews", "screenPageViewsPerSession", "screenPageViewsPerUser",
  // Events
  "eventCount", "eventCountPerUser", "eventsPerSession",
  // Conversions
  "conversions", "userConversionRate", "sessionConversionRate",
  // Revenue
  "totalRevenue", "purchaseRevenue", "ecommercePurchases",
  "averageRevenuePerUser", "averagePurchaseRevenuePerUser",
];

const REALTIME_DIMENSIONS = [
  "appVersion", "audienceId", "audienceName", "audienceResourceName",
  "city", "cityId", "country", "countryId", "deviceCategory",
  "eventName", "minutesAgo", "platform", "streamId", "streamName",
  "unifiedScreenName",
];

const REALTIME_METRICS = [
  "activeUsers", "eventCount", "keyEvents", "screenPageViews",
];

module.exports = {
  runGA4Report, runRealtimeReport,
  GA4_DIMENSIONS, GA4_METRICS,
  REALTIME_DIMENSIONS, REALTIME_METRICS,
};
