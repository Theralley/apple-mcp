#!/usr/bin/env bun
/**
 * Runs each skill's steps against the real apps through the stdio server.
 *
 * Read steps run as written. Write steps go only to throwaway "[mcp-e2e]" containers
 * that are deleted at the end. Send steps (messages.send, mail.send) are never run.
 * Every tool reference in a SKILL.md must be exercised here or be a send step.
 * Prints counts and timings only, never user content.
 *
 * Usage: bun run tests/skills/run-skills.ts
 */
import { McpStdioClient, resultText } from "../e2e/mcp-client.js";
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
} from "../e2e/fixtures.js";
import { loadSkills, refKey } from "./parse.js";

const NEVER_RUN = new Set(["messages.send", "mail.send", "messages.schedule"]);

const client = new McpStdioClient("bun", ["run", "index.ts"], new URL("../..", import.meta.url).pathname);
let failures = 0;

interface Ctx {
	called: Set<string>;
	skill: string;
}

async function call(
	ctx: Ctx,
	tool: string,
	args: Record<string, unknown>,
	expectOk = true,
	timeoutMs = 120000,
): Promise<string> {
	const key = args.operation ? `${tool}.${args.operation}` : tool;
	ctx.called.add(key);
	try {
		const { result, ms } = await client.callTool(tool, args, timeoutMs);
		const text = resultText(result);
		const good = expectOk ? !result.isError : true;
		if (!good) failures++;
		console.log(`  ${good ? "ok  " : "FAIL"} ${key} ${Math.round(ms)}ms${good ? "" : ` | ${text.slice(0, 160)}`}`);
		return text;
	} catch (e) {
		failures++;
		console.log(`  FAIL ${key} ${(e as Error).message}`);
		return "";
	}
}

function firstContact(text: string): { name: string; phone: string } | null {
	const line = text.split("\n")[2];
	if (!line) return null;
	const [name, rest] = line.split(": ");
	return { name: name.split(" ")[0], phone: rest?.split(", ")[0] ?? "" };
}

const e2eRange = {
	fromDate: "2027-01-01T00:00:00Z",
	toDate: "2027-02-01T00:00:00Z",
	calendarName: E2E_CALENDAR,
};

