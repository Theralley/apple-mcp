import { spawn, type ChildProcess } from "node:child_process";

/**
 * Minimal MCP stdio JSON-RPC client used by the e2e harness and the skills tests.
 * It speaks newline-delimited JSON-RPC 2.0 to a spawned server process.
 */

export interface ToolCallResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface TimedResult<T> {
  result: T;
  ms: number;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class McpStdioClient {
  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  stderr = "";

  constructor(
    private command: string,
    private args: string[],
    private cwd: string,
  ) {}

  async start(timeoutMs = 20000): Promise<TimedResult<any>> {
    const started = performance.now();
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code) => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`server exited with code ${code}`));
      }
      this.pending.clear();
    });

    const init = await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "apple-mcp-e2e", version: "1.0.0" },
      },
      timeoutMs,
    );
    this.notify("notifications/initialized", {});
    return { result: init, ms: performance.now() - started };
  }

  async listTools(timeoutMs = 10000): Promise<any[]> {
    const res = await this.request("tools/list", {}, timeoutMs);
    return res.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 60000,
  ): Promise<TimedResult<ToolCallResult>> {
    const started = performance.now();
    const result = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    return { result, ms: performance.now() - started };
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.child.stdin!.end();
    this.child.kill("SIGTERM");
    this.child = null;
  }

  private notify(method: string, params: unknown): void {
    this.child!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id === undefined || !this.pending.has(msg.id)) continue;
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }
}

export function resultText(result: ToolCallResult): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}
