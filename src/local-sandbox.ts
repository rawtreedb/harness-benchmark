import type {
  HarnessV1NetworkSandboxSession,
  HarnessV1SandboxProvider,
} from "@ai-sdk/harness";
import type {
  Experimental_SandboxProcess,
  Experimental_SandboxSession,
} from "ai";
import { spawn as spawnChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile as readFsFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";

const DEFAULT_WORKDIR = "/tmp/harness-benchmark";
const BRIDGE_PORT = Number(process.env["HARNESS_BRIDGE_PORT"] ?? "41987");
const PROJECT_BIN = resolve(process.cwd(), "node_modules/.bin");

export function createLocalSandboxProvider(): HarnessV1SandboxProvider {
  return {
    specificationVersion: "harness-sandbox-v1",
    providerId: "local-node",
    bridgePorts: [BRIDGE_PORT],
    async createSession(options) {
      const id = options?.sessionId ?? randomUUID();
      await mkdir(DEFAULT_WORKDIR, { recursive: true });
      return createLocalSandboxSession(id);
    },
  };
}

function createLocalSandboxSession(id: string): HarnessV1NetworkSandboxSession {
  const session: HarnessV1NetworkSandboxSession = {
    id,
    description: `Local sandbox rooted at ${DEFAULT_WORKDIR}. Commands run on this machine for the benchmark example.`,
    defaultWorkingDirectory: DEFAULT_WORKDIR,
    ports: [BRIDGE_PORT],
    getPortUrl: async ({ port, protocol = "http" }) =>
      `${protocol}://127.0.0.1:${port}`,
    stop: async () => {},
    destroy: async () => {},
    restricted: () => restrictedSession(session),
    readFile: readStreamFile,
    readBinaryFile,
    readTextFile,
    writeFile: writeStreamFile,
    writeBinaryFile,
    writeTextFile,
    spawn: spawnProcess,
    run: runProcess,
  };
  return session;
}

function restrictedSession(
  session: HarnessV1NetworkSandboxSession
): Experimental_SandboxSession {
  return {
    description: session.description,
    readFile: session.readFile,
    readBinaryFile: session.readBinaryFile,
    readTextFile: session.readTextFile,
    writeFile: session.writeFile,
    writeBinaryFile: session.writeBinaryFile,
    writeTextFile: session.writeTextFile,
    spawn: session.spawn,
    run: session.run,
  };
}

async function readBinaryFile(options: {
  path: string;
}): Promise<Uint8Array | null> {
  try {
    return await readFsFile(resolve(options.path));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readTextFile(options: {
  path: string;
  encoding?: string;
  startLine?: number;
  endLine?: number;
}): Promise<string | null> {
  const bytes = await readBinaryFile(options);
  if (bytes === null) return null;
  const text = new TextDecoder(options.encoding ?? "utf-8").decode(bytes);
  if (options.startLine === undefined && options.endLine === undefined) return text;

  const lines = text.split("\n");
  const start = Math.max((options.startLine ?? 1) - 1, 0);
  const end = options.endLine ?? lines.length;
  return lines.slice(start, end).join("\n");
}

async function writeBinaryFile(options: {
  path: string;
  content: Uint8Array;
}): Promise<void> {
  const path = resolve(options.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, options.content);
}

async function writeTextFile(options: {
  path: string;
  content: string;
  encoding?: string;
}): Promise<void> {
  const path = resolve(options.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new TextEncoder().encode(options.content));
}

async function writeStreamFile(options: {
  path: string;
  content: ReadableStream<Uint8Array>;
}): Promise<void> {
  const chunks: Uint8Array[] = [];
  const reader = options.content.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await writeBinaryFile({ path: options.path, content: Buffer.concat(chunks) });
}

async function readStreamFile(options: {
  path: string;
}): Promise<ReadableStream<Uint8Array> | null> {
  const bytes = await readBinaryFile(options);
  return bytes === null ? null : bytesToStream(bytes);
}

async function spawnProcess(options: {
  command: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<Experimental_SandboxProcess> {
  const child = spawnChildProcess(options.command, {
    cwd: options.workingDirectory ?? DEFAULT_WORKDIR,
    env: {
      ...process.env,
      PATH: `${PROJECT_BIN}:${process.env["PATH"] ?? ""}`,
      ...options.env,
    },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    signal: options.abortSignal,
  });

  return {
    pid: child.pid,
    stdout: nodeReadableToWeb(child.stdout),
    stderr: nodeReadableToWeb(child.stderr),
    wait: () =>
      new Promise((resolveWait, rejectWait) => {
        child.once("error", rejectWait);
        child.once("close", (code) => resolveWait({ exitCode: code ?? 0 }));
      }),
    kill: async () => {
      if (!child.killed) child.kill();
    },
  };
}

async function runProcess(options: {
  command: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = await spawnProcess(options);
  const [stdout, stderr, result] = await Promise.all([
    streamToText(proc.stdout),
    streamToText(proc.stderr),
    proc.wait(),
  ]);
  return { exitCode: result.exitCode, stdout, stderr };
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function nodeReadableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: unknown) => {
        if (typeof chunk === "string") {
          controller.enqueue(new TextEncoder().encode(chunk));
          return;
        }
        if (chunk instanceof Uint8Array) {
          controller.enqueue(chunk);
        }
      });
      stream.once("end", () => controller.close());
      stream.once("error", (error) => controller.error(error));
    },
    cancel() {
      stream.destroy();
    },
  });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
