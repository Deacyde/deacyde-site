/**
 * LLM integration with function calling for GA4 + GSC.
 * Supports OpenAI and Anthropic APIs.
 */

const db = require("./db");
const { runGA4Report, GA4_DIMENSIONS, GA4_METRICS } = require("./ga4");
const { queryGSC, inspectUrl, resolveDate, GSC_DIMENSIONS } = require("./gsc");

// ── Tool Definitions (shared format, converted per provider) ──

const TOOLS = [
  {
    name: "query_ga4",
    description:
      "Query Google Analytics 4 data. Use this to get website traffic, user behavior, landing page performance, source/medium breakdowns, conversions, and more. Always specify relevant dimensions and metrics for the user's question.",
    parameters: {
      type: "object",
      properties: {
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: `GA4 dimensions to group by. Common: ${GA4_DIMENSIONS.join(", ")}`,
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: `GA4 metrics to retrieve. Common: ${GA4_METRICS.join(", ")}`,
        },
        startDate: {
          type: "string",
          description: 'Start date. Use "7daysAgo", "30daysAgo", "90daysAgo", or "YYYY-MM-DD"',
        },
        endDate: {
          type: "string",
          description: 'End date. Use "today", "yesterday", or "YYYY-MM-DD"',
        },
        limit: {
          type: "number",
          description: "Max rows to return (default 25, max 100)",
        },
        orderBy: {
          type: "string",
          description: "Metric or dimension name to sort by",
        },
        orderDirection: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort direction (default desc)",
        },
        dimensionFilter: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dimension: { type: "string" },
              matchType: { type: "string", enum: ["contains", "exact", "regex", "beginsWith"] },
              value: { type: "string" },
            },
            required: ["dimension", "matchType", "value"],
          },
          description: "Optional dimension filters",
        },
      },
      required: ["dimensions", "metrics", "startDate", "endDate"],
    },
  },
  {
    name: "query_gsc",
    description:
      "Query Google Search Console data. Use this to get search queries, page performance in Google Search, clicks, impressions, CTR, and average position. Data is typically available with a 2-3 day delay.",
    parameters: {
      type: "object",
      properties: {
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: `GSC dimensions. Options: ${GSC_DIMENSIONS.join(", ")}`,
        },
        startDate: {
          type: "string",
          description: 'Start date. Use "7daysAgo", "28daysAgo", or "YYYY-MM-DD"',
        },
        endDate: {
          type: "string",
          description: 'End date. Use "today", "3daysAgo", or "YYYY-MM-DD"',
        },
        type: {
          type: "string",
          enum: ["web", "image", "video", "news", "discover", "googleNews"],
          description: "Search type (default: web)",
        },
        rowLimit: {
          type: "number",
          description: "Max rows (default 25, max 25000)",
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
          description: "Optional filters for GSC queries",
        },
      },
      required: ["dimensions", "startDate", "endDate"],
    },
  },
  {
    name: "inspect_url",
    description:
      "Inspect a specific URL in Google Search Console. Returns index status, crawl info, mobile usability, and rich results. Use when asked about a specific page's indexing status.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to inspect (e.g. https://www.example.com/page)",
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

  // Cap row limits to prevent massive responses
  if (args.rowLimit) args.rowLimit = Math.min(args.rowLimit, 50);
  if (args.limit) args.limit = Math.min(args.limit, 50);

  let result;
  switch (toolName) {
    case "query_ga4": {
      if (!ga4_property_id) return { error: "GA4 property ID not configured for this client" };
      result = await runGA4Report({
        serviceAccountJson: service_account_json,
        propertyId: ga4_property_id,
        ...args,
        startDate: resolveDate(args.startDate),
        endDate: resolveDate(args.endDate),
      });
      break;
    }
    case "query_gsc": {
      if (!gsc_site_url) return { error: "GSC site URL not configured for this client" };
      result = await queryGSC({
        serviceAccountJson: service_account_json,
        siteUrl: gsc_site_url,
        ...args,
        startDate: resolveDate(args.startDate),
        endDate: resolveDate(args.endDate),
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

async function chatOpenAI(apiKey, messages, clientConfig) {
  const OpenAI = require("openai");
  const openai = new OpenAI({ apiKey });

  const systemMsg = {
    role: "system",
    content: `You are an SEO analytics assistant. Today's date is ${new Date().toISOString().split("T")[0]}. You help users understand their Google Analytics 4 and Google Search Console data. When asked a question, use the available tools to query the data, then provide a clear, actionable summary. Format numbers nicely (commas, percentages). When showing tabular data, structure it clearly. Use the current year for relative date references like "year to date", "this year", "this month", etc. IMPORTANT: When the user asks for data above or below a threshold (e.g. "over 10,000 clicks"), you MUST filter the results to only include rows that match that criteria. If no rows match, say so clearly — do NOT show rows that don't meet the threshold. The current client is "${clientConfig.name}" with GA4 property ${clientConfig.ga4_property_id || "not configured"} and GSC site ${clientConfig.gsc_site_url || "not configured"}.`,
  };

  let conversation = [systemMsg, ...messages];
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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
        content: choice.message.content,
        toolCalls: extractToolCallsFromConversation(conversation),
      };
    }
  }

  return { content: "I made several data queries but couldn't complete the analysis. Please try a simpler question.", toolCalls: [] };
}

// ── Chat with Anthropic ──

async function chatAnthropic(apiKey, messages, clientConfig) {
  const Anthropic = require("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `You are an SEO analytics assistant. Today's date is ${new Date().toISOString().split("T")[0]}. You help users understand their Google Analytics 4 and Google Search Console data. When asked a question, use the available tools to query the data, then provide a clear, actionable summary. Format numbers nicely (commas, percentages). When showing tabular data, structure it clearly. Use the current year for relative date references like "year to date", "this year", "this month", etc. IMPORTANT: When the user asks for data above or below a threshold (e.g. "over 10,000 clicks"), you MUST filter the results to only include rows that match that criteria. If no rows match, say so clearly — do NOT show rows that don't meet the threshold. The current client is "${clientConfig.name}" with GA4 property ${clientConfig.ga4_property_id || "not configured"} and GSC site ${clientConfig.gsc_site_url || "not configured"}.`;

  // Convert messages to Anthropic format
  const anthropicMessages = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const MAX_ITERATIONS = 5;
  let currentMessages = [...anthropicMessages];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
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
        content: textContent ? textContent.text : "No response generated.",
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

// ── Main chat function ──

async function chat(messages, clientConfig) {
  const provider = db.getSetting("active_llm_provider") || "openai";

  if (provider === "openai") {
    const apiKey = db.getEncryptedSetting("openai_api_key");
    if (!apiKey) throw new Error("OpenAI API key not configured. Go to Settings.");
    return await chatOpenAI(apiKey, messages, clientConfig);
  } else if (provider === "anthropic") {
    const apiKey = db.getEncryptedSetting("anthropic_api_key");
    if (!apiKey) throw new Error("Anthropic API key not configured. Go to Settings.");
    return await chatAnthropic(apiKey, messages, clientConfig);
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

module.exports = { chat, TOOLS };
