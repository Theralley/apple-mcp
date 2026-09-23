import { runJxa } from "../../utils/osascript.js";

/**
 * Throwaway containers for e2e write tests. Everything created here is named with
 * the E2E_PREFIX, and the cleanup helpers refuse to touch anything else.
 */

export const E2E_PREFIX = "[mcp-e2e]";
export const E2E_NOTES_FOLDER = `${E2E_PREFIX} folder`;
export const E2E_REMINDER_LIST = `${E2E_PREFIX} list`;
export const E2E_CALENDAR = `${E2E_PREFIX} calendar`;

function assertPrefixed(name: string): void {
	if (!name.startsWith(E2E_PREFIX)) {
		throw new Error(`refusing to touch "${name}": not an ${E2E_PREFIX} item`);
	}
}

export async function createNotesFolder(name = E2E_NOTES_FOLDER): Promise<void> {
	assertPrefixed(name);
	await runJxa(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  const Notes = Application("Notes");
  if (Notes.folders.whose({ name: a.name }).length === 0) {
    Notes.defaultAccount().folders.push(Notes.Folder({ name: a.name }));
  }
  return JSON.stringify(true);
}`,
		{ name },
		{ app: "Notes", timeoutMs: 60000 },
	);
}

/**
 * Delete the e2e folder and every note whose title starts with the prefix. Notes
 * moves deleted notes to Recently Deleted, so a second delete purges them.
 */
export async function cleanupNotes(folder = E2E_NOTES_FOLDER): Promise<number> {
	assertPrefixed(folder);
	return runJxa<number>(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  const Notes = Application("Notes");
  let removed = 0;
  for (let pass = 0; pass < 2; pass++) {
    const notes = Notes.notes.whose({ name: { _beginsWith: a.prefix } })();
    notes.forEach((n) => { Notes.delete(n); removed++; });
  }
  Notes.folders.whose({ name: a.folder })().forEach((f) => Notes.delete(f));
  return JSON.stringify(removed);
}`,
		{ prefix: E2E_PREFIX, folder },
		{ app: "Notes", timeoutMs: 60000 },
	);
}

export async function createReminderList(name = E2E_REMINDER_LIST): Promise<void> {
	assertPrefixed(name);
	await runJxa(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  const app = Application("Reminders");
  if (app.lists.whose({ name: a.name }).length === 0) app.lists.push(app.List({ name: a.name }));
  return JSON.stringify(true);
}`,
		{ name },
		{ app: "Reminders", timeoutMs: 60000 },
	);
}

/** Delete the e2e list (and its reminders) plus any stray prefixed reminder elsewhere. */
export async function cleanupReminders(list = E2E_REMINDER_LIST): Promise<number> {
	assertPrefixed(list);
	return runJxa<number>(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  const app = Application("Reminders");
  let removed = 0;
  app.lists.whose({ name: a.list })().forEach((l) => { removed += l.reminders.length; app.delete(l); });
  app.reminders.whose({ name: { _beginsWith: a.prefix } })().forEach((r) => { app.delete(r); removed++; });
  return JSON.stringify(removed);
}`,
		{ prefix: E2E_PREFIX, list },
		{ app: "Reminders", timeoutMs: 90000 },
	);
}

export async function createCalendar(name = E2E_CALENDAR): Promise<void> {
	assertPrefixed(name);
	await runJxa(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  const app = Application("Calendar");
  if (app.calendars.whose({ name: a.name }).length === 0) app.calendars.push(app.Calendar({ name: a.name }));
  return JSON.stringify(true);
}`,
		{ name },
		{ app: "Calendar", timeoutMs: 60000 },
	);
}

/** Delete the e2e calendar, which removes the events created in it. */
export async function cleanupCalendar(name = E2E_CALENDAR): Promise<number> {
	assertPrefixed(name);
	return runJxa<number>(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  const app = Application("Calendar");
  let removed = 0;
  // Delete through the name specifier: Calendar rejects deletes addressed by calendar id
  const matches = app.calendars.whose({ name: a.name });
  if (matches.length > 0) {
    removed = matches[0].events.length;
    app.delete(matches[0]);
  }
  return JSON.stringify(removed);
}`,
		{ name },
		{ app: "Calendar", timeoutMs: 60000 },
	);
}

/** Count prefixed items left behind; all zero after a clean run. */
export async function residue(): Promise<{ notes: number; reminders: number; calendars: number }> {
	const notes = await runJxa<number>(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  return JSON.stringify(Application("Notes").notes.whose({ name: { _beginsWith: a.prefix } }).length);
}`,
		{ prefix: E2E_PREFIX },
		{ app: "Notes", timeoutMs: 60000 },
	);
	const reminders = await runJxa<number>(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  const app = Application("Reminders");
  return JSON.stringify(app.lists.whose({ name: { _beginsWith: a.prefix } }).length +
    app.reminders.whose({ name: { _beginsWith: a.prefix } }).length);
}`,
		{ prefix: E2E_PREFIX },
		{ app: "Reminders", timeoutMs: 90000 },
	);
	const calendars = await runJxa<number>(
		`function run(argv) {
  const a = JSON.parse(argv[0]);
  return JSON.stringify(Application("Calendar").calendars.whose({ name: { _beginsWith: a.prefix } }).length);
}`,
		{ prefix: E2E_PREFIX },
		{ app: "Calendar", timeoutMs: 60000 },
	);
	return { notes, reminders, calendars };
}
