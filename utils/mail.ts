import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bodyFromDisk, bodyFromRfc822 } from "./emlx.js";
import { asString, runAppleScript, runJxa } from "./osascript.js";

// Configuration
const CONFIG = {
	// Maximum emails to return
	MAX_EMAILS: 50,
	// Maximum content length for previews
	MAX_CONTENT_PREVIEW: 300,
	// Mail can stall while it syncs an account; fail with a clear error instead of hanging
	TIMEOUT_MS: Number(process.env.APPLE_MCP_MAIL_TIMEOUT_MS) || 45000,
};

interface EmailMessage {
	subject: string;
	sender: string;
	dateSent: string;
	content: string;
	isRead: boolean;
	mailbox: string;
	id?: number;
}

interface MessageQuery {
	mode: "unread" | "search" | "latest";
	limit: number;
	account?: string;
	mailbox?: string;
	searchTerm?: string;
	withContent?: boolean;
}

/**
 * Query messages in each account's inbox (or the given account/mailbox). Properties
 * are read in bulk (one Apple Event per property, not per message), and only the
 * newest `limit` messages have their content fetched.
 */
const MESSAGE_QUERY = `
function run(argv) {
  const args = JSON.parse(argv[0]);
  const app = Application("Mail");
  let accounts = app.accounts();
  if (args.account) {
    accounts = accounts.filter((a) => a.name() === args.account);
    if (accounts.length === 0) {
      throw new Error("Account not found: " + args.account + ". Available: " + app.accounts.name().join(", "));
    }
  }
  const candidates = [];
  accounts.forEach((account) => {
    const accountName = account.name();
    const names = account.mailboxes.name();
    const index = args.mailbox
      ? names.indexOf(args.mailbox)
      : names.findIndex((n) => n.toLowerCase() === "inbox");
    if (index < 0) return;
    const mailbox = account.mailboxes[index];
    const label = accountName + " - " + names[index];
    // Messages addressed by index cost ~1s per property on large mailboxes; by id
    // they are fast. Collect (id, date) cheaply, then read details for the winners.
    const add = (ids, dates) => ids.forEach((id, i) =>
      candidates.push({ mailbox, id, date: dates[i], label }));
    if (args.mode === "latest") {
      // Mailboxes list newest first
      const ids = mailbox.messages.id().slice(0, args.limit);
      add(ids, ids.map((id) => mailbox.messages.byId(id).dateReceived()));
    } else if (args.mode === "search") {
      // Bulk reads and a JS filter beat a "whose" clause by ~10x on large mailboxes
      const term = args.searchTerm.toLowerCase();
      const ids = mailbox.messages.id();
      const subjects = mailbox.messages.subject();
      const senders = mailbox.messages.sender();
      const hits = [];
      for (let i = 0; i < ids.length && hits.length < args.limit; i++) {
        if ((subjects[i] || "").toLowerCase().includes(term) || (senders[i] || "").toLowerCase().includes(term)) hits.push(ids[i]);
      }
      add(hits, hits.map((id) => mailbox.messages.byId(id).dateReceived()));
    } else {
      const unread = mailbox.messages.whose({ readStatus: false });
      add(unread.id(), unread.dateReceived());
    }
  });
  candidates.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
  const out = candidates.slice(0, args.limit).map((c) => {
    const m = c.mailbox.messages.byId(c.id);
    // Never read m.content(): Mail converts HTML with legacy WebKit on its main thread.
    // Bodies are read from disk by the caller; only the raw source fallback lives here.
    let content = "";
    if (args.sourceIds && args.sourceIds.includes(c.id)) {
      try { content = m.source() || ""; } catch (e) { content = ""; }
    }
    return {
      id: c.id, subject: m.subject() || "No subject", sender: m.sender() || "Unknown sender",
      dateSent: c.date ? c.date.toISOString() : "", content, isRead: m.readStatus(), mailbox: c.label,
    };
  });
  return JSON.stringify(out);
}`;

async function queryMessages(query: MessageQuery): Promise<EmailMessage[]> {
	const run = (sourceIds: number[] = []) =>
		runJxa<(EmailMessage & { id: number })[]>(
			MESSAGE_QUERY,
			{ ...query, limit: Math.min(Math.max(1, query.limit), CONFIG.MAX_EMAILS), sourceIds },
			{ app: "Mail", timeoutMs: CONFIG.TIMEOUT_MS },
		);
	const messages = await run();
	if (!(query.withContent ?? true)) return messages;

	const preview = (text: string) =>
		text.length > CONFIG.MAX_CONTENT_PREVIEW ? text.slice(0, CONFIG.MAX_CONTENT_PREVIEW) + "..." : text;
	const missing: number[] = [];
	for (const m of messages) {
		const body = await bodyFromDisk(m.id);
		if (body === null) missing.push(m.id);
		else m.content = preview(body);
	}
	if (missing.length) {
		// Not on disk (not downloaded yet, or no Full Disk Access): raw source, parsed here
		const withSource = new Map((await run(missing)).map((m) => [m.id, m.content]));
		for (const m of messages) {
			if (!missing.includes(m.id)) continue;
			const raw = withSource.get(m.id);
			m.content = raw ? preview(await bodyFromRfc822(raw)) : "[Content not available]";
		}
	}
	return messages;
}

/**
 * Check if Mail app is accessible
 */
