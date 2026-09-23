import { runAppleScript, runJxa } from "./osascript.js";

// Configuration
const CONFIG = {
	// Maximum reminders returned by list/search operations
	MAX_REMINDERS: 100,
	// Reminders scripting walks every reminder (completed ones included), so it is slow
	TIMEOUT_MS: 60000,
};

// Define types for our reminders
interface ReminderList {
	name: string;
	id: string;
}

interface Reminder {
	name: string;
	id: string;
	body: string;
	completed: boolean;
	dueDate: string | null;
	listName: string;
	listId?: string;
	completionDate?: string | null;
	creationDate?: string | null;
	modificationDate?: string | null;
	remindMeDate?: string | null;
	priority?: number;
}

/**
 * Reads prefer EventKit, which answers in well under a second, and fall back to
 * Reminders scripting (seconds per list) when the host app lacks EventKit access.
 * Set APPLE_MCP_DISABLE_EVENTKIT=1 to force the scripting path.
 */
const useEventKit = process.env.APPLE_MCP_DISABLE_EVENTKIT !== "1";

const EVENTKIT_FETCH = `
ObjC.import("EventKit");
function run(argv) {
  const args = JSON.parse(argv[0]);
  // 3 = EKAuthorizationStatusFullAccess (Authorized on older macOS)
  if ($.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeReminder) != 3) {
    return JSON.stringify({ unavailable: true });
  }
  const store = $.EKEventStore.alloc.init;
  const all = store.calendarsForEntityType($.EKEntityTypeReminder);
  const lists = [];
  const selected = $.NSMutableArray.array;
  for (let i = 0; i < all.count; i++) {
    const cal = all.objectAtIndex(i);
    const id = ObjC.unwrap(cal.calendarIdentifier);
    lists.push({ name: ObjC.unwrap(cal.title), id });
    if (!args.listId || args.listId === id) selected.addObject(cal);
  }
  if (!args.includeReminders) return JSON.stringify({ lists });
  if (selected.count === 0) return JSON.stringify({ lists, reminders: [] });
  const predicate = store.predicateForIncompleteRemindersWithDueDateStartingEndingCalendars($(), $(), selected);
  let done = false;
  let reminders = [];
  store.fetchRemindersMatchingPredicateCompletion(predicate, function (items) {
    for (let i = 0; i < items.count; i++) {
      const r = items.objectAtIndex(i);
      const due = r.dueDateComponents;
      const dueDate = due.isNil() || due.date.isNil() ? null
        : new Date(due.date.timeIntervalSince1970 * 1000).toISOString();
      reminders.push({
        name: ObjC.unwrap(r.title) || "",
        id: "x-apple-reminder://" + ObjC.unwrap(r.calendarItemIdentifier),
        body: r.notes.isNil() ? "" : ObjC.unwrap(r.notes),
        completed: false,
        dueDate,
        listName: ObjC.unwrap(r.calendar.title),
        listId: ObjC.unwrap(r.calendar.calendarIdentifier),
        priority: r.priority,
      });
    }
    done = true;
  });
  const until = $.NSDate.dateWithTimeIntervalSinceNow(20);
  while (!done && $.NSDate.date.compare(until) < 0) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
  }
  if (!done) throw new Error("EventKit reminder fetch did not complete");
  return JSON.stringify({ lists, reminders });
}`;

const SCRIPTING_FETCH = `
function run(argv) {
  const args = JSON.parse(argv[0]);
  const app = Application("Reminders");
  const names = app.lists.name();
  const ids = app.lists.id();
  const lists = names.map((name, i) => ({ name, id: ids[i] }));
  if (!args.includeReminders) return JSON.stringify({ lists });
  const reminders = [];
  lists.forEach((list, i) => {
    if (args.listId && args.listId !== list.id) return;
    const open = app.lists[i].reminders.whose({ completed: false });
    const rNames = open.name();
    const rIds = open.id();
    const rBodies = open.body();
    const rDue = open.dueDate();
    const rPriority = open.priority();
    rNames.forEach((name, j) => reminders.push({
      name: name || "",
      id: rIds[j],
      body: rBodies[j] || "",
      completed: false,
      dueDate: rDue[j] ? rDue[j].toISOString() : null,
      listName: list.name,
      listId: list.id,
      priority: rPriority[j],
    }));
  });
  return JSON.stringify({ lists, reminders });
}`;

async function fetchReminders(
	includeReminders: boolean,
	listId?: string,
): Promise<{ lists: ReminderList[]; reminders: Reminder[] }> {
	const args = { includeReminders, listId: listId ?? null };
	if (useEventKit) {
		const result = await runJxa<{
			unavailable?: boolean;
			lists: ReminderList[];
			reminders?: Reminder[];
		}>(EVENTKIT_FETCH, args, { app: "Reminders", timeoutMs: 30000 });
		if (!result.unavailable) {
			return { lists: result.lists, reminders: result.reminders ?? [] };
		}
	}
	const result = await runJxa<{ lists: ReminderList[]; reminders?: Reminder[] }>(
		SCRIPTING_FETCH,
		args,
		{ app: "Reminders", timeoutMs: CONFIG.TIMEOUT_MS },
	);
	return { lists: result.lists, reminders: result.reminders ?? [] };
}

function sortByDue(reminders: Reminder[]): Reminder[] {
	return reminders.sort((a, b) => {
		if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
		return a.dueDate ? -1 : b.dueDate ? 1 : 0;
	});
}

/**
 * Check if Reminders app is accessible
 */
