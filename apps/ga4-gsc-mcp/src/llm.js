/**
 * LLM integration with function calling for GA4 + GSC.
 * Supports OpenAI and Anthropic APIs.
 */

const db = require("./db");
const { runGA4Report, runRealtimeReport, GA4_DIMENSIONS, GA4_METRICS, REALTIME_DIMENSIONS, REALTIME_METRICS } = require("./ga4");
const { queryGSC, inspectUrl, resolveDate, GSC_DIMENSIONS } = require("./gsc");

// ── Tool Definitions (shared format, converted per provider) ──

const TOOLS = [
  {
    name: "query_ga4",
    description: `Query Google Analytics 4 data. Returns website traffic, user behavior, landing page performance, source/medium breakdowns, conversions, and more.

## Dimensions (group by)
Choose dimensions relevant to the question. Organized by category:
- **Traffic source**: sessionSource, sessionMedium, sessionSourceMedium, sessionCampaignName, sessionDefaultChannelGroup, firstUserSource, firstUserMedium, firstUserSourceMedium, firstUserCampaignName, firstUserDefaultChannelGroup
- **Content**: pagePath, pageTitle, landingPage, landingPagePlusQueryString, pageReferrer, contentGroup
- **User/Geo**: country, city, region, continent, language, deviceCategory, browser, operatingSystem, platform, newVsReturning
- **Time**: date, dateHour, dayOfWeek, dayOfWeekName, hour, isoWeek, month, week, year
- **Event**: eventName, isConversionEvent
- **Ecommerce**: itemName, itemCategory, itemBrand, transactionId
Full reference: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#dimensions

## Metrics
Choose metrics relevant to the question:
- **Sessions**: sessions, engagedSessions, engagementRate, bounceRate, averageSessionDuration, sessionsPerUser
- **Users**: totalUsers, newUsers, activeUsers, dauPerMau, dauPerWau, wauPerMau
- **Pages**: screenPageViews, screenPageViewsPerSession, screenPageViewsPerUser
- **Events**: eventCount, eventCountPerUser, eventsPerSession
- **Conversions**: conversions, userConversionRate, sessionConversionRate
- **Revenue**: totalRevenue, purchaseRevenue, ecommercePurchases, averageRevenuePerUser, averagePurchaseRevenuePerUser
Full reference: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema#metrics

## Date Ranges
- Relative: "today", "yesterday", "7daysAgo", "30daysAgo", "90daysAgo", "365daysAgo", or "NdaysAgo"
- Absolute: "YYYY-MM-DD" format
- For YTD: startDate "2026-01-01", endDate "today"
- For specific month: startDate "2026-03-01", endDate "2026-03-31"

## Dimension Filter Examples
**Simple format** (array, combined with AND logic):
Single filter: [{"dimension": "country", "matchType": "exact", "value": "United States"}]
Multiple AND: [{"dimension": "pagePath", "matchType": "contains", "value": "/blog"}, {"dimension": "deviceCategory", "matchType": "exact", "value": "mobile"}]
matchType options: "exact", "contains", "beginsWith", "endsWith", "regex"

**Advanced format** (native GA4 FilterExpression, use for OR/NOT/complex queries):
OR group: {"orGroup": {"expressions": [{"filter": {"fieldName": "country", "stringFilter": {"matchType": "EXACT", "value": "United States"}}}, {"filter": {"fieldName": "country", "stringFilter": {"matchType": "EXACT", "value": "Canada"}}}]}}
NOT filter: {"notExpression": {"filter": {"fieldName": "pagePath", "stringFilter": {"matchType": "CONTAINS", "value": "/admin"}}}}
IN list: {"filter": {"fieldName": "eventName", "inListFilter": {"values": ["page_view", "scroll", "click"]}}}

## Metric Filter Examples
Use metricFilter (separate parameter from dimensionFilter) to filter rows by metric values.
Greater than: {"filter": {"fieldName": "sessions", "numericFilter": {"operation": "GREATER_THAN", "value": {"int64Value": "100"}}}}
Between: {"filter": {"fieldName": "bounceRate", "betweenFilter": {"fromValue": {"doubleValue": 0.5}, "toValue": {"doubleValue": 0.9}}}}
Operations: EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL, GREATER_THAN, GREATER_THAN_OR_EQUAL
AND group: {"andGroup": {"expressions": [{"filter": {"fieldName": "sessions", "numericFilter": {"operation": "GREATER_THAN", "value": {"int64Value": "50"}}}}, {"filter": {"fieldName": "bounceRate", "numericFilter": {"operation": "LESS_THAN", "value": {"doubleValue": 0.7}}}}]}}

## Order By
Set orderBy to any metric or dimension name included in your query. Default direction is "desc".`,
    parameters: {
      type: "object",
      properties: {
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "GA4 dimensions to group by. See dimension categories in tool description.",
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "GA4 metrics to retrieve. See metric categories in tool description.",
        },
        startDate: {
          type: "string",
          description: 'Start date. Relative: "7daysAgo", "30daysAgo", "NdaysAgo". Absolute: "YYYY-MM-DD".',
        },
        endDate: {
          type: "string",
          description: 'End date. Use "today", "yesterday", or "YYYY-MM-DD".',
        },
        limit: {
          type: "number",
          description: "Max rows to return (default 25, max 100).",
        },
        orderBy: {
          type: "string",
          description: "Metric or dimension name to sort by. Must be included in dimensions or metrics.",
        },
        orderDirection: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort direction (default desc).",
        },
        dimensionFilter: {
          description: 'Dimension filters. Simple format: array of {"dimension","matchType","value"} objects (AND logic). Advanced format: native GA4 FilterExpression object supporting andGroup, orGroup, notExpression, inListFilter. See examples in tool description.',
        },
        metricFilter: {
          description: 'Metric filters (separate from dimensionFilter). Native GA4 FilterExpression with numericFilter or betweenFilter. Use to filter rows by metric thresholds. See examples in tool description.',
        },
      },
      required: ["dimensions", "metrics", "startDate", "endDate"],
    },
  },
  {
    name: "query_ga4_realtime",
    description: `Query GA4 realtime data. Returns what's happening on the site RIGHT NOW — active users, current pages, events in the last 30 minutes.

## Realtime Dimensions (ONLY use these, never use regular GA4 dimensions)
appVersion, audienceId, audienceName, city, cityId, country, countryId, deviceCategory, eventName, minutesAgo, platform, streamId, streamName, unifiedScreenName

## Realtime Metrics (ONLY use these 4, never use regular GA4 metrics)
activeUsers, eventCount, keyEvents, screenPageViews

**IMPORTANT**: Do NOT use regular GA4 dimensions or metrics like "sessions", "totalUsers", "bounceRate", "landingPage", "sessionSource", "conversions" etc. Those will cause errors. ONLY use the dimensions and metrics listed above.

All dimension+metric combos above are compatible with each other. You can combine multiple dimensions and metrics freely.

Note: Realtime reports do NOT use date ranges. They always return data from the last 30 minutes.
Use "minutesAgo" dimension to see activity broken down by minute (0 = current minute, 29 = 30 minutes ago).

## Example Queries
- Event counts by event name: dimensions ["eventName"], metrics ["eventCount"]
- Active users by device: dimensions ["deviceCategory"], metrics ["activeUsers"]
- What pages are being viewed: dimensions ["unifiedScreenName"], metrics ["screenPageViews"]
- Activity by minute: dimensions ["minutesAgo"], metrics ["activeUsers", "eventCount"]
- Users by country right now: dimensions ["country"], metrics ["activeUsers"]
- Events by name and device: dimensions ["eventName", "deviceCategory"], metrics ["eventCount", "activeUsers"]`,
    parameters: {
      type: "object",
      properties: {
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "ONLY realtime dimensions: appVersion, audienceId, audienceName, city, cityId, country, countryId, deviceCategory, eventName, minutesAgo, platform, streamId, streamName, unifiedScreenName.",
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: "ONLY realtime metrics: activeUsers, eventCount, keyEvents, screenPageViews. Do NOT use conversions, sessions, totalUsers, or any other regular GA4 metric.",
        },
        limit: {
          type: "number",
          description: "Max rows to return (default 25).",
        },
        dimensionFilter: {
          description: "Optional dimension filter. Same format as query_ga4 dimensionFilter.",
        },
        metricFilter: {
          description: "Optional metric filter. Same format as query_ga4 metricFilter.",
        },
      },
      required: ["dimensions", "metrics"],
    },
  },
  {
    name: "query_gsc",
    description: `Query Google Search Console data. Returns how the site performs in Google Search — which queries bring traffic, which pages rank, clicks, impressions, CTR, and average position.

**Important**: GSC data has a 2-3 day delay. The most recent complete data is typically 3 days ago.

## Dimensions
- **query**: Search terms users typed in Google
- **page**: URL of the page that appeared in results
- **country**: Country of the searcher (ISO 3166-1 alpha-3, e.g. "USA", "GBR", "DEU")
- **device**: Device type: "DESKTOP", "MOBILE", "TABLET"
- **date**: Date of the search
- **searchAppearance**: How the result appeared (e.g. "RICH_RESULT", "AMP_BLUE_LINK")

## Metrics (always returned, cannot be filtered at API level)
- **clicks**: Number of clicks from search results
- **impressions**: Number of times the page appeared in results
- **ctr**: Click-through rate (clicks / impressions)
- **position**: Average ranking position in search results (1 = top)

**CRITICAL**: GSC does NOT support filtering by metric values (clicks, impressions, CTR, position). Filters only work on dimensions (query, page, country, device). To filter by metrics like "over 100 impressions", you MUST: set a high rowLimit (e.g. 1000), fetch all results, then filter the returned data yourself in your response. NEVER put "impressions", "clicks", "ctr", or "position" in dimensionFilterGroups.

## Date Ranges
- Relative: "7daysAgo", "28daysAgo", "90daysAgo", "NdaysAgo", "today", "3daysAgo"
- Absolute: "YYYY-MM-DD" format
- For reliable data, use endDate "3daysAgo" instead of "today"

## Filter Examples
Single filter: [{"filters": [{"dimension": "query", "operator": "contains", "expression": "seo"}]}]
Multiple AND: [{"filters": [{"dimension": "query", "operator": "contains", "expression": "seo"}, {"dimension": "country", "operator": "equals", "expression": "usa"}]}]
Exclude: [{"filters": [{"dimension": "query", "operator": "notContains", "expression": "brand name"}]}]
Regex: [{"filters": [{"dimension": "page", "operator": "includingRegex", "expression": "/blog/.*"}]}]
Operators: "contains", "equals", "notContains", "notEquals", "includingRegex", "excludingRegex"

## Search Types
- **web** (default): Standard web search results
- **image**: Google Images
- **video**: Google Video
- **news**: Google News
- **discover**: Google Discover feed
- **googleNews**: Google News app/tab`,
    parameters: {
      type: "object",
      properties: {
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "GSC dimensions: query, page, country, device, date, searchAppearance.",
        },
        startDate: {
          type: "string",
          description: 'Start date. Use "28daysAgo", "90daysAgo", "NdaysAgo", or "YYYY-MM-DD".',
        },
        endDate: {
          type: "string",
          description: 'End date. Use "3daysAgo" for reliable data, or "YYYY-MM-DD".',
        },
        type: {
          type: "string",
          enum: ["web", "image", "video", "news", "discover", "googleNews"],
          description: "Search type (default: web).",
        },
        rowLimit: {
          type: "number",
          description: "Max rows (default 25, max 25000).",
        },
        dimensionFilterGroups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    dimension: { type: "string" },
                    operator: { type: "string", enum: ["contains", "equals", "notContains", "notEquals", "includingRegex", "excludingRegex"] },
                    expression: { type: "string" },
                  },
                  required: ["dimension", "operator", "expression"],
                },
              },
            },
          },
          description: "Filter groups. See filter examples in tool description.",
        },
      },
      required: ["dimensions", "startDate", "endDate"],
    },
  },
  {
    name: "inspect_url",
    description: `Inspect a specific URL in Google Search Console. Returns detailed index status, crawl info, mobile usability, and rich results detection. Use when asked about a specific page's indexing status, crawlability, or search appearance.

Returns: indexStatus (PASS/FAIL/etc), coverageState, crawledAs (DESKTOP/MOBILE), lastCrawlTime, pageFetchState, robotsTxtState, mobileUsability, and detected rich result types.`,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to inspect (e.g. https://www.example.com/page). Must include protocol.",
        },
      },
      required: ["url"],
    },
  },
];

