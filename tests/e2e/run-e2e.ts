#!/usr/bin/env bun
/**
 * End-to-end run of every tool/operation over stdio against the real Apple apps.
 *
 * Safety rules enforced here:
 * - never sends an iMessage/SMS or email (send/schedule are skipped);
 * - never modifies existing data: writes go only to throwaway "[mcp-e2e]" folders,
 *   lists and calendars created by this script and deleted at the end;
 * - Maps is limited to search and directions;
 * - prints counts and timings only, never contact/note/mail/message content.
 *
 * Usage: bun run tests/e2e/run-e2e.ts [--dist]
 */
import { McpStdioClient, resultText, type ToolCallResult } from "./mcp-client.js";
import {
	E2E_CALENDAR,
	E2E_NOTES_FOLDER,
	E2E_PREFIX,
	E2E_REMINDER_LIST,
	cleanupCalendar,
	cleanupNotes,
	cleanupReminders,
	createCalendar,
	createNotesFolder,
	createReminderList,
	residue,
} from "./fixtures.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const useDist = process.argv.includes("--dist");

type Status = "pass" | "fail" | "skip";
interface Row {
	check: string;
	status: Status;
	ms?: number;
	note: string;
}
const rows: Row[] = [];

function record(check: string, status: Status, note: string, ms?: number): void {
	rows.push({ check, status, note, ms });
	const time = ms === undefined ? "" : ` ${Math.round(ms)}ms`;
	console.log(`${status.toUpperCase().padEnd(4)} ${check}${time} - ${note}`);
}

function lineCount(text: string): number {
	return text.split("\n").filter((l) => l.trim()).length;
}

const client = new McpStdioClient(
	useDist ? "node" : "bun",
	useDist ? ["dist/index.js"] : ["run", "index.ts"],
	ROOT,
);

/**
 * Call a tool and judge it. `expect` returns a short note on success or throws with
 * the reason on failure; notes must not contain user data.
 */
async function check(
	label: string,
	tool: string,
	args: Record<string, unknown>,
	expect: (text: string, result: ToolCallResult) => string,
	timeoutMs = 120000,
): Promise<string | null> {
	try {
		const { result, ms } = await client.callTool(tool, args, timeoutMs);
		const text = resultText(result);
		try {
			record(label, "pass", expect(text, result), ms);
			return text;
		} catch (e) {
			record(label, "fail", `${(e as Error).message} | ${text.slice(0, 160)}`, ms);
			return null;
		}
	} catch (e) {
		record(label, "fail", (e as Error).message);
		return null;
	}
}

function ok(condition: unknown, message: string): void {
	if (!condition) throw new Error(message);
}

const notError = (text: string, r: ToolCallResult) => {
	ok(!r.isError, "isError");
	return `${lineCount(text)} lines`;
};