async function checkRemindersAccess(): Promise<boolean> {
	try {
		await runAppleScript('tell application "Reminders" to return name', {
			app: "Reminders",
			timeoutMs: 10000,
		});
		return true;
	} catch (error) {
		console.error(
			`Cannot access Reminders app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Reminders app access and provide instructions if not available
 */
async function requestRemindersAccess(): Promise<{ hasAccess: boolean; message: string }> {
	const hasAccess = await checkRemindersAccess();
	if (hasAccess) {
		return { hasAccess: true, message: "Reminders access is already granted." };
	}
	return {
		hasAccess: false,
		message:
			"Reminders access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Reminders'\n3. Restart your terminal and try again\n4. If the option is not available, run this command again to trigger the permission dialog",
	};
}

/**
 * Get all reminder lists
 * @returns Array of reminder lists with their names and IDs
 */
async function getAllLists(): Promise<ReminderList[]> {
	return (await fetchReminders(false)).lists;
}

/**
 * Get incomplete reminders from all lists, or from the list with the given name
 * @param listName Optional list name to filter by
 * @returns Array of reminders, soonest due first
 */
async function getAllReminders(listName?: string): Promise<Reminder[]> {
	const { reminders } = await fetchReminders(true);
	const filtered = listName ? reminders.filter((r) => r.listName === listName) : reminders;
	return sortByDue(filtered).slice(0, CONFIG.MAX_REMINDERS);
}

/**
 * Search incomplete reminders by text in their name or notes (case-insensitive)
 * @param searchText Text to search for in reminder names or notes
 * @returns Array of matching reminders
 */
async function searchReminders(searchText: string): Promise<Reminder[]> {
	if (!searchText || searchText.trim() === "") {
		return [];
	}
	const term = searchText.toLowerCase();
	const { reminders } = await fetchReminders(true);
	return sortByDue(
		reminders.filter(
			(r) => r.name.toLowerCase().includes(term) || r.body.toLowerCase().includes(term),
		),
	).slice(0, CONFIG.MAX_REMINDERS);
}

/**
 * Create a new reminder
 * @param name Name of the reminder
 * @param listName Name of an existing list (defaults to the Reminders default list)
 * @param notes Optional notes for the reminder
 * @param dueDate Optional due date for the reminder (ISO string)
 * @returns The created reminder
 */
async function createReminder(
	name: string,
	listName?: string,
	notes?: string,
	dueDate?: string,
): Promise<Reminder> {
	if (!name || name.trim() === "") {
		throw new Error("Reminder name cannot be empty");
	}
	let due: string | null = null;
	if (dueDate) {
		const parsed = new Date(dueDate);
		if (isNaN(parsed.getTime())) {
			throw new Error(`Invalid due date "${dueDate}". Use ISO 8601, e.g. 2026-10-01T09:00:00+02:00`);
		}
		due = parsed.toISOString();
	}

	const result = await runJxa<{ id: string; listName: string; listId: string }>(
		`function run(argv) {
  const args = JSON.parse(argv[0]);
  const app = Application("Reminders");
  let list;
  if (args.listName) {
    const matches = app.lists.whose({ name: args.listName });
    if (matches.length === 0) {
      throw new Error("List not found: " + args.listName + ". Available lists: " + app.lists.name().join(", "));
    }
    list = matches[0];
  } else {
    list = app.defaultList();
  }
  const props = { name: args.name };
  if (args.notes) props.body = args.notes;
  if (args.due) props.dueDate = new Date(args.due);
  const reminder = app.Reminder(props);
  list.reminders.push(reminder);
  return JSON.stringify({ id: reminder.id(), listName: list.name(), listId: list.id() });
}`,
		{ name, listName: listName ?? null, notes: notes ?? null, due },
		{ app: "Reminders", timeoutMs: CONFIG.TIMEOUT_MS },
	);

	return {
		name,
		id: result.id,
		body: notes || "",
		completed: false,
		dueDate: due,
		listName: result.listName,
		listId: result.listId,
	};
}

interface OpenReminderResult {
	success: boolean;
	message: string;
	reminder?: Reminder;
}

/**
 * Open the Reminders app and show the first reminder matching the search text
 * @param searchText Text to search for in reminder names or notes
 * @returns Result of the operation
 */
async function openReminder(searchText: string): Promise<OpenReminderResult> {
	try {
		const matchingReminders = await searchReminders(searchText);
		if (matchingReminders.length === 0) {
			return { success: false, message: "No matching reminders found" };
		}
		const reminder = matchingReminders[0];
		await runJxa<boolean>(
			`function run(argv) {
  const args = JSON.parse(argv[0]);
  const app = Application("Reminders");
  app.activate();
  try { app.show(app.reminders.byId(args.id)); } catch (e) {}
  return JSON.stringify(true);
}`,
			{ id: reminder.id },
			{ app: "Reminders", timeoutMs: 15000 },
		);
		return { success: true, message: "Reminders app opened", reminder };
	} catch (error) {
		return {
			success: false,
			message: `Failed to open reminder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get incomplete reminders from a specific list by ID
 * @param listId ID of the list to get reminders from
 * @param props Properties to include (optional; all properties when omitted)
 * @returns Array of reminders
 */
async function getRemindersFromListById(
	listId: string,
	props?: string[],
): Promise<any[]> {
	const { lists, reminders } = await fetchReminders(true, listId);
	if (!lists.some((l) => l.id === listId)) {
		return [];
	}
	const sorted = sortByDue(reminders).slice(0, CONFIG.MAX_REMINDERS);
	if (!props || props.length === 0) return sorted;
	return sorted.map((r) =>
		Object.fromEntries(props.filter((p) => p in r).map((p) => [p, (r as any)[p]])),
	);
}

export default {
	getAllLists,
	getAllReminders,
	searchReminders,
	createReminder,
	openReminder,
	getRemindersFromListById,
	requestRemindersAccess,
};
