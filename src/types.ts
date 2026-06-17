import type { HarnessAgentAdapter } from "@ai-sdk/harness/agent";
import type { HarnessV1SandboxProvider } from "@ai-sdk/harness";
import type { ToolSet } from "ai";

export interface BenchmarkScenario {
  id: string;
  description: string;
  instructions: string;
  prompt: string;
  tools: ToolSet;
  grade: (text: string) => boolean;
}

export interface BenchmarkHarness {
  name: string;
  model: string;
  adapter: HarnessAgentAdapter;
}

export interface BenchmarkSandbox {
  name: string;
  provider: HarnessV1SandboxProvider;
}

export interface BenchmarkCase {
  scenario: BenchmarkScenario;
  harness: BenchmarkHarness;
  sandbox: BenchmarkSandbox;
}