async function main(): Promise<void> {
	const started = await client.start();
	record("initialize", "pass", `server ${started.result.serverInfo?.name}`, started.ms);
	const t = performance.now();
	const tools = await client.listTools();
	record("tools/list", tools.length === 7 ? "pass" : "fail", tools.map((x) => x.name).join(","), performance.now() - t);

	// ---- Contacts (read only)
	const all = await check("contacts (all)", "contacts", {}, (text, r) => {
		ok(!r.isError && /^Found \d+ contacts/.test(text), "no contacts listed");
		return text.split("\n")[0];
	});
	const firstName = all?.split("\n")[2]?.split(":")[0]?.split(" ")[0];
	if (firstName) {
		await check("contacts (name search)", "contacts", { name: firstName }, (text, r) => {
			ok(!r.isError && !text.startsWith("No contact"), "known name not found");
			return `${lineCount(text)} match(es)`;
		});
	}
	await check("contacts (no match)", "contacts", { name: `${E2E_PREFIX} nobody` }, (text) => {
		ok(text.startsWith("No contact found"), "expected no match");
		return "no match reported";
	});

	// ---- Notes
	await check("notes list", "notes", { operation: "list" }, (text, r) => {
		ok(!r.isError && !text.includes("Untitled Note:\n\n"), "notes not parsed");
		return `${text.split("\n\n").length} notes`;
	});
	await check("notes search", "notes", { operation: "search", searchText: "a" }, notError);
	await createNotesFolder();
	const noteTitle = `${E2E_PREFIX} note ${Date.now()}`;
	await check(
		"notes create",
		"notes",
		{ operation: "create", title: noteTitle, body: "line 1\nline <2> & \"3\"", folderName: E2E_NOTES_FOLDER },
		(text, r) => {
			ok(!r.isError && text.includes(`folder "${E2E_NOTES_FOLDER}"`), "not created in e2e folder");
			return "created in e2e folder";
		},
	);
	await check("notes search (created)", "notes", { operation: "search", searchText: noteTitle }, (text) => {
		ok(text.startsWith(noteTitle) && text.includes("line <2> & \"3\""), "created note not found verbatim");
		return "found with body intact";
	});
	await check(
		"notes create (missing folder)",
		"notes",
		{ operation: "create", title: `${E2E_PREFIX} x`, body: "x", folderName: `${E2E_PREFIX} no-such-folder` },
		(text, r) => {
			ok(r.isError && text.includes("Folder not found"), "expected folder error");
			return "rejected";
		},
	);

	// ---- Reminders
	await check("reminders list", "reminders", { operation: "list" }, (text, r) => {
		ok(!r.isError && /^Found \d+ lists/.test(text), "no lists");
		return text.split("\n")[0].replace(/\d+ open/, "N open");
	});
	await createReminderList();
	const reminderName = `${E2E_PREFIX} reminder ${Date.now()}`;
	await check(
		"reminders create",
		"reminders",
		{ operation: "create", name: reminderName, listName: E2E_REMINDER_LIST, notes: "e2e", dueDate: "2027-03-01T09:00:00+01:00" },
		(text, r) => {
			ok(!r.isError && text.includes(E2E_REMINDER_LIST) && text.includes("2027-03-01T08:00:00.000Z"), "wrong list or due");
			return "created in e2e list with due date";
		},
	);
	await check(
		"reminders create (missing list)",
		"reminders",
		{ operation: "create", name: `${E2E_PREFIX} x`, listName: `${E2E_PREFIX} no-such-list` },
		(text, r) => {
			ok(r.isError && text.includes("List not found"), "expected list error");
			return "rejected";
		},
	);
	await check("reminders search", "reminders", { operation: "search", searchText: reminderName }, (text) => {
		ok(text.includes(reminderName), "created reminder not found");
		return "found";
	});
	const listText = await check("reminders list (filtered)", "reminders", { operation: "list", listName: E2E_REMINDER_LIST }, (text) => {
		ok(text.includes(reminderName), "filter lost reminder");
		return "filter ok";
	});
	const listId = listText?.match(new RegExp(`- ${E2E_REMINDER_LIST.replace(/[[\]]/g, "\\$&")} \\(ID: ([^)]+)\\)`))?.[1];
	if (listId) {
		await check("reminders listById", "reminders", { operation: "listById", listId, props: ["name", "dueDate"] }, (text) => {
			ok(text.includes(reminderName) && !text.includes('"body"'), "props not applied");
			return "props filtered";
		});
	} else {
		record("reminders listById", "fail", "could not read e2e list id");
	}
	await check("reminders open", "reminders", { operation: "open", searchText: reminderName }, (text, r) => {
		ok(!r.isError, "open failed");
		return "Reminders shown";
	});

	// ---- Calendar
	await createCalendar();
	let eventId: string | undefined;
	await check(
		"calendar create",
		"calendar",
		{
			operation: "create",
			title: `${E2E_PREFIX} event`,
			startDate: "2027-01-15T10:00:00+01:00",
			endDate: "2027-01-15T11:00:00+01:00",
			location: "Nowhere",
			notes: "e2e",
			calendarName: E2E_CALENDAR,
		},
		(text, r) => {
			ok(!r.isError && text.includes(E2E_CALENDAR), "not created in e2e calendar");
			eventId = text.match(/Event ID: (\S+)/)?.[1];
			return "created in e2e calendar";
		},
	);
	const range = { fromDate: "2027-01-01T00:00:00Z", toDate: "2027-02-01T00:00:00Z", calendarName: E2E_CALENDAR };
	await check("calendar list (e2e calendar)", "calendar", { operation: "list", ...range }, (text) => {
		ok(text.includes(`${E2E_PREFIX} event`), "event not listed");
		return "listed";
	});
	await check("calendar search (e2e calendar)", "calendar", { operation: "search", searchText: "nowhere", ...range }, (text) => {
		ok(text.includes(`${E2E_PREFIX} event`), "event not found by location");
		return "found by location";
	});
	if (eventId) {
		await check("calendar open", "calendar", { operation: "open", eventId, calendarName: E2E_CALENDAR }, (text, r) => {
			ok(!r.isError, "open failed");
			return "Calendar shown";
		});
	} else {
		record("calendar open", "fail", "no event id from create");
	}
	// All calendars, next 7 days: must either answer or fail with a clear timeout, never hang
	await check(
		"calendar list (all calendars, 7 days)",
		"calendar",
		{ operation: "list", limit: 20 },
		(text, r) => {
			if (r.isError) {
				ok(/did not respond within/.test(text), "error was not a clear timeout");
				return "bounded: clear timeout error (grant Full Calendar access for fast reads)";
			}
			return text.split("\n")[0].replace(/\d+ events/, "N events");
		},
		200000,
	);

	// ---- Messages (read only; never send)
	await check("messages unread", "messages", { operation: "unread", limit: 5 }, notError);
	const phone = all?.split("\n")[2]?.split(": ")[1]?.split(", ")[0];
	if (phone) {
		await check("messages read", "messages", { operation: "read", phoneNumber: phone, limit: 5 }, notError);
	}
	record("messages send", "skip", "never sends (safety rule); script compile-checked in tests/unit");
	record("messages schedule", "skip", "would send later (safety rule)");

	// ---- Mail (read only; never send)
	const accounts = await check("mail accounts", "mail", { operation: "accounts" }, (text, r) => {
		ok(!r.isError && /^Found \d+ email accounts/.test(text), "no accounts");
		return text.split("\n")[0];
	});
	const account = accounts?.split("\n")[2];
	await check("mail mailboxes", "mail", { operation: "mailboxes" }, notError);
	if (account) {
		await check("mail mailboxes (account)", "mail", { operation: "mailboxes", account }, notError);
		await check("mail latest (account)", "mail", { operation: "latest", account, limit: 3 }, notError);
	}
	await check("mail unread", "mail", { operation: "unread", limit: 3 }, notError);
	await check("mail search", "mail", { operation: "search", searchTerm: "a", limit: 3 }, notError);
	await check("mail latest (bad account)", "mail", { operation: "latest", account: `${E2E_PREFIX} none` }, (text, r) => {
		ok(r.isError && text.includes("Account not found"), "expected account error");
		return "rejected";
	});
	record("mail send", "skip", "never sends (safety rule); script compile-checked in tests/unit");

	// ---- Maps (search and directions only)
	await check("maps search", "maps", { operation: "search", query: "Apple Park, Cupertino, CA", limit: 3 }, (text, r) => {
		ok(!r.isError && /Coordinates: \d/.test(text), "no coordinates");
		return text.split("\n")[0];
	});
	for (const transportType of ["driving", "walking", "transit"]) {
		await check(
			`maps directions (${transportType})`,
			"maps",
			{ operation: "directions", fromAddress: "Apple Park, Cupertino, CA", toAddress: "Googleplex, Mountain View, CA", transportType },
			(text, r) => {
				ok(!r.isError && /\d+(\.\d)? km, about/.test(text), "no distance/duration");
				return text.split("\n")[0].replace(/^.*: /, "");
			},
		);
	}
	for (const op of ["save", "pin", "listGuides", "createGuide", "addToGuide"]) {
		record(`maps ${op}`, "skip", "Maps limited to search/directions (safety rule); opens Maps UI only");
	}

	// ---- Argument validation (never reaches an app)
	await check("messages send (invalid args)", "messages", { operation: "send" }, (text, r) => {
		ok(r.isError && text.includes("Invalid arguments"), "expected validation error");
		return "rejected before sending";
	});
}

let exitCode = 0;
try {
	await main();
} catch (e) {
	record("harness", "fail", (e as Error).message);
} finally {
	await client.stop();
	const cleaned = {
		notes: await cleanupNotes().catch((e) => `error: ${e.message}`),
		reminders: await cleanupReminders().catch((e) => `error: ${e.message}`),
		calendar: await cleanupCalendar().catch((e) => `error: ${e.message}`),
	};
	console.log(`cleanup: ${JSON.stringify(cleaned)}`);
	// Calendar applies deletes asynchronously
	await new Promise((resolve) => setTimeout(resolve, 3000));
	const left = await residue();
	record(
		"cleanup residue",
		left.notes + left.reminders + left.calendars === 0 ? "pass" : "fail",
		JSON.stringify(left),
	);
	const counts = { pass: 0, fail: 0, skip: 0 };
	rows.forEach((r) => counts[r.status]++);
	console.log(`\n${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`);
	exitCode = counts.fail ? 1 : 0;
}
process.exit(exitCode);
