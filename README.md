# Harness Benchmark

Compare AI coding agents — Claude Code, Codex, and more — across scenarios, models, and sandbox providers. Runs a graded task, records steps / tool calls / tokens / latency, and shows a results table.

## Quick start

```bash
git clone https://github.com/rawtreedb/harness-benchmark
cd harness-benchmark
npm install
npm run dev
```

Open **http://localhost:3000**, enter your API keys, and click **Run Benchmark**.

Keys are saved in your browser's local storage — they are never sent anywhere except the model providers.

## API keys

| Key | Harness |
|-----|---------|
| Anthropic API key (`sk-ant-…`) | Claude Code |
| OpenAI API key (`sk-…`) | Codex |
| Vercel AI Gateway key (`vck_…`) | Both harnesses via gateway |

You only need one key to run. Use the Gateway key if you want to test both harnesses with a single credential.

## Current scenarios

### `incident-triage`

An on-call incident response task. The agent must:

1. Fetch incident details with `get_incident`
2. Query recent errors with `query_recent_errors`
3. Check deployments with `get_recent_deployments`
4. Optionally check upstream status / GitHub issues

Then write a triage report with root cause, blast radius, and a mitigation step.

**Grade:** The report must mention the buggy version (`v2.14.1`), identify the retry/backoff problem, and propose rollback or a circuit breaker.

## Metrics recorded per run

| Metric | Description |
|--------|-------------|
| `steps` | Number of agent turns |
| `tool_calls` | Total tool invocations |
| `input_tokens` | Prompt tokens |
| `output_tokens` | Completion tokens |
| `duration_ms` | Wall-clock time |
| `passed` | Whether the grader accepted the output |

## CLI mode

If you prefer the terminal:

```bash
cp .env.example .env
# Fill in .env with your keys
npm run bench
```

Run only Claude Code:

```bash
SKIP_CODEX=1 npm run bench
```

Override the model:

```bash
CLAUDE_CODE_MODEL=claude-opus-4-8 npm run bench
```

## Extending

### Add a scenario

Add a `BenchmarkScenario` to `src/scenarios.ts`:

```ts
export const myScenario: BenchmarkScenario = {
  id: 'my-scenario',
  description: 'What this evaluates.',
  instructions: 'System prompt for the agent.',
  prompt: 'Task prompt.',
  tools,
  grade(text) {
    return text.toLowerCase().includes('expected signal');
  },
};
```

Then add it to the `scenarios` array and to the `SCENARIOS` constant in `app/page.tsx`.

### Add a harness

Edit `getHarnesses()` in `src/matrix.ts` (CLI) and `buildHarnesses()` in `app/api/run/route.ts` (web UI).

### Add a sandbox provider

Replace or extend `getSandboxes()` in `src/matrix.ts`. Implement `HarnessV1SandboxProvider` from `@ai-sdk/harness`.

## Tech stack

- **Harnesses** — `@ai-sdk/harness-claude-code`, `@ai-sdk/harness-codex`
- **Scenarios** — custom tool definitions with deterministic mock data + real HTTP calls
- **Web UI** — Next.js 15 + Tailwind CSS, server-sent events for streaming output
- **CLI** — TypeScript via `tsx`