// ── Convert tools to provider format ──

function toolsForOpenAI() {
  return TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function toolsForAnthropic() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ── Execute a tool call ──

async function executeTool(toolName, args, clientConfig) {
  const { service_account_json, ga4_property_id, gsc_site_url } = clientConfig;

  console.log(`[tool] ${toolName}`, JSON.stringify(args).substring(0, 200));

  // Cap row limits to prevent massive responses
  if (args.rowLimit) args.rowLimit = Math.min(args.rowLimit, 500);
  if (args.limit) args.limit = Math.min(args.limit, 250);

  // Resolve and validate dates — swap if LLM put them in wrong order
  if (args.startDate && args.endDate) {
    let start = resolveDate(args.startDate);
    let end = resolveDate(args.endDate);
    if (start > end) {
      console.log(`[date-fix] Swapping reversed dates: ${start} > ${end}`);
      [start, end] = [end, start];
    }
    args.startDate = start;
    args.endDate = end;
  }

  let result;
  switch (toolName) {
    case "query_ga4": {
      if (!ga4_property_id) return { error: "GA4 property ID not configured for this client" };
      result = await runGA4Report({
        serviceAccountJson: service_account_json,
        propertyId: ga4_property_id,
        ...args,
      });
      break;
    }
    case "query_ga4_realtime": {
      if (!ga4_property_id) return { error: "GA4 property ID not configured for this client" };
      console.log("[realtime] dims:", args.dimensions, "metrics:", args.metrics);
      try {
        result = await runRealtimeReport({
          serviceAccountJson: service_account_json,
          propertyId: ga4_property_id,
          ...args,
        });
      } catch (err) {
        if (err.code === 3 || (err.message && err.message.includes("cannot be queried together"))) {
          // Retry with each dimension individually and merge results
          console.log("[realtime] Combo failed, trying dimensions individually");
          const allRows = [];
          for (const dim of args.dimensions) {
            for (const met of args.metrics) {
              try {
                const partial = await runRealtimeReport({
                  serviceAccountJson: service_account_json,
                  propertyId: ga4_property_id,
                  dimensions: [dim],
                  metrics: [met],
                  limit: args.limit,
                });
                partial.rows.forEach((r) => { r._query = `${dim} × ${met}`; });
                allRows.push(...partial.rows);
              } catch (e2) {
                console.log(`[realtime] ${dim}+${met} also failed:`, e2.message);
              }
            }
          }
          if (allRows.length > 0) {
            result = { rows: allRows, rowCount: allRows.length, metadata: { type: "realtime", note: "Some dimension+metric combos are incompatible; showing available results." } };
          } else {
            return { error: "Realtime query failed: the requested dimensions and metrics cannot be queried together. Try simpler combos like eventName+eventCount or deviceCategory+activeUsers." };
          }
        } else {
          throw err;
        }
      }
      break;
    }
    case "query_gsc": {
      if (!gsc_site_url) return { error: "GSC site URL not configured for this client" };
      result = await queryGSC({
        serviceAccountJson: service_account_json,
        siteUrl: gsc_site_url,
        ...args,
      });
      break;
    }
    case "inspect_url": {
      if (!gsc_site_url) return { error: "GSC site URL not configured for this client" };
      return await inspectUrl({
        serviceAccountJson: service_account_json,
        siteUrl: gsc_site_url,
        inspectionUrl: args.url,
      });
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }

  // Truncate massive results to stay within token limits
  const resultStr = JSON.stringify(result);
  if (resultStr.length > 15000) {
    const truncated = result.rows ? { ...result, rows: result.rows.slice(0, 25), rowCount: result.rows.length, note: `Showing top 25 of ${result.rows.length} rows` } : result;
    return truncated;
  }
  return result;
}

// ── Chat with OpenAI ──

async function chatOpenAI(apiKey, messages, clientConfig, model) {
  const OpenAI = require("openai");
  const openai = new OpenAI({ apiKey });
  const useModel = model || "gpt-4o-mini";

  const systemMsg = {
    role: "system",
    content: `You are an expert SEO analytics assistant. Today's date is ${new Date().toISOString().split("T")[0]}.

You help users understand their Google Analytics 4 and Google Search Console data. When asked a question:
1. Use the available tools to query the data with the most relevant dimensions and metrics
2. Provide a clear, actionable summary of the results
3. Format numbers nicely (commas for thousands, percentages with 1-2 decimal places)
4. When showing tabular data, structure it clearly with aligned columns
5. Use the current year for relative date references like "year to date", "this year", "this month"
6. NEVER use markdown formatting in your responses. No bold (**), no italic (*), no markdown links [text](url), no headers (#). Use plain text only. URLs should be displayed as-is: https://example.com/page

IMPORTANT RULES:

WHEN TO USE EACH TOOL:
- query_ga4 (DEFAULT): page views, sessions, users, landing pages, traffic by country/device/source, bounce rate, engagement, conversions, revenue, URLs with /path/ patterns, "pages and screens" data, anything about site visitor behavior. THIS IS THE DEFAULT -- use it unless the question is specifically about Google Search rankings.
- query_gsc: ONLY for Google Search performance -- search queries/keywords people typed, impressions in search results, search clicks, CTR, average ranking position. Only use when asking about how the site appears in Google Search.
- query_ga4_realtime: what is happening RIGHT NOW, current active users, live events.
- inspect_url: checking if a specific URL is indexed by Google.

- When the user asks about "URLs", "pages", "page views", traffic from a country, or content performance, ALWAYS use query_ga4 with pagePath dimension, NOT query_gsc. GA4 has data available within hours; GSC has a 2-3 day delay.
- When the user mentions "clicks" they usually mean GSC search clicks. GA4 does NOT have a "clicks" metric -- use "sessions" or "screenPageViews" for GA4 traffic volume.
- When the user asks for data above or below a threshold (e.g. "over 10,000 clicks"), you MUST use metricFilter to filter at the API level, or filter the returned results. Only show rows matching the criteria. If no rows match, say so clearly.
- When the user asks about what is happening "right now" or "currently", use query_ga4_realtime instead of query_ga4.
- When querying GSC data, use endDate "3daysAgo" for reliable data unless the user specifies otherwise.
- GSC does NOT support metric filtering. NEVER put clicks, impressions, ctr, or position in GSC dimensionFilterGroups. Instead, set a high rowLimit (e.g. 500) and filter the returned results yourself before presenting to the user.
- For dimension filters with OR logic (e.g. "from US or Canada"), use the advanced orGroup format.
- Always pick the most specific dimensions for the question. E.g. "top landing pages" = landingPage dimension, "traffic sources" = sessionSourceMedium dimension.

MULTI-STEP QUERIES: For complex questions that involve comparisons or multiple breakdowns (e.g. "which countries improved AND what URLs"), break it into separate queries:
1. First query with fewer dimensions to get the overview (e.g. just country totals)
2. Then follow-up queries with more dimensions for the detail (e.g. country+page for top countries)
This avoids row limits cutting off important data. Use rowLimit 500 for GSC queries with multiple dimensions.

GEOGRAPHIC FILTERING: When the user mentions ANY country, nationality, city, or region (e.g. "from Germany", "German", "French", "US", "UK", "Japan", "New York", "European"), ALWAYS filter by the geo dimension (country, city, region), NEVER by URL path. Examples: "German" = country filter "Germany". "French" = country filter "France". "US" = country filter "United States". Only use URL path filters when the user explicitly says a path like "/de/", "/fr/", or "/en/".

ROW LIMITS: Default to 25 rows. Use 50-100 only when the user says "all", "every", "complete list", or "export". Tell the user the total count and offer to fetch more if the data was truncated. This saves API costs.

The current client is "${clientConfig.name}" with GA4 property ${clientConfig.ga4_property_id || "not configured"} and GSC site ${clientConfig.gsc_site_url || "not configured"}.`,
  };

  let conversation = [systemMsg, ...messages];
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: useModel,
      messages: conversation,
      tools: toolsForOpenAI(),
      tool_choice: "auto",
    });

    const choice = response.choices[0];

    if (choice.finish_reason === "tool_calls" || choice.message.tool_calls) {
      conversation.push(choice.message);

      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args, clientConfig);
        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    } else {
      return {
        content: stripMarkdown(choice.message.content),
        toolCalls: extractToolCallsFromConversation(conversation),
      };
    }
  }

  return { content: "I made several data queries but couldn't complete the analysis. Please try a simpler question.", toolCalls: [] };
}

