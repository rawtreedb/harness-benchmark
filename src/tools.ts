/**
 * Tools for the on-call incident triage agent.
 *
 * Mix of mock tools (getIncident, queryRecentErrors, getDeployments) that
 * return realistic data without network calls, and real HTTP tools
 * (fetchStatusPage, searchGitHub) that hit actual external services —
 * so the OTel span data shows a realistic mix of fast and slow tool calls.
 */

import { tool } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Mock tools — deterministic, fast, no external calls
// ---------------------------------------------------------------------------

export const getIncidentTool = tool({
  description: "Fetch details for an on-call incident by ID.",
  inputSchema: z.object({
    incidentId: z.string().describe("e.g. inc_checkout_latency_2026_06_14"),
  }),
  execute: async ({ incidentId }) => ({
    incidentId,
    severity: "warning",
    service: "checkout-api",
    startedAt: "2026-06-14T15:20:00Z",
    symptoms: [
      "p95 latency spiked from 180 ms to 740 ms",
      "error rate increased to 2.1%",
      "slow requests correlate with inventory reservation retries",
    ],
    tags: ["latency", "checkout", "inventory"],
  }),
});

export const queryRecentErrorsTool = tool({
  description:
    "Query the last N error log entries for a service in the past hour.",
  inputSchema: z.object({
    service: z.string().describe("Service name, e.g. checkout-api"),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  execute: async ({ service, limit }) => ({
    service,
    errors: Array.from({ length: Math.min(limit, 4) }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 180_000).toISOString(),
      level: "error",
      message:
        i % 2 === 0
          ? `InventoryClient.reserve timeout after 5000ms (attempt ${i + 1}/3)`
          : `RetryableError: upstream 503 from inventory-service`,
      traceId: `trace_${Math.random().toString(16).slice(2, 10)}`,
    })),
  }),
});

