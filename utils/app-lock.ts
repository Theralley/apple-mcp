import { mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Cross-process lock so only one client drives an Apple app at a time.
 *
 * Apps answer Apple Events serially, so several MCP servers (one per Claude, Codex or
 * agy session) calling Mail at once just queue inside Mail until the slowest call
 * times out. Queue here instead, and fail with a clear "busy" error.
 *
 * Protocol, shared with the apple-mail-mcp server so the two exclude each other:
 * `~/Library/Caches/apple-app-locks/<App>.lock` is a directory made with mkdir
 * (atomic); its `owner` file holds `<pid> <epoch-ms>`. A lock whose owner is gone,
 * or that is older than STALE_AFTER_MS, is stale and may be taken over.
 */

export const STALE_AFTER_MS = 300_000;
const POLL_MS = 200;

export class AppBusyError extends Error {
	constructor(app: string) {
		super(`${app} is busy with a request from another session. Try again in a moment.`);
		this.name = "AppBusyError";
	}
}

export function lockDir(): string {
	return process.env.APPLE_APP_LOCK_DIR || join(homedir(), "Library/Caches/apple-app-locks");
}

function waitBudgetMs(): number {
	return Number(process.env.APPLE_APP_LOCK_WAIT_MS) || 30_000;
}

function isStale(lock: string): boolean {
	let pid: number;
	let started: number;
	try {
		[pid, started] = readFileSync(join(lock, "owner"), "utf8").trim().split(/\s+/).map(Number);
		if (!Number.isFinite(pid) || !Number.isFinite(started)) throw new Error("bad owner");
	} catch {
		// Owner not written yet: only stale once the directory itself is old.
		try {
			return Date.now() - statSync(lock).mtimeMs > 5_000;
		} catch {
			return false;
		}
	}
	if (Date.now() - started > STALE_AFTER_MS) return true;
	try {
		process.kill(pid, 0);
		return false;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "ESRCH";
	}
}

function remove(lock: string): void {
	try {
		unlinkSync(join(lock, "owner"));
	} catch {}
	try {
		rmdirSync(lock);
	} catch {}
}

/** Run `fn` while holding the lock for `app`. */
export async function withAppLock<T>(app: string, fn: () => Promise<T>, waitMs = waitBudgetMs()): Promise<T> {
	const dir = lockDir();
	mkdirSync(dir, { recursive: true });
	const lock = join(dir, `${app}.lock`);
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			mkdirSync(lock);
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
			if (isStale(lock)) {
				remove(lock);
				continue;
			}
			if (Date.now() >= deadline) throw new AppBusyError(app);
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
	}
	try {
		writeFileSync(join(lock, "owner"), `${process.pid} ${Date.now()}`);
		return await fn();
	} finally {
		remove(lock);
	}
}
