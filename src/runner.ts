import { HarnessAgent } from '@ai-sdk/harness/agent';
import type { BenchmarkCase } from './types.js';

export interface BenchmarkResult {
  scenario: string;
  harness: string;
  model: string;
  sandbox: string;
  text: string;
  passed: boolean;
  inputTokens: number;
  outputTokens: number;
  steps: number;
  toolCalls: number;
  durationMs: number;
}

export async function runBenchmarkCase(
  benchmarkCase: BenchmarkCase,
): Promise<BenchmarkResult> {
  const { scenario, harness, sandbox } = benchmarkCase;
  const start = Date.now();

  const agent = new HarnessAgent({
    id: harness.name,
    harness: harness.adapter,
    sandbox: sandbox.provider,
    tools: scenario.tools,
    instructions: scenario.instructions,
    telemetry: {
      recordInputs: false,
      recordOutputs: false,
      functionId: harness.name,
    },
  });

  const session = await agent.createSession();
  try {
    const result = await agent.generate({ session, prompt: scenario.prompt });
    process.stdout.write(result.text);

    const usage = result.usage;
    const steps = result.steps ?? [];
    const toolCalls = steps.reduce(
      (n: number, step: { toolCalls?: unknown[] }) => n + (step.toolCalls?.length ?? 0),
      0,
    );
    const passed = scenario.grade(result.text);

    return {
      scenario: scenario.id,
      harness: harness.name,
      model: harness.model,
      sandbox: sandbox.name,
      text: result.text,
      passed,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      steps: steps.length,
      toolCalls,
      durationMs: Date.now() - start,
    };
  } finally {
    await session.destroy().catch(() => {});
  }
}
