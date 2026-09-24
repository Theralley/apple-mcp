import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppBusyError, STALE_AFTER_MS, withAppLock } from "../../utils/app-lock";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "app-lock-"));
	process.env.APPLE_APP_LOCK_DIR = dir;
});
afterEach(() => {
	delete process.env.APPLE_APP_LOCK_DIR;
	rmSync(dir, { recursive: true, force: true });
});

function holdInChild(seconds: number) {
	const child = Bun.spawn(
		["bun", "-e", `import { withAppLock } from "${join(import.meta.dir, "../../utils/app-lock")}";
		 await withAppLock("Mail", async () => { console.log("held"); await Bun.sleep(${seconds * 1000}); });`],
		{ env: { ...process.env, APPLE_APP_LOCK_DIR: dir }, stdout: "pipe" },
	);
	const ready = (async () => {
		const reader = child.stdout.getReader();
		const { value } = await reader.read();
		return new TextDecoder().decode(value);
	})();
	return { child, ready };
}

describe("app lock", () => {
	test("a second process waits for the first", async () => {
		const { child, ready } = holdInChild(1);
		expect(await ready).toContain("held");
		const t = Date.now();
		await withAppLock("Mail", async () => {}, 10_000);
		expect(Date.now() - t).toBeGreaterThan(500);
		await child.exited;
	}, 20_000);

	test("busy error once the wait budget is spent", async () => {
		const { child, ready } = holdInChild(2);
		expect(await ready).toContain("held");
		await expect(withAppLock("Mail", async () => {}, 300)).rejects.toBeInstanceOf(AppBusyError);
		await child.exited;
	}, 20_000);

	test("a dead owner's lock is taken over", async () => {
		const dead = Bun.spawn(["true"]);
		await dead.exited;
		const lock = join(dir, "Mail.lock");
		mkdirSync(lock);
		writeFileSync(join(lock, "owner"), `${dead.pid} ${Date.now()}`);
		await withAppLock("Mail", async () => {
			expect(readFileSync(join(lock, "owner"), "utf8").split(" ")[0]).toBe(String(process.pid));
		}, 500);
		expect(existsSync(lock)).toBe(false);
	});

	test("an old lock is taken over even if its owner lives", async () => {
		const lock = join(dir, "Mail.lock");
		mkdirSync(lock);
		writeFileSync(join(lock, "owner"), `${process.ppid} ${Date.now() - STALE_AFTER_MS - 1000}`);
		await withAppLock("Mail", async () => {}, 500);
	});

	test("the lock is released when the work throws", async () => {
		await expect(withAppLock("Mail", async () => { throw new Error("boom"); }, 500)).rejects.toThrow("boom");
		expect(existsSync(join(dir, "Mail.lock"))).toBe(false);
	});
});
