import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createCodex } from '@ai-sdk/harness-codex';
import { createLocalSandboxProvider } from './local-sandbox.js';
import { scenarios } from './scenarios.js';
import type { BenchmarkCase, BenchmarkHarness, BenchmarkSandbox } from './types.js';

export interface MatrixOptions {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  gatewayApiKey?: string;
  claudeModel?: string;
  codexModel?: string;
  selectedHarnesses?: ('claude-code' | 'codex')[];
  selectedScenarios?: string[];
}

export function getBenchmarkMatrix(options: MatrixOptions): BenchmarkCase[] {
  const harnesses = getHarnesses(options);
  const sandboxes = getSandboxes();

  const selectedScenarios = options.selectedScenarios
    ? scenarios.filter((s) => options.selectedScenarios!.includes(s.id))
    : scenarios;

  const cases: BenchmarkCase[] = [];
  for (const scenario of selectedScenarios) {
    for (const harness of harnesses) {
      for (const sandbox of sandboxes) {
        cases.push({ scenario, harness, sandbox });
      }
    }
  }
  return cases;
}

function getHarnesses(options: MatrixOptions): BenchmarkHarness[] {
  const {
    anthropicApiKey,
    openaiApiKey,
    gatewayApiKey,
    selectedHarnesses,
  } = options;

  const wantClaudeCode =
    process.env['SKIP_CLAUDE_CODE'] !== '1' &&
    (!selectedHarnesses || selectedHarnesses.includes('claude-code'));

  const wantCodex =
    process.env['SKIP_CODEX'] !== '1' &&
    (!selectedHarnesses || selectedHarnesses.includes('codex'));

  const harnesses: BenchmarkHarness[] = [];

  if (wantClaudeCode && (anthropicApiKey || gatewayApiKey)) {
    const auth = anthropicApiKey
      ? { anthropic: { apiKey: anthropicApiKey } }
      : { gateway: { apiKey: gatewayApiKey! } };

    const rawModel =
      options.claudeModel ??
      process.env['CLAUDE_CODE_MODEL'] ??
      'claude-sonnet-4-6';

    const model = anthropicApiKey ? rawModel : `anthropic/${rawModel}`;

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

  if (wantCodex && (openaiApiKey || gatewayApiKey)) {
    const auth = openaiApiKey
      ? { openai: { apiKey: openaiApiKey } }
      : { gateway: { apiKey: gatewayApiKey! } };

    const rawModel =
      options.codexModel ??
      process.env['CODEX_MODEL'] ??
      'o4-mini';

    const model = openaiApiKey ? rawModel : `openai/${rawModel}`;

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

function getSandboxes(): BenchmarkSandbox[] {
  return [
    {
      name: 'local-node',
      provider: createLocalSandboxProvider(),
    },
  ];
}