async function checkMailAccess(): Promise<boolean> {
	try {
		await runAppleScript('tell application "Mail" to return name', {
			app: "Mail",
			timeoutMs: 10000,
		});
		return true;
	} catch (error) {
		console.error(
			`Cannot access Mail app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Mail app access and provide instructions if not available
 */
async function requestMailAccess(): Promise<{ hasAccess: boolean; message: string }> {
	const hasAccess = await checkMailAccess();
	if (hasAccess) {
		return { hasAccess: true, message: "Mail access is already granted." };
	}
	return {
		hasAccess: false,
		message:
			"Mail access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Mail'\n3. Make sure Mail app is running and configured with at least one account\n4. Restart your terminal and try again",
	};
}

/**
 * Get unread emails, newest first, from every inbox or the given account/mailbox
 */
async function getUnreadMails(
	limit = 10,
	account?: string,
	mailbox?: string,
): Promise<EmailMessage[]> {
	return queryMessages({ mode: "unread", limit, account, mailbox });
}

/**
 * Search emails by subject or sender, newest first, in every inbox or the given
 * account/mailbox
 */
async function searchMails(
	searchTerm: string,
	limit = 10,
	account?: string,
	mailbox?: string,
): Promise<EmailMessage[]> {
	if (!searchTerm || searchTerm.trim() === "") {
		return [];
	}
	return queryMessages({ mode: "search", limit, account, mailbox, searchTerm });
}

/**
 * Send an email
 */
async function sendMail(
	to: string,
	subject: string,
	body: string,
	cc?: string,
	bcc?: string,
): Promise<string | undefined> {
	if (!to || !to.trim()) {
		throw new Error("To address is required");
	}
	if (!subject || !subject.trim()) {
		throw new Error("Subject is required");
	}
	if (!body || !body.trim()) {
		throw new Error("Email body is required");
	}

	// Body goes through a file to preserve formatting without AppleScript escaping issues
	const tmpFile = join(tmpdir(), `apple-mcp-email-body-${process.pid}-${Date.now()}.txt`);
	writeFileSync(tmpFile, body.trim(), "utf8");
	try {
		const result = await runAppleScript(buildSendScript(tmpFile, to, subject, cc, bcc), {
			app: "Mail",
			timeoutMs: CONFIG.TIMEOUT_MS,
		});
		if (result !== "SUCCESS") {
			throw new Error("Failed to send email");
		}
		return `Email sent to ${to} with subject "${subject}"`;
	} catch (error) {
		throw new Error(
			`Error sending email: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		try {
			unlinkSync(tmpFile);
		} catch {
			// Ignore cleanup errors
		}
	}
}

/** Exported for a compile-only test; running it sends mail. */
function buildSendScript(
	bodyFile: string,
	to: string,
	subject: string,
	cc?: string,
	bcc?: string,
): string {
	return `
tell application "Mail"
    set emailBody to read (POSIX file ${asString(bodyFile)}) as «class utf8»
    set newMessage to make new outgoing message with properties {subject:${asString(subject)}, content:emailBody, visible:true}
    tell newMessage
        make new to recipient with properties {address:${asString(to)}}
        ${cc ? `make new cc recipient with properties {address:${asString(cc)}}` : ""}
        ${bcc ? `make new bcc recipient with properties {address:${asString(bcc)}}` : ""}
    end tell
    send newMessage
    return "SUCCESS"
end tell`;
}

/**
 * Get every mailbox, as "Account - Mailbox"
 */
async function getMailboxes(): Promise<string[]> {
	return runJxa<string[]>(
		`function run() {
  const app = Application("Mail");
  const out = [];
  app.accounts().forEach((a) => {
    const name = a.name();
    a.mailboxes.name().forEach((m) => out.push(name + " - " + m));
  });
  return JSON.stringify(out);
}`,
		null,
		{ app: "Mail", timeoutMs: CONFIG.TIMEOUT_MS },
	);
}

/**
 * Get list of email account names
 */
async function getAccounts(): Promise<string[]> {
	return runJxa<string[]>(
		`function run() { return JSON.stringify(Application("Mail").accounts.name()); }`,
		null,
		{ app: "Mail", timeoutMs: CONFIG.TIMEOUT_MS },
	);
}

/**
 * Get mailboxes for a specific account
 */
async function getMailboxesForAccount(accountName: string): Promise<string[]> {
	if (!accountName || !accountName.trim()) {
		return [];
	}
	return runJxa<string[]>(
		`function run(argv) {
  const args = JSON.parse(argv[0]);
  const matches = Application("Mail").accounts.whose({ name: args.account });
  if (matches.length === 0) return JSON.stringify([]);
  return JSON.stringify(matches[0].mailboxes.name());
}`,
		{ account: accountName },
		{ app: "Mail", timeoutMs: CONFIG.TIMEOUT_MS },
	);
}

/**
 * Get latest emails from a specific account's inbox (or the given mailbox)
 */
async function getLatestMails(
	account: string,
	limit = 5,
	mailbox?: string,
): Promise<EmailMessage[]> {
	return queryMessages({ mode: "latest", limit, account, mailbox });
}

export default {
	getUnreadMails,
	searchMails,
	sendMail,
	buildSendScript,
	getMailboxes,
	getAccounts,
	getMailboxesForAccount,
	getLatestMails,
	requestMailAccess,
};
