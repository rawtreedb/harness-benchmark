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