// ── Chat with Anthropic ──

async function chatAnthropic(apiKey, messages, clientConfig, model) {
  const Anthropic = require("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey });
  const useModel = model || "claude-sonnet-4-20250514";

  const systemPrompt = `You are an expert SEO analytics assistant. Today's date is ${new Date().toISOString().split("T")[0]}.

You help users understand their Google Analytics 4 and Google Search Console data. When asked a question:
1. Use the available tools to query the data with the most relevant dimensions and metrics
2. Provide a clear, actionable summary of the results
3. Format numbers nicely (commas for thousands, percentages with 1-2 decimal places)
4. When showing tabular data, structure it clearly with aligned columns
5. Use the current year for relative date references like "year to date", "this year", "this month"
6. NEVER use markdown formatting in your responses. No bold (**), no italic (*), no markdown links [text](url), no headers (#). Use plain text only. URLs should be displayed as-is: https://example.com/page

IMPORTANT RULES:

WHEN TO USE EACH TOOL:
- query_ga4 (DEFAULT): page views, sessions, users, landing pages, traffic by country/device/source, bounce rate, engagement, conversions, revenue, URLs with /path/ patterns, "pages and screens" data, anything about site visitor behavior. THIS IS THE DEFAULT -- use it unless the question is specifically about Google Search rankings.
- query_gsc: ONLY for Google Search performance -- search queries/keywords people typed, impressions in search results, search clicks, CTR, average ranking position. Only use when asking about how the site appears in Google Search.
- query_ga4_realtime: what is happening RIGHT NOW, current active users, live events.
- inspect_url: checking if a specific URL is indexed by Google.

- When the user asks about "URLs", "pages", "page views", traffic from a country, or content performance, ALWAYS use query_ga4 with pagePath dimension, NOT query_gsc. GA4 has data available within hours; GSC has a 2-3 day delay.
- If the question could benefit from BOTH GA4 and GSC data (e.g. "how are my German pages doing?"), query both -- use GA4 for page views/sessions and GSC for search impressions/clicks/rankings. Present both together.
- When the user mentions "clicks" they usually mean GSC search clicks. GA4 does NOT have a "clicks" metric -- use "sessions" or "screenPageViews" for GA4 traffic volume.
- When the user asks for data above or below a threshold (e.g. "over 10,000 clicks"), you MUST use metricFilter to filter at the API level, or filter the returned results. Only show rows matching the criteria. If no rows match, say so clearly.
- When the user asks about what is happening "right now" or "currently", use query_ga4_realtime instead of query_ga4.
- When querying GSC data, use endDate "3daysAgo" for reliable data unless the user specifies otherwise. GSC data from the last 2-3 days is incomplete.
- GSC does NOT support metric filtering. NEVER put clicks, impressions, ctr, or position in GSC dimensionFilterGroups. Instead, set a high rowLimit (e.g. 500) and filter the returned results yourself before presenting to the user.
- For dimension filters with OR logic (e.g. "from US or Canada"), use the advanced orGroup format.
- Always pick the most specific dimensions for the question. E.g. "top landing pages" = landingPage dimension, "traffic sources" = sessionSourceMedium dimension.

MULTI-STEP QUERIES: For complex questions that involve comparisons or multiple breakdowns (e.g. "which countries improved AND what URLs"), break it into separate queries:
1. First query with fewer dimensions to get the overview (e.g. just country totals)
2. Then follow-up queries with more dimensions for the detail (e.g. country+page for top countries)
This avoids row limits cutting off important data. Use rowLimit 500 for GSC queries with multiple dimensions.

GEOGRAPHIC FILTERING: When the user mentions ANY country, nationality, city, or region (e.g. "from Germany", "German", "French", "US", "UK", "Japan", "New York", "European"), ALWAYS filter by the geo dimension (country, city, region), NEVER by URL path. Examples: "German" = country filter "Germany". "French" = country filter "France". "US" = country filter "United States". Only use URL path filters when the user explicitly says a path like "/de/", "/fr/", or "/en/".

ROW LIMITS: Default to 25 rows. Use 50-100 only when the user says "all", "every", "complete list", or "export". Tell the user the total count and offer to fetch more if the data was truncated. This saves API costs.

The current client is "${clientConfig.name}" with GA4 property ${clientConfig.ga4_property_id || "not configured"} and GSC site ${clientConfig.gsc_site_url || "not configured"}.`;

  // Convert messages to Anthropic format
  const anthropicMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const MAX_ITERATIONS = 5;
  let currentMessages = [...anthropicMessages];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: useModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: currentMessages,
      tools: toolsForAnthropic(),
    });

    if (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      currentMessages.push({ role: "assistant", content: assistantContent });

      const toolResults = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          const result = await executeTool(block.name, block.input, clientConfig);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }
      currentMessages.push({ role: "user", content: toolResults });
    } else {
      const textContent = response.content.find((b) => b.type === "text");
      return {
        content: stripMarkdown(textContent ? textContent.text : "No response generated."),
        toolCalls: [],
      };
    }
  }

  return { content: "I made several data queries but couldn't complete the analysis. Please try a simpler question.", toolCalls: [] };
}

