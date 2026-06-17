import { HarnessAgent } from "@ai-sdk/harness/agent";
import type { HarnessAgentAdapter } from "@ai-sdk/harness/agent";
import { tools } from "./tools.js";
import { createLocalSandboxProvider } from "./local-sandbox.js";

export interface HarnessBenchmarkOptions {
  functionId: string;
  harness: HarnessAgentAdapter;
  prompt: string;
}

export interface AgentResult {
  functionId: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  toolCalls: number;
  durationMs: number;
}

const INSTRUCTIONS = `You are an on-call incident response agent.
When given an incident to triage, gather evidence with the provided tools before answering.
Write a short triage report with: root cause hypothesis, affected deployment, blast radius, and one concrete mitigation step.`;

export async function runHarnessAgent(
  options: HarnessBenchmarkOptions
): Promise<AgentResult> {
  const { functionId, harness, prompt } = options;
  const start = Date.now();

  const agent = new HarnessAgent({
    id: functionId,
    harness,
    sandbox: createLocalSandboxProvider(),
    tools,
    instructions: INSTRUCTIONS,
    telemetry: {
      recordInputs: true,
      recordOutputs: true,
      functionId,
    },
  });

  const session = await agent.createSession();
  try {
    const result = await agent.generate({ session, prompt });
    process.stdout.write(result.text);

    const usage = result.usage;
    const steps = result.steps;
    const toolCalls = steps.reduce((n, step) => n + (step.toolCalls?.length ?? 0), 0);

    return {
      functionId,
      text: result.text,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      steps: steps.length,
      toolCalls,
      durationMs: Date.now() - start,
    };
  } finally {
    await session.destroy();
  }
}
