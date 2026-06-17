export const runtime = 'nodejs';
export const maxDuration = 600;

import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createCodex } from '@ai-sdk/harness-codex';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import type { HarnessAgentAdapter } from '@ai-sdk/harness/agent';
import { scenarios } from '../../../src/scenarios';
import { createLocalSandboxProvider } from '../../../src/local-sandbox';
import type { BenchmarkScenario } from '../../../src/types';

interface RunConfig {
  anthropicKey: string;
  openaiKey: string;
  gatewayKey: string;
  claudeModel: string;
  codexModel: string;
  useClaudeCode: boolean;
  useCodex: boolean;
  selectedScenarios: string[];
}

interface HarnessEntry {
  name: string;
  model: string;
  adapter: HarnessAgentAdapter;
}

type SSEEvent =
  | { type: 'case-start'; harness: string; model: string; scenario: string }
  | { type: 'output'; text: string }
  | { type: 'result'; result: BenchmarkResult }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface BenchmarkResult {
  scenario: string;
  harness: string;
  model: string;
  sandbox: string;
  passed: boolean;
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  text: string;
}

export async function POST(request: Request): Promise<Response> {
  const config = (await request.json()) as RunConfig;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        const chunk = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      try {
        const harnesses = buildHarnesses(config);
        if (harnesses.length === 0) {
          send({ type: 'error', message: 'No harnesses configured. Check your API keys.' });
          send({ type: 'done' });
          controller.close();
          return;
        }

        const selectedScenarios = scenarios.filter((s) =>
          config.selectedScenarios.includes(s.id),
        );
        if (selectedScenarios.length === 0) {
          send({ type: 'error', message: 'No scenarios selected.' });
          send({ type: 'done' });
          controller.close();
          return;
        }

        const sandboxProvider = createLocalSandboxProvider();

        for (const scenario of selectedScenarios) {
          for (const harness of harnesses) {
            send({
              type: 'case-start',
              harness: harness.name,
              model: harness.model,
              scenario: scenario.id,
            });

            const result = await runCase(harness, scenario, sandboxProvider, send);
            send({ type: 'result', result });
          }
        }

        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: String(err) });
        send({ type: 'done' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function buildHarnesses(config: RunConfig): HarnessEntry[] {
  const harnesses: HarnessEntry[] = [];

  if (config.useClaudeCode && (config.anthropicKey || config.gatewayKey)) {
    const auth = config.anthropicKey
      ? { anthropic: { apiKey: config.anthropicKey } }
      : { gateway: { apiKey: config.gatewayKey } };

    const model = config.anthropicKey
      ? config.claudeModel
      : `anthropic/${config.claudeModel}`;

    harnesses.push({
      name: 'claude-code',
      model,
      adapter: createClaudeCode({
        auth,
        model,
        maxTurns: 10,
        thinking: 'off',
        startupTimeoutMs: 180_000,
      }),
    });
  }

  if (config.useCodex && (config.openaiKey || config.gatewayKey)) {
    const auth = config.openaiKey
      ? { openai: { apiKey: config.openaiKey } }
      : { gateway: { apiKey: config.gatewayKey } };

    const model = config.openaiKey
      ? config.codexModel
      : `openai/${config.codexModel}`;

    harnesses.push({
      name: 'codex',
      model,
      adapter: createCodex({
        auth,
        model,
        reasoningEffort: 'medium',
        startupTimeoutMs: 180_000,
      }),
    });
  }

  return harnesses;
}

async function runCase(
  harness: HarnessEntry,
  scenario: BenchmarkScenario,
  sandboxProvider: ReturnType<typeof createLocalSandboxProvider>,
  send: (e: SSEEvent) => void,
): Promise<BenchmarkResult> {
  const start = Date.now();

  const agent = new HarnessAgent({
    id: harness.name,
    harness: harness.adapter,
    sandbox: sandboxProvider,
    tools: scenario.tools,
    instructions: scenario.instructions,
    telemetry: { recordInputs: false, recordOutputs: false, functionId: harness.name },
  });

  const session = await agent.createSession();
  try {
    const result = await agent.generate({ session, prompt: scenario.prompt });

    if (result.text) {
      send({ type: 'output', text: result.text });
    }

    const steps = result.steps ?? [];
    const toolCalls = steps.reduce((n: number, s: { toolCalls?: unknown[] }) => n + (s.toolCalls?.length ?? 0), 0);
    const passed = scenario.grade(result.text);

    return {
      scenario: scenario.id,
      harness: harness.name,
      model: harness.model,
      sandbox: 'local-node',
      passed,
      steps: steps.length,
      toolCalls,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      durationMs: Date.now() - start,
      text: result.text,
    };
  } finally {
    await session.destroy().catch(() => {});
  }
}
