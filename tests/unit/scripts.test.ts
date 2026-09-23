import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mailModule from "../../utils/mail.js";
import messagesModule from "../../utils/message.js";
import { asString } from "../../utils/osascript.js";

/**
 * The send paths cannot be exercised without sending, so these tests only compile
 * the generated AppleScript (osacompile never runs it) with hostile input.
 */

const HOSTILE = 'a "quoted" \\ back\\slash " & (do shell script "echo pwned") & "';

function compiles(script: string): string {
	const dir = mkdtempSync(join(tmpdir(), "apple-mcp-compile-"));
	try {
		const out = join(dir, "s.scpt");
		execFileSync("osacompile", ["-o", out, "-e", script], { stdio: "pipe" });
		return execFileSync("osadecompile", [out], { encoding: "utf8" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("AppleScript string escaping", () => {
	it("keeps hostile input inside one string literal", () => {
		const source = compiles(`return ${asString(HOSTILE)}`);
		// A single literal means no command survived as code
		expect(source).not.toMatch(/\)\s*&\s*"/);
		const value = execFileSync("osascript", ["-e", `return ${asString(HOSTILE)}`], {
			encoding: "utf8",
		}).trim();
		expect(value).toBe(HOSTILE);
	});
});

describe("send scripts (compile only, never run)", () => {
	it("Messages send script compiles with hostile input", () => {
		const source = compiles(messagesModule.buildSendScript("+10000000000", HOSTILE));
		expect(source).toContain("send ");
	});

	it("Mail send script compiles with hostile input", () => {
		const source = compiles(
			mailModule.buildSendScript("/tmp/body.txt", "nobody@example.invalid", HOSTILE, HOSTILE, HOSTILE),
		);
		expect(source).toContain("send newMessage");
	});
});
