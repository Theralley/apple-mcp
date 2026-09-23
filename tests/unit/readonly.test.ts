import { describe, expect, test } from "bun:test";
import { READ_ONLY_BLOCKED, readOnlyBlock } from "../../utils/readonly";

const on = { APPLE_MCP_READ_ONLY: "1" };

describe("read-only mode", () => {
	test("blocks every sending operation when enabled", () => {
		for (const [tool, ops] of Object.entries(READ_ONLY_BLOCKED)) {
			for (const op of ops) expect(readOnlyBlock(tool, op, on)).toContain("blocked");
		}
		expect(READ_ONLY_BLOCKED).toEqual({ messages: ["send", "schedule"], mail: ["send"] });
	});

	test("allows reads and local creates when enabled", () => {
		for (const [tool, op] of [
			["messages", "read"], ["messages", "unread"], ["mail", "search"], ["mail", "unread"],
			["notes", "create"], ["reminders", "create"], ["calendar", "create"], ["contacts", undefined],
		] as const) {
			expect(readOnlyBlock(tool, op, on)).toBeNull();
		}
	});

	test("changes nothing when disabled", () => {
		expect(readOnlyBlock("mail", "send", {})).toBeNull();
		expect(readOnlyBlock("messages", "send", { APPLE_MCP_READ_ONLY: "0" })).toBeNull();
	});
});