function extractToolCallsFromConversation(conversation) {
  const calls = [];
  for (const msg of conversation) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        calls.push({ name: tc.function.name, args: JSON.parse(tc.function.arguments) });
      }
    }
  }
  return calls;
}

// Strip markdown formatting from LLM responses
function stripMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')       // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')            // *italic* → italic
    .replace(/__(.+?)__/g, '$1')            // __bold__ → bold
    .replace(/_(.+?)_/g, '$1')              // _italic_ → italic
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2')  // [text](url) → url
    .replace(/^#{1,6}\s+/gm, '')            // # headers → plain text
    .replace(/`([^`]+)`/g, '$1');           // `code` → code
}

// ── Main chat function ──

async function chat(messages, clientConfig, model) {
  const provider = db.getSetting("active_llm_provider") || "openai";

  if (provider === "openai") {
    const apiKey = db.getEncryptedSetting("openai_api_key");
    if (!apiKey) throw new Error("OpenAI API key not configured. Go to Settings.");
    return await chatOpenAI(apiKey, messages, clientConfig, model);
  } else if (provider === "anthropic") {
    const apiKey = db.getEncryptedSetting("anthropic_api_key");
    if (!apiKey) throw new Error("Anthropic API key not configured. Go to Settings.");
    return await chatAnthropic(apiKey, messages, clientConfig, model);
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

module.exports = { chat, TOOLS };