const scenarios: Record<string, (ctx: Ctx) => Promise<void>> = {
	"apple-contact-lookup": async (ctx) => {
		const all = await call(ctx, "contacts", {});
		const person = firstContact(all);
		if (!person) throw new Error("no contact to look up");
		await call(ctx, "contacts", { name: person.name });
		await call(ctx, "messages", { operation: "read", phoneNumber: person.phone, limit: 3 });
	},

	"apple-meeting-prep": async (ctx) => {
		await call(ctx, "calendar", {
			operation: "create",
			title: `${E2E_PREFIX} project sync`,
			startDate: "2027-01-20T14:00:00+01:00",
			endDate: "2027-01-20T15:00:00+01:00",
			location: "Googleplex, Mountain View, CA",
			notes: "agenda",
			calendarName: E2E_CALENDAR,
		});
		const events = await call(ctx, "calendar", { operation: "list", limit: 5, ...e2eRange });
		if (!events.includes(`${E2E_PREFIX} project sync`)) throw new Error("event not listed");
		await call(ctx, "calendar", { operation: "search", searchText: "project sync", ...e2eRange });
		await call(ctx, "notes", { operation: "search", searchText: "project" });
		await call(ctx, "mail", { operation: "search", searchTerm: "project", limit: 3 }, true, 180000);
		const person = firstContact(await call(ctx, "contacts", {}));
		if (person) await call(ctx, "contacts", { name: person.name });
		await call(ctx, "notes", {
			operation: "create",
			title: `${E2E_PREFIX} prep: project sync`,
			body: "Purpose\nOpen items\nQuestions",
			folderName: E2E_NOTES_FOLDER,
		});
	},

	"apple-reminder-capture": async (ctx) => {
		const lists = await call(ctx, "reminders", { operation: "list" });
		const name = `${E2E_PREFIX} file the report`;
		await call(ctx, "reminders", { operation: "search", searchText: name });
		await call(ctx, "reminders", {
			operation: "create",
			name,
			listName: E2E_REMINDER_LIST,
			notes: "from skill test",
			dueDate: "2027-02-01T09:00:00+01:00",
		});
		await call(ctx, "reminders", { operation: "create", name: `${E2E_PREFIX} x`, listName: `${E2E_PREFIX} missing` }, false);
		const listId = (await call(ctx, "reminders", { operation: "list", listName: E2E_REMINDER_LIST }))
			.match(/- \[mcp-e2e\] list \(ID: ([^)]+)\)/)?.[1];
		if (!listId || !lists) throw new Error("e2e list id not found");
		const byId = await call(ctx, "reminders", { operation: "listById", listId, props: ["name", "dueDate"] });
		if (!byId.includes(name)) throw new Error("created reminder missing from listById");
		await call(ctx, "reminders", { operation: "open", searchText: name });
	},

	"apple-notes-capture": async (ctx) => {
		await call(ctx, "notes", { operation: "search", searchText: "meeting" });
		await call(ctx, "notes", { operation: "list" });
		const title = `${E2E_PREFIX} research ${Date.now()}`;
		await call(ctx, "notes", { operation: "create", title, body: "finding one\nfinding two", folderName: E2E_NOTES_FOLDER });
		const found = await call(ctx, "notes", { operation: "search", searchText: title });
		if (!found.startsWith(title)) throw new Error("saved note not found");
	},

	"apple-event-directions": async (ctx) => {
		const events = await call(ctx, "calendar", { operation: "search", searchText: "project sync", ...e2eRange });
		const location = events.match(/Location: (.+)/)?.[1];
		if (!location) throw new Error("event location not found");
		await call(ctx, "calendar", { operation: "list", limit: 3, ...e2eRange });
		await call(ctx, "maps", { operation: "search", query: location, limit: 3 });
		const route = await call(ctx, "maps", {
			operation: "directions",
			fromAddress: "Apple Park, Cupertino, CA",
			toAddress: location,
			transportType: "transit",
		});
		const minutes = route.match(/about (?:(\d+) h )?(\d+) min/);
		if (!minutes) throw new Error("no travel time");
		await call(ctx, "reminders", {
			operation: "create",
			name: `${E2E_PREFIX} leave for project sync`,
			dueDate: "2027-01-20T12:45:00+01:00",
			listName: E2E_REMINDER_LIST,
		});
	},

	"apple-inbox-triage": async (ctx) => {
		const accounts = await call(ctx, "mail", { operation: "accounts" }, true, 180000);
		const account = accounts.split("\n")[2];
		await call(ctx, "mail", { operation: "unread", limit: 5, ...(account ? { account } : {}) }, true, 180000);
		if (account) {
			await call(ctx, "mail", { operation: "latest", account, limit: 3 }, true, 180000);
			await call(ctx, "mail", { operation: "mailboxes", account }, true, 180000);
		}
		await call(ctx, "mail", { operation: "search", searchTerm: "invoice", limit: 3 }, true, 180000);
		const unread = await call(ctx, "messages", { operation: "unread", limit: 5 });
		const person = firstContact(await call(ctx, "contacts", {}));
		if (person) await call(ctx, "messages", { operation: "read", phoneNumber: person.phone, limit: 3 });
		await call(ctx, "reminders", {
			operation: "create",
			name: `${E2E_PREFIX} reply to thread`,
			dueDate: "2027-01-05T10:00:00+01:00",
			listName: E2E_REMINDER_LIST,
			notes: unread ? "follow-up" : "",
		});
	},

	"apple-mcp-troubleshooting": async (ctx) => {
		await call(ctx, "contacts", { name: `${E2E_PREFIX} probe` });
		await call(ctx, "notes", { operation: "list" });
		await call(ctx, "reminders", { operation: "list" });
		await call(ctx, "calendar", { operation: "list", ...e2eRange });
		await call(ctx, "calendar", { operation: "search", searchText: "probe", ...e2eRange });
		await call(ctx, "mail", { operation: "accounts" }, true, 180000);
		await call(ctx, "messages", { operation: "unread", limit: 1 });
		await call(ctx, "maps", { operation: "search", query: "Cupertino" });
	},
};

try {
	await client.start();
	await createNotesFolder();
	await createReminderList();
	await createCalendar();
	for (const skill of loadSkills()) {
		console.log(`\n${skill.dir}`);
		const ctx: Ctx = { called: new Set(), skill: skill.dir };
		const scenario = scenarios[skill.dir];
		if (!scenario) {
			failures++;
			console.log("  FAIL no scenario for this skill");
			continue;
		}
		try {
			await scenario(ctx);
		} catch (e) {
			failures++;
			console.log(`  FAIL ${(e as Error).message}`);
		}
		for (const ref of skill.refs) {
			const key = refKey(ref);
			if (NEVER_RUN.has(key)) {
				console.log(`  skip ${key} (sends; never run)`);
			} else if (!ctx.called.has(key)) {
				failures++;
				console.log(`  FAIL ${key} referenced but not exercised`);
			}
		}
	}
} finally {
	await client.stop();
	console.log(`\ncleanup: notes ${await cleanupNotes().catch((e) => e.message)}, reminders ${await cleanupReminders().catch((e) => e.message)}, calendar events ${await cleanupCalendar().catch((e) => e.message)}`);
	await new Promise((resolve) => setTimeout(resolve, 3000));
	const left = await residue();
	const clean = left.notes + left.reminders + left.calendars === 0;
	if (!clean) failures++;
	console.log(`residue: ${JSON.stringify(left)}`);
	console.log(failures ? `\n${failures} failure(s)` : "\nall skill steps passed");
}
process.exit(failures ? 1 : 0);
