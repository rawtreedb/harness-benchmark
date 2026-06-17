import type { BenchmarkScenario } from "./types.js";
import { tools } from "./tools.js";

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

export const scenarios: BenchmarkScenario[] = [incidentTriageScenario];
