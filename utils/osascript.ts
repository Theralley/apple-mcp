import { execFile } from "node:child_process";

/**
 * Bounded osascript runners.
 *
 * Every Apple Event goes through here so a slow or wedged app (Mail syncing, Notes
 * waking iCloud, a hidden permission dialog) turns into a clear error instead of a
 * hung MCP request. Arguments are passed to JXA as a JSON argv value, never spliced
 * into script source, so user input cannot break out of a string literal.
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.APPLE_MCP_TIMEOUT_MS) || 30000;

export class AppleScriptTimeoutError extends Error {
	constructor(app: string, timeoutMs: number) {
		super(
			`${app} did not respond within ${Math.round(timeoutMs / 1000)}s. ` +
				`The app may be busy (syncing, indexing) or waiting on a permission dialog. ` +
				`Open ${app} once, check System Settings > Privacy & Security > Automation, ` +
				`or raise APPLE_MCP_TIMEOUT_MS.`,
		);
		this.name = "AppleScriptTimeoutError";
	}
}

interface RunOptions {
	/** App name used in error messages. */
	app?: string;
	timeoutMs?: number;
}

function runOsascript(args: string[], opts: RunOptions = {}): Promise<string> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const app = opts.app ?? "osascript";
	return new Promise((resolve, reject) => {
		execFile(
			"osascript",
			args,
			{ timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					if ((error as { killed?: boolean }).killed) {
						reject(new AppleScriptTimeoutError(app, timeoutMs));
						return;
					}
					const detail = String(stderr || error.message).trim();
					// Apple Events carry their own ~2 minute timeout inside the target app
					if (/-1712|AppleEvent timed out/i.test(detail)) {
						reject(new AppleScriptTimeoutError(app, timeoutMs));
						return;
					}
					if (/-1743|Not authorized to send Apple events/i.test(detail)) {
						reject(
							new Error(
								`Not authorized to control ${app}. Grant access in System Settings > ` +
									`Privacy & Security > Automation for the app running this server. (${detail})`,
							),
						);
						return;
					}
					// "0:12: execution error: Error: Error: msg (-2700)" -> "msg"
					const message = detail
						.replace(/^.*?execution error:\s*/s, "")
						.replace(/^(Error:\s*)+/, "")
						.replace(/\s*\(-?\d+\)$/, "");
					reject(new Error(`${app}: ${message}`));
					return;
				}
				resolve(stdout.replace(/\n$/, ""));
			},
		);
	});
}

/** Run an AppleScript source string with a timeout. */
export function runAppleScript(script: string, opts: RunOptions = {}): Promise<string> {
	return runOsascript(["-e", script], opts);
}

/**
 * Run a JXA script. `source` must define `function run(argv)`; `argv[0]` is the
 * JSON-encoded `args`. The script must return `JSON.stringify(...)`.
 */
export async function runJxa<T>(source: string, args: unknown, opts: RunOptions = {}): Promise<T> {
	const out = await runOsascript(["-l", "JavaScript", "-e", source, JSON.stringify(args ?? null)], opts);
	try {
		return JSON.parse(out) as T;
	} catch {
		throw new Error(`${opts.app ?? "osascript"}: unexpected output: ${out.slice(0, 200)}`);
	}
}

/** Escape a value for use inside an AppleScript double-quoted string literal. */
export function asString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