export const getRecentDeploymentsTool = tool({
  description: "Get the last 3 deployments of a service.",
  inputSchema: z.object({
    service: z.string().describe("Service name, e.g. checkout-api"),
  }),
  execute: async ({ service }) => ({
    service,
    deployments: [
      {
        version: "v2.14.1",
        deployedAt: "2026-06-14T14:55:00Z",
        author: "carlos",
        changes: ["increase inventory retry backoff to 2s", "add circuit breaker"],
      },
      {
        version: "v2.14.0",
        deployedAt: "2026-06-13T10:00:00Z",
        author: "ava",
        changes: ["new promo pricing endpoint", "dependency bumps"],
      },
      {
        version: "v2.13.9",
        deployedAt: "2026-06-10T09:30:00Z",
        author: "marcus",
        changes: ["fix order confirmation race condition"],
      },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Real HTTP tools — actual network calls, timestamps will vary
// ---------------------------------------------------------------------------

export const fetchStatusPageTool = tool({
  description:
    "Fetch the current status of a well-known public API or service to check for upstream incidents.",
  inputSchema: z.object({
    service: z
      .enum(["github", "npm", "vercel", "cloudflare"])
      .describe("Which service status page to check"),
  }),
  execute: async ({ service }) => {
    const urls: Record<string, string> = {
      github: "https://www.githubstatus.com/api/v2/status.json",
      npm: "https://status.npmjs.org/api/v2/status.json",
      vercel: "https://www.vercel-status.com/api/v2/status.json",
      cloudflare: "https://www.cloudflarestatus.com/api/v2/status.json",
    };
    const res = await fetch(urls[service]!, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { service, error: `HTTP ${res.status}` };
    const data = (await res.json()) as {
      status: { indicator: string; description: string };
      page: { name: string };
    };
    return {
      service,
      indicator: data.status.indicator,
      description: data.status.description,
      page: data.page.name,
    };
  },
});

export const searchGitHubIssuesTool = tool({
  description:
    "Search GitHub issues/PRs for recent reports related to the incident (e.g. a dependency bug).",
  inputSchema: z.object({
    query: z.string().describe("Search terms, e.g. 'axios timeout inventory retry'"),
    limit: z.number().int().min(1).max(5).default(3),
  }),
  execute: async ({ query, limit }) => {
    const q = encodeURIComponent(query);
    const res = await fetch(
      `https://api.github.com/search/issues?q=${q}&sort=updated&per_page=${limit}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "harness-bench/0.1",
        },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!res.ok) return { error: `GitHub API ${res.status}`, query };
    type Issue = { title: string; html_url: string; state: string; updated_at: string; repository_url: string };
    const data = (await res.json()) as { items: Issue[] };
    return {
      query,
      results: data.items.map((i) => ({
        title: i.title,
        url: i.html_url,
        state: i.state,
        updatedAt: i.updated_at,
        repo: i.repository_url.replace("https://api.github.com/repos/", ""),
      })),
    };
  },
});

export const tools = {
  get_incident: getIncidentTool,
  query_recent_errors: queryRecentErrorsTool,
  get_recent_deployments: getRecentDeploymentsTool,
  fetch_status_page: fetchStatusPageTool,
  search_github_issues: searchGitHubIssuesTool,
};

// ---------------------------------------------------------------------------
// Cost spike tools
// ---------------------------------------------------------------------------

export const getBillingAlertTool = tool({
  description: "Fetch the billing alert that triggered this investigation.",
  inputSchema: z.object({
    alertId: z.string().describe("e.g. alert_cost_spike_2026_06_15"),
  }),
  execute: async ({ alertId }) => ({
    alertId,
    triggeredAt: "2026-06-15T08:00:00Z",
    threshold: "30% day-over-day increase",
    actual: "61% increase",
    period: "2026-06-14T00:00:00Z / 2026-06-14T23:59:59Z",
    totalSpend: { yesterday: 4820, dayBefore: 2990, currency: "USD" },
    topLineMessage: "Yesterday's cloud spend was $4,820 — $1,830 above the 30% alert threshold.",
  }),
});

export const listServiceCostsTool = tool({
  description: "Break down yesterday's cloud spend by service.",
  inputSchema: z.object({ date: z.string().describe("ISO date, e.g. 2026-06-14") }),
  execute: async ({ date }) => ({
    date,
    services: [
      { service: "ml-inference", spend: 2940, prevDaySpend: 310, change: "+848%" },
      { service: "api-gateway", spend: 610, prevDaySpend: 590, change: "+3%" },
      { service: "data-warehouse", spend: 820, prevDaySpend: 790, change: "+4%" },
      { service: "cdn", spend: 450, prevDaySpend: 440, change: "+2%" },
    ],
  }),
});

export const getComputeResourcesTool = tool({
  description: "List running compute instances for a service.",
  inputSchema: z.object({ service: z.string() }),
  execute: async ({ service }) => ({
    service,
    instances: service === "ml-inference"
      ? Array.from({ length: 48 }, (_, i) => ({
          id: `gpu-${i.toString().padStart(3, "0")}`,
          type: "a100-80gb",
          state: "running",
          launchedAt: "2026-06-13T18:02:00Z",
          utilizationPct: i < 4 ? 72 : 0,
          costPerHourUSD: 3.67,
        }))
      : [],
    note:
      service === "ml-inference"
        ? "48 A100 instances launched Friday evening. 44 are idle (0% utilization) — training job completed Saturday at 02:14 but instances were never terminated."
        : "No anomalous instances found.",
  }),
});

export const costSpikeTools = {
  get_billing_alert: getBillingAlertTool,
  list_service_costs: listServiceCostsTool,
  get_compute_resources: getComputeResourcesTool,
};

// ---------------------------------------------------------------------------
// Slow query tools
// ---------------------------------------------------------------------------

export const getSlowQueriesReport = tool({
  description: "Fetch the top slow queries from the database slow-query log.",
  inputSchema: z.object({
    since: z.string().describe("ISO timestamp, e.g. 2026-06-15T00:00:00Z"),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ since, limit }) => ({
    since,
    queries: [
      {
        queryId: "q_8f2a",
        avgDurationMs: 4200,
        callsPerMin: 18,
        query: "SELECT * FROM user_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
        table: "user_events",
      },
      {
        queryId: "q_3c91",
        avgDurationMs: 890,
        callsPerMin: 4,
        query: "SELECT COUNT(*) FROM orders WHERE status = $1 AND created_at > $2",
        table: "orders",
      },
      ...Array.from({ length: Math.max(0, Math.min(limit, 5) - 2) }, (_, i) => ({
        queryId: `q_${(i + 10).toString(16)}aa`,
        avgDurationMs: 200 - i * 30,
        callsPerMin: 1,
        query: `SELECT id FROM table_${i} WHERE col = $1`,
        table: `table_${i}`,
      })),
    ].slice(0, limit),
  }),
});

export const explainQueryTool = tool({
  description: "Run EXPLAIN ANALYZE on a query ID to get the execution plan.",
  inputSchema: z.object({ queryId: z.string() }),
  execute: async ({ queryId }) => {
    if (queryId === "q_8f2a") {
      return {
        queryId,
        planType: "Seq Scan",
        table: "user_events",
        rowsEstimated: 8_340_000,
        rowsActual: 8_340_000,
        costMs: 4187,
        planNote:
          "Sequential scan on user_events (8.3 M rows). No index satisfies the user_id filter. Full table scan on every call.",
        suggestedIndex: "CREATE INDEX CONCURRENTLY idx_user_events_user_id ON user_events (user_id, created_at DESC);",
      };
    }
    return { queryId, planType: "Index Scan", costMs: 42, planNote: "Efficient — uses existing index." };
  },
});

export const getTableIndexesTool = tool({
  description: "List existing indexes for a database table.",
  inputSchema: z.object({ table: z.string() }),
  execute: async ({ table }) => {
    if (table === "user_events") {
      return {
        table,
        rowCount: 8_340_000,
        sizeGb: 12.4,
        indexes: [
          { name: "user_events_pkey", columns: ["id"], type: "btree", unique: true },
        ],
        note: "Only a primary-key index exists. No index on user_id or created_at.",
      };
    }
    return { table, rowCount: 0, sizeGb: 0, indexes: [] };
  },
});

export const slowQueryTools = {
  get_slow_queries: getSlowQueriesReport,
  explain_query: explainQueryTool,
  get_table_indexes: getTableIndexesTool,
};
