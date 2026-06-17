export const runtime = 'nodejs';
export const maxDuration = 600;

import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createCodex } from '@ai-sdk/harness-codex';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import type { HarnessAgentAdapter } from '@ai-sdk/harness/agent';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { registerOTel, aiSdkIntegration } from '@rawtree/otel';
import type { RawTreeOtelHandle } from '@rawtree/otel';
import { scenarios } from '../../../src/scenarios';
import { createLocalSandboxProvider } from '../../../src/local-sandbox';
import type { BenchmarkScenario } from '../../../src/types';

interface RunConfig {
  anthropicKey: string;
  openaiKey: string;
  gatewayKey: string;
  rawtreeKey: string;
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
  | { type: 'rawtree-done' }
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
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let rawtreeHandle: RawTreeOtelHandle | null = null;

      try {
        // ── Validate ────────────────────────────────────────────────────────
        const harnesses = buildHarnesses(config);
        if (harnesses.length === 0) {
          send({ type: 'error', message: 'No harnesses configured. Check your API keys.' });
          send({ type: 'done' });
          return;
        }

        const selectedScenarios = scenarios.filter((s) =>
          config.selectedScenarios.includes(s.id),
        );
        if (selectedScenarios.length === 0) {
          send({ type: 'error', message: 'No scenarios selected.' });
          send({ type: 'done' });
          return;
        }

        // ── Register RawTree OTel ────────────────────────────────────────────
        if (config.rawtreeKey) {
          rawtreeHandle = registerOTel({
            apiKey: config.rawtreeKey,
            serviceName: 'harness-bench',
            environment: 'production',
            integrations: [aiSdkIntegration()],
            forceRegisterProvider: true,
            unregisterOnShutdown: true,
          });
        }

        const tracer = trace.getTracer('harness-bench');
        const sandboxProvider = createLocalSandboxProvider();

        // ── Run matrix ───────────────────────────────────────────────────────
        for (const scenario of selectedScenarios) {
          for (const harness of harnesses) {
            send({
              type: 'case-start',
              harness: harness.name,
              model: harness.model,
              scenario: scenario.id,
            });

            const result = await runCaseInSpan(tracer, harness, scenario, sandboxProvider, send);
            send({ type: 'result', result });
          }
        }

        // ── Flush traces ─────────────────────────────────────────────────────
        if (rawtreeHandle) {
          await rawtreeHandle.shutdown();
          send({ type: 'rawtree-done' });
        }

        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: String(err) });
        send({ type: 'done' });
      } finally {
        // Ensure shutdown even on unexpected errors
        if (rawtreeHandle) {
          await rawtreeHandle.shutdown().catch(() => {});
        }
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

// ── Harness builder ──────────────────────────────────────────────────────────

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

// ── Runner ───────────────────────────────────────────────────────────────────

async function runCaseInSpan(
  tracer: ReturnType<typeof trace.getTracer>,
  harness: HarnessEntry,
  scenario: BenchmarkScenario,
  sandboxProvider: ReturnType<typeof createLocalSandboxProvider>,
  send: (e: SSEEvent) => void,
): Promise<BenchmarkResult> {
  return tracer.startActiveSpan('eval.grade', async (span) => {
    span.setAttribute('scenario', scenario.id);
    span.setAttribute('harness', harness.name);
    span.setAttribute('model', harness.model);
    span.setAttribute('sandbox', 'local-node');

    const start = Date.now();

    try {
      const agent = new HarnessAgent({
        id: harness.name,
        harness: harness.adapter,
        sandbox: sandboxProvider,
        tools: scenario.tools,
        instructions: scenario.instructions,
        telemetry: { recordInputs: true, recordOutputs: true, functionId: harness.name },
      });

      const session = await agent.createSession();
      let result: BenchmarkResult;

      try {
        const agentResult = await agent.generate({ session, prompt: scenario.prompt });

        if (agentResult.text) {
          send({ type: 'output', text: agentResult.text });
        }

        const steps = agentResult.steps ?? [];
        const toolCalls = steps.reduce(
          (n: number, s: { toolCalls?: unknown[] }) => n + (s.toolCalls?.length ?? 0),
          0,
        );
        const passed = scenario.grade(agentResult.text);

        result = {
          scenario: scenario.id,
          harness: harness.name,
          model: harness.model,
          sandbox: 'local-node',
          passed,
          steps: steps.length,
          toolCalls,
          inputTokens: agentResult.usage?.inputTokens ?? 0,
          outputTokens: agentResult.usage?.outputTokens ?? 0,
          durationMs: Date.now() - start,
          text: agentResult.text,
        };
      } finally {
        await session.destroy().catch(() => {});
      }

      span.setAttribute('passed', result.passed);
      span.setAttribute('tool_calls', result.toolCalls);
      span.setAttribute('steps', result.steps);
      span.setAttribute('model_calls', result.steps);
      span.setAttribute('input_tokens', result.inputTokens);
      span.setAttribute('output_tokens', result.outputTokens);
      span.setAttribute('duration_ms', result.durationMs);
      span.setStatus({ code: result.passed ? SpanStatusCode.OK : SpanStatusCode.ERROR });

      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
