'use client';

import { useEffect, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

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

interface LogEntry {
  ts: number;
  type: 'info' | 'output' | 'error';
  text: string;
}

type SSEEvent =
  | { type: 'case-start'; harness: string; model: string; scenario: string }
  | { type: 'output'; text: string }
  | { type: 'result'; result: BenchmarkResult }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ── Constants ────────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 'incident-triage',
    label: 'Incident Triage',
    description: 'On-call checkout latency investigation with tools',
  },
];

const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

const CODEX_MODELS = [
  { value: 'o4-mini', label: 'o4-mini' },
  { value: 'o3', label: 'o3' },
  { value: 'gpt-4o', label: 'GPT-4o' },
];

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'harness-benchmark-config';

function loadConfig(): RunConfig {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {}
  return defaultConfig();
}

function defaultConfig(): RunConfig {
  return {
    anthropicKey: '',
    openaiKey: '',
    gatewayKey: '',
    claudeModel: 'claude-sonnet-4-6',
    codexModel: 'o4-mini',
    useClaudeCode: true,
    useCodex: false,
    selectedScenarios: ['incident-triage'],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Components ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)]">
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {title}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KeyField({
  label,
  badge,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  badge?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]">{label}</label>
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium">
            {badge}
          </span>
        )}
      </div>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'Enter key…'}
          className="w-full rounded-md bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] font-mono"
          spellCheck={false}
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)] text-xs transition-colors"
          >
            {visible ? 'hide' : 'show'}
          </button>
        )}
      </div>
    </div>
  );
}

function ModelSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 cursor-pointer ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <div
        onClick={() => !disabled && onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition-colors ${
          checked ? 'bg-[var(--accent)]' : 'bg-zinc-700'
        } ${disabled ? '' : 'cursor-pointer'}`}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
      <span className="text-sm text-[var(--text)]">{label}</span>
    </label>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const cls =
    entry.type === 'error'
      ? 'text-red-400'
      : entry.type === 'info'
        ? 'text-zinc-400'
        : 'text-zinc-200';
  return (
    <div className={`${cls} leading-relaxed`}>
      {entry.text.split('\n').map((line, i) => (
        <div key={i} className={i > 0 ? '' : ''}>
          {line || <br />}
        </div>
      ))}
    </div>
  );
}

function ResultRow({ result }: { result: BenchmarkResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        className="border-t border-[var(--border)] hover:bg-[var(--surface-raised)] cursor-pointer transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-4 py-3 text-xs font-mono text-zinc-300">{result.scenario}</td>
        <td className="px-4 py-3 text-xs font-mono text-zinc-400">{result.harness}</td>
        <td className="px-4 py-3 text-xs font-mono text-zinc-400 max-w-[180px] truncate">
          {result.model}
        </td>
        <td className="px-4 py-3 text-xs text-zinc-400 text-right">{result.steps}</td>
        <td className="px-4 py-3 text-xs text-zinc-400 text-right">{result.toolCalls}</td>
        <td className="px-4 py-3 text-xs text-zinc-400 text-right">
          {fmtTokens(result.inputTokens + result.outputTokens)}
        </td>
        <td className="px-4 py-3 text-xs text-zinc-400 text-right">{fmtMs(result.durationMs)}</td>
        <td className="px-4 py-3 text-center">
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold ${
              result.passed ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {result.passed ? '✓ pass' : '✗ fail'}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-[var(--border)]">
          <td colSpan={8} className="px-4 py-3 bg-[var(--surface)]">
            <div className="text-xs text-zinc-400 mb-1 font-semibold uppercase tracking-wider">
              Agent output
            </div>
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
              {result.text}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const [config, setConfig] = useState<RunConfig>(defaultConfig);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [runCount, setRunCount] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage
  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  // Persist config changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {}
  }, [config]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const update = <K extends keyof RunConfig>(key: K, value: RunConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const addLog = (type: LogEntry['type'], text: string) =>
    setLogs((l) => [...l, { ts: Date.now(), type, text }]);

  const canRun =
    !running &&
    config.selectedScenarios.length > 0 &&
    (config.useClaudeCode || config.useCodex) &&
    (config.anthropicKey ||
      config.openaiKey ||
      config.gatewayKey ||
      // allow running if any enabled harness has a key
      (config.useClaudeCode && config.anthropicKey) ||
      (config.useCodex && config.openaiKey) ||
      config.gatewayKey);

  const hasAnyKey = config.anthropicKey || config.openaiKey || config.gatewayKey;

  async function handleRun() {
    if (!canRun) return;
    setRunning(true);
    setLogs([]);
    setResults([]);
    setRunCount((n) => n + 1);

    addLog('info', '─── Starting benchmark run ───');

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const text = await res.text();
        addLog('error', `Server error: ${text}`);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const dataLine = part
            .split('\n')
            .find((l) => l.startsWith('data: '));
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine.slice(6)) as SSEEvent;

            if (event.type === 'case-start') {
              addLog('info', `\nRunning: ${event.harness} / ${event.model} / ${event.scenario}`);
            } else if (event.type === 'output') {
              addLog('output', event.text);
            } else if (event.type === 'result') {
              setResults((r) => [...r, event.result]);
              addLog(
                'info',
                `Done — ${event.result.steps} steps, ${event.result.toolCalls} tool calls, ${event.result.durationMs}ms, ${event.result.passed ? '✓ pass' : '✗ fail'}`,
              );
            } else if (event.type === 'error') {
              addLog('error', `Error: ${event.message}`);
            } else if (event.type === 'done') {
              addLog('info', '\n─── Run complete ───');
            }
          } catch {}
        }
      }
    } catch (err) {
      addLog('error', `Failed: ${err}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header
        className="border-b border-[var(--border)] px-6 py-4 flex items-center gap-4 sticky top-0 z-10"
        style={{ background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[var(--accent)] text-lg">⚡</span>
          <span className="font-semibold text-[var(--text)] tracking-tight">
            Harness Benchmark
          </span>
        </div>
        <span className="text-xs text-[var(--text-muted)] hidden sm:block">
          Compare AI coding agents across harnesses, models, and sandboxes
        </span>
        {runCount > 0 && (
          <div className="ml-auto flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
            {results.length > 0 && (
              <>
                <span className="text-emerald-400">
                  {results.filter((r) => r.passed).length} pass
                </span>
                {results.some((r) => !r.passed) && (
                  <span className="text-red-400">
                    {results.filter((r) => !r.passed).length} fail
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside
          className="w-80 flex-shrink-0 border-r border-[var(--border)] overflow-y-auto p-4 space-y-4"
          style={{ background: 'var(--surface)' }}
        >
          {/* API Keys */}
          <Section title="API Keys">
            <div className="space-y-4">
              <KeyField
                label="Anthropic API Key"
                badge="Claude Code"
                value={config.anthropicKey}
                onChange={(v) => update('anthropicKey', v)}
                placeholder="sk-ant-…"
              />
              <KeyField
                label="OpenAI API Key"
                badge="Codex"
                value={config.openaiKey}
                onChange={(v) => update('openaiKey', v)}
                placeholder="sk-…"
              />
              <KeyField
                label="Vercel AI Gateway Key"
                badge="optional"
                value={config.gatewayKey}
                onChange={(v) => update('gatewayKey', v)}
                placeholder="vck_…"
              />
            </div>
          </Section>

          {/* Scenarios */}
          <Section title="Scenarios">
            <div className="space-y-2">
              {SCENARIOS.map((s) => (
                <label key={s.id} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={config.selectedScenarios.includes(s.id)}
                    onChange={(e) =>
                      update(
                        'selectedScenarios',
                        e.target.checked
                          ? [...config.selectedScenarios, s.id]
                          : config.selectedScenarios.filter((x) => x !== s.id),
                      )
                    }
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <div>
                    <div className="text-sm text-[var(--text)] group-hover:text-white transition-colors">
                      {s.label}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{s.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </Section>

          {/* Harnesses */}
          <Section title="Harnesses">
            <div className="space-y-4">
              {/* Claude Code */}
              <div className="space-y-2">
                <Toggle
                  checked={config.useClaudeCode}
                  onChange={(v) => update('useClaudeCode', v)}
                  label="Claude Code"
                  disabled={!config.anthropicKey && !config.gatewayKey}
                />
                {config.useClaudeCode && (
                  <div className="ml-[42px]">
                    <ModelSelect
                      value={config.claudeModel}
                      options={CLAUDE_MODELS}
                      onChange={(v) => update('claudeModel', v)}
                    />
                  </div>
                )}
              </div>

              {/* Codex */}
              <div className="space-y-2">
                <Toggle
                  checked={config.useCodex}
                  onChange={(v) => update('useCodex', v)}
                  label="Codex"
                  disabled={!config.openaiKey && !config.gatewayKey}
                />
                {config.useCodex && (
                  <div className="ml-[42px]">
                    <ModelSelect
                      value={config.codexModel}
                      options={CODEX_MODELS}
                      onChange={(v) => update('codexModel', v)}
                    />
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={!canRun}
            className={`w-full rounded-lg py-3 text-sm font-semibold transition-all ${
              canRun
                ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-lg shadow-indigo-900/30 active:scale-[0.98]'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Running…
              </span>
            ) : (
              '▶  Run Benchmark'
            )}
          </button>

          {!hasAnyKey && (
            <p className="text-xs text-[var(--text-muted)] text-center">
              Enter at least one API key above to run
            </p>
          )}
        </aside>

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Empty state */}
          {runCount === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3 max-w-sm px-4">
                <div className="text-4xl">⚡</div>
                <h2 className="text-lg font-semibold text-[var(--text)]">
                  Ready to benchmark
                </h2>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                  Enter your API keys, select a scenario and harness, then click{' '}
                  <strong className="text-[var(--text)]">Run Benchmark</strong> to start.
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Keys are stored in your browser only — never sent to any server except the model
                  providers.
                </p>
              </div>
            </div>
          )}

          {/* Log output */}
          {runCount > 0 && (
            <>
              <div
                className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
                style={{ background: '#0a0a0d' }}
              >
                <div className="max-w-4xl mx-auto space-y-0.5">
                  {logs.map((entry, i) => (
                    <LogLine key={i} entry={entry} />
                  ))}
                  {running && (
                    <div className="text-[var(--accent)] animate-pulse">█</div>
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>

              {/* Results table */}
              {results.length > 0 && (
                <div
                  className="border-t border-[var(--border)] overflow-x-auto"
                  style={{ background: 'var(--surface)' }}
                >
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        {['Scenario', 'Harness', 'Model', 'Steps', 'Tools', 'Tokens', 'Duration', 'Result'].map(
                          (h, i) => (
                            <th
                              key={h}
                              className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] ${
                                i >= 3 && i < 7 ? 'text-right' : i === 7 ? 'text-center' : ''
                              }`}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <ResultRow key={i} result={r} />
                      ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-2 text-[10px] text-[var(--text-muted)]">
                    Click a row to expand the agent output
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
