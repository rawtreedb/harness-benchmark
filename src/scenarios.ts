import type { BenchmarkScenario } from "./types.js";
import { tools, costSpikeTools, slowQueryTools } from "./tools.js";

const incidentTriagePrompt = `Investigate incident inc_checkout_latency_2026_06_14.

Use the provided incident tools to gather evidence before you answer:
1. get_incident — fetch inc_checkout_latency_2026_06_14
2. query_recent_errors — inspect checkout-api errors
3. get_recent_deployments — inspect recent checkout-api deployments
4. fetch_status_page — check one upstream dependency
5. search_github_issues — optional, if a dependency bug looks relevant

Return a triage report with:
- Root cause hypothesis
- Affected deployment version and author
- Blast radius
- One concrete mitigation step`;

export const incidentTriageScenario: BenchmarkScenario = {
  id: "incident-triage",
  description: "On-call checkout latency investigation with tools.",
  instructions: `You are an on-call incident response agent.
When given an incident to triage, gather evidence with the provided tools before answering.
Write a short triage report with: root cause hypothesis, affected deployment, blast radius, and one concrete mitigation step.`,
  prompt: incidentTriagePrompt,
  tools,
  grade(text) {
    const normalized = text.toLowerCase();
    return (
      normalized.includes("v2.14.1") &&
      (normalized.includes("retry") || normalized.includes("backoff")) &&
      (normalized.includes("rollback") ||
        normalized.includes("roll back") ||
        normalized.includes("circuit breaker"))
    );
  },
};

export const costSpikeScenario: BenchmarkScenario = {
  id: "cost-spike",
  description: "Cloud billing alert — identify the runaway service and idle GPU instances.",
  instructions: `You are a cloud cost engineer responding to a billing alert.
Use the provided tools to identify which service caused the spike, what resources are running, and why costs increased.
Write a short report with: the culprit service, root cause, estimated wasted spend, and one concrete remediation step.`,
  prompt: `Investigate billing alert alert_cost_spike_2026_06_15.

Use the provided tools:
1. get_billing_alert — fetch the alert details
2. list_service_costs — break down spend by service for 2026-06-14
3. get_compute_resources — inspect the top offending service

Return a cost incident report with:
- Culprit service and root cause
- Estimated wasted spend
- Affected resource type and count
- One concrete remediation step`,
  tools: costSpikeTools,
  grade(text) {
    const t = text.toLowerCase();
    return (
      t.includes("ml-inference") &&
      (t.includes("a100") || t.includes("gpu") || t.includes("idle")) &&
      (t.includes("terminat") || t.includes("stop") || t.includes("scale down") || t.includes("shut"))
    );
  },
};

export const slowQueryScenario: BenchmarkScenario = {
  id: "slow-query",
  description: "Database slow query — find the missing index causing full table scans.",
  instructions: `You are a database reliability engineer.
Use the provided tools to identify the slowest query, inspect its execution plan, and check the table's indexes.
Write a short diagnosis with: the slow query, why it's slow, and the exact index DDL to fix it.`,
  prompt: `The API team reports that user activity pages are taking 4+ seconds to load since yesterday.
Diagnose the database layer.

Use the provided tools:
1. get_slow_queries — fetch the top slow queries since 2026-06-15T00:00:00Z
2. explain_query — get the execution plan for the slowest query
3. get_table_indexes — inspect the table's current indexes

Return a diagnosis with:
- The problematic query
- Why it's slow (execution plan summary)
- The exact CREATE INDEX statement to fix it`,
  tools: slowQueryTools,
  grade(text) {
    const t = text.toLowerCase();
    return (
      (t.includes("user_events") || t.includes("userevents")) &&
      t.includes("user_id") &&
      (t.includes("create index") || t.includes("index on") || t.includes("missing index") || t.includes("add an index"))
    );
  },
};

export const scenarios: BenchmarkScenario[] = [
  incidentTriageScenario,
  costSpikeScenario,
  slowQueryScenario,
];
