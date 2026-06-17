/**
 * CLI benchmark runner.
 *
 * Runs scenario × harness configurations, grades each run, and prints a
 * local summary. Set env vars to configure auth and models.
 *
 * Required (at least one):
 *   ANTHROPIC_API_KEY        Direct Anthropic key for Claude Code harness
 *   OPENAI_API_KEY           Direct OpenAI key for Codex harness
 *   VERCEL_AI_GATEWAY_API_KEY  Vercel gateway key (covers both harnesses)
 *
 * Optional:
 *   CLAUDE_CODE_MODEL        Override Claude model (default: claude-sonnet-4-6)
 *   CODEX_MODEL              Override Codex model (default: o4-mini)
 *   SKIP_CLAUDE_CODE=1       Skip Claude Code harness
 *   SKIP_CODEX=1             Skip Codex harness
 */

import * as fs from 'node:fs';
import { getBenchmarkMatrix } from './matrix.js';
import { runBenchmarkCase, type BenchmarkResult } from './runner.js';

function loadEnv(): void {
  try {
    const raw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found — rely on process.env directly.
  }
}

loadEnv();

const anthropicKey = process.env['ANTHROPIC_API_KEY'];
const openaiKey = process.env['OPENAI_API_KEY'];
const gatewayKey = process.env['VERCEL_AI_GATEWAY_API_KEY'];

if (!anthropicKey && !openaiKey && !gatewayKey) {
  console.error(
    'Missing API keys. Set at least one of:\n' +
      '  ANTHROPIC_API_KEY\n' +
      '  OPENAI_API_KEY\n' +
      '  VERCEL_AI_GATEWAY_API_KEY\n' +
      '\nOr use the web UI: npm run dev',
  );
  process.exit(1);
}

const results: BenchmarkResult[] = [];
const keepAlive = setInterval(() => {}, 1_000);

try {
  for (const benchmarkCase of getBenchmarkMatrix({
    anthropicApiKey: anthropicKey,
    openaiApiKey: openaiKey,
    gatewayApiKey: gatewayKey,
  })) {
    console.log('\n─────────────────────────────────────────');
    console.log(
      `Run: ${benchmarkCase.harness.name} / ${benchmarkCase.harness.model} / ${benchmarkCase.sandbox.name} / ${benchmarkCase.scenario.id}`,
    );
    console.log('─────────────────────────────────────────\n');

    const result = await runBenchmarkCase(benchmarkCase);
    results.push(result);

    console.log(
      `\n✓ ${result.harness} done — ${result.steps} steps, ${result.toolCalls} tool calls, ${result.inputTokens + result.outputTokens} tokens, passed=${result.passed}`,
    );
  }
} finally {
  clearInterval(keepAlive);
}

printSummary(results);

function printSummary(results: BenchmarkResult[]): void {
  console.log('\n═══════════════════════════════════════════');
  console.log('Summary');
  console.log('═══════════════════════════════════════════');
  console.log(
    `${'scenario'.padEnd(18)} ${'harness'.padEnd(14)} ${'sandbox'.padEnd(12)} ${'steps'.padEnd(7)} ${'tools'.padEnd(7)} ${'tokens'.padEnd(10)} ${'ms'.padEnd(8)} passed`,
  );
  console.log('─'.repeat(92));
  for (const result of results) {
    console.log(
      `${result.scenario.padEnd(18)} ${result.harness.padEnd(14)} ${result.sandbox.padEnd(12)} ${String(result.steps).padEnd(7)} ${String(result.toolCalls).padEnd(7)} ${String(result.inputTokens + result.outputTokens).padEnd(10)} ${String(result.durationMs).padEnd(8)} ${result.passed ? '✅' : '❌'}`,
    );
  }
}
