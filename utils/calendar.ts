import { runAppleScript, runJxa } from "./osascript.js";

// Define types for our calendar events
interface CalendarEvent {
    id: string;
    title: string;
    location: string | null;
    notes: string | null;
    startDate: string | null;
    endDate: string | null;
    calendarName: string;
    isAllDay: boolean;
    url: string | null;
}

// Configuration for timeouts and limits
const CONFIG = {
    // Calendar scripting scans every event of every calendar for a date query, which
    // can take minutes on large calendars. EventKit answers the same query instantly.
    SCRIPTING_TIMEOUT_MS: Number(process.env.APPLE_MCP_CALENDAR_TIMEOUT_MS) || 90000,
    // Maximum number of events to return
    MAX_EVENTS: 50
};

/**
 * Reads prefer EventKit, which expands recurring events and answers in well under a
 * second. It needs Full Calendar Access for the app running this server; without it
 * (or with APPLE_MCP_DISABLE_EVENTKIT=1) reads fall back to Calendar scripting.
 */
const useEventKit = process.env.APPLE_MCP_DISABLE_EVENTKIT !== "1";

const EVENTKIT_FETCH = `
ObjC.import("EventKit");
function run(argv) {
  const args = JSON.parse(argv[0]);
  // 3 = EKAuthorizationStatusFullAccess; 4 (write-only) cannot read events
  if ($.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent) != 3) {
    return JSON.stringify({ unavailable: true });
  }
  const store = $.EKEventStore.alloc.init;
  const all = store.calendarsForEntityType($.EKEntityTypeEvent);
  const selected = $.NSMutableArray.array;
  for (let i = 0; i < all.count; i++) {
    const cal = all.objectAtIndex(i);
    if (!args.calendarName || ObjC.unwrap(cal.title) === args.calendarName) selected.addObject(cal);
  }
  if (selected.count === 0) return JSON.stringify({ events: [] });
  const predicate = store.predicateForEventsWithStartDateEndDateCalendars(
    $.NSDate.dateWithTimeIntervalSince1970(args.from / 1000),
    $.NSDate.dateWithTimeIntervalSince1970(args.to / 1000),
    selected);
  const found = store.eventsMatchingPredicate(predicate);
  const term = args.searchText ? args.searchText.toLowerCase() : null;
  const events = [];
  for (let i = 0; i < found.count; i++) {
    const e = found.objectAtIndex(i);
    const title = e.title.isNil() ? "" : ObjC.unwrap(e.title);
    const location = e.location.isNil() ? null : ObjC.unwrap(e.location);
    const notes = e.notes.isNil() ? null : ObjC.unwrap(e.notes);
    if (term && ![title, location, notes].some((v) => v && v.toLowerCase().includes(term))) continue;
    events.push({
      id: ObjC.unwrap(e.calendarItemExternalIdentifier),
      title, location, notes,
      startDate: new Date(e.startDate.timeIntervalSince1970 * 1000).toISOString(),
      endDate: new Date(e.endDate.timeIntervalSince1970 * 1000).toISOString(),
      calendarName: ObjC.unwrap(e.calendar.title),
      isAllDay: e.allDay,
      url: e.URL.isNil() ? null : ObjC.unwrap(e.URL.absoluteString),
    });
  }
  return JSON.stringify({ events });
}`;

const SCRIPTING_FETCH = `
function run(argv) {
  const args = JSON.parse(argv[0]);
  const app = Application("Calendar");
  const from = new Date(args.from);
  const to = new Date(args.to);
  const term = args.searchText ? args.searchText.toLowerCase() : null;
  const calendars = args.calendarName
    ? app.calendars.whose({ name: args.calendarName })()
    : app.calendars();
  const events = [];
  calendars.forEach((cal) => {
    const calName = cal.name();
    const matches = cal.events.whose({ _and: [
      { startDate: { _greaterThanEquals: from } },
      { startDate: { _lessThanEquals: to } },
    ] });
    const titles = matches.summary();
    if (titles.length === 0) return;
    const uids = matches.uid();
    const starts = matches.startDate();
    const ends = matches.endDate();
    const locations = matches.location();
    const notes = matches.description();
    const allDay = matches.alldayEvent();
    const urls = matches.url();
    titles.forEach((title, i) => {
      if (term && ![title, locations[i], notes[i]].some((v) => v && v.toLowerCase().includes(term))) return;
      events.push({
        id: uids[i], title: title || "", location: locations[i] || null, notes: notes[i] || null,
        startDate: starts[i] ? starts[i].toISOString() : null,
        endDate: ends[i] ? ends[i].toISOString() : null,
        calendarName: calName, isAllDay: !!allDay[i], url: urls[i] || null,
      });
    });
  });
  return JSON.stringify({ events });
}`;

function parseDate(value: string | undefined, fallback: Date, label: string): Date {
    if (!value) return fallback;
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid ${label} "${value}". Use ISO 8601, e.g. 2026-10-01T09:00:00+02:00`);
    }
    return date;
}

async function fetchEvents(opts: {
    from: Date;
    to: Date;
    searchText?: string;
    calendarName?: string;
    limit: number;
}): Promise<CalendarEvent[]> {
    const args = {
        from: opts.from.getTime(),
        to: opts.to.getTime(),
        searchText: opts.searchText ?? null,
        calendarName: opts.calendarName ?? null,
    };
    let events: CalendarEvent[] | undefined;
    if (useEventKit) {
        const result = await runJxa<{ unavailable?: boolean; events: CalendarEvent[] }>(
            EVENTKIT_FETCH, args, { app: "Calendar", timeoutMs: 30000 });
        if (!result.unavailable) events = result.events;
    }
    if (!events) {
        events = (await runJxa<{ events: CalendarEvent[] }>(SCRIPTING_FETCH, args, {
            app: "Calendar",
            timeoutMs: CONFIG.SCRIPTING_TIMEOUT_MS,
        })).events;
    }
    return events
        .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
        .slice(0, Math.min(Math.max(1, opts.limit), CONFIG.MAX_EVENTS));
}

/**
 * Check if the Calendar app is accessible
 */
async function checkCalendarAccess(): Promise<boolean> {
    try {
        await runAppleScript('tell application "Calendar" to return name', {
            app: "Calendar",
            timeoutMs: 10000,
        });
        return true;
    } catch (error) {
        console.error(`Cannot access Calendar app: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Request Calendar app access and provide instructions if not available
 */
async function requestCalendarAccess(): Promise<{ hasAccess: boolean; message: string }> {
    const hasAccess = await checkCalendarAccess();
    if (hasAccess) {
        return { hasAccess: true, message: "Calendar access is already granted." };
    }
    return {
        hasAccess: false,
        message: "Calendar access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Calendar'\n3. Alternatively, open System Settings > Privacy & Security > Calendars\n4. Add your terminal/app to the allowed applications\n5. Restart your terminal and try again"
    };
}

/**
 * Get calendar events in a specified date range
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: now)
 * @param toDate Optional end date for search range in ISO format (default: 7 days from now)
 * @param calendarName Optional calendar to restrict the query to
 */
async function getEvents(
    limit = 10,
    fromDate?: string,
    toDate?: string,
    calendarName?: string
): Promise<CalendarEvent[]> {
    const from = parseDate(fromDate, new Date(), "fromDate");
    const to = parseDate(toDate, new Date(from.getTime() + 7 * 86400000), "toDate");
    return fetchEvents({ from, to, calendarName, limit });
}

/**
 * Search for calendar events whose title, location or notes contain the search text
 * @param searchText Text to search for
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: now)
 * @param toDate Optional end date for search range in ISO format (default: 30 days from now)
 * @param calendarName Optional calendar to restrict the query to
 */
async function searchEvents(
    searchText: string,
    limit = 10,
    fromDate?: string,
    toDate?: string,
    calendarName?: string
): Promise<CalendarEvent[]> {
    const from = parseDate(fromDate, new Date(), "fromDate");
    const to = parseDate(toDate, new Date(from.getTime() + 30 * 86400000), "toDate");
    return fetchEvents({ from, to, searchText, calendarName, limit });
}

/**
 * Create a new calendar event
 * @param title Title of the event
 * @param startDate Start date/time in ISO format
 * @param endDate End date/time in ISO format
 * @param location Optional location of the event
 * @param notes Optional notes for the event
 * @param isAllDay Optional flag to create an all-day event
 * @param calendarName Optional calendar name (defaults to the first writable "Calendar", then the first writable calendar)
 */
async function createEvent(
    title: string,
    startDate: string,
    endDate: string,
    location?: string,
    notes?: string,
    isAllDay = false,
    calendarName?: string
): Promise<{ success: boolean; message: string; eventId?: string; calendarName?: string }> {
    try {
        if (!title.trim()) {
            return { success: false, message: "Event title cannot be empty" };
        }
        if (!startDate || !endDate) {
            return { success: false, message: "Start date and end date are required" };
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return {
                success: false,
                message: "Invalid date format. Please use ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)"
            };
        }
        if (end <= start) {
            return { success: false, message: "End date must be after start date" };
        }

        const result = await runJxa<{ uid: string; calendarName: string }>(
            `function run(argv) {
  const args = JSON.parse(argv[0]);
  const app = Application("Calendar");
  const writable = (cals) => cals.filter((c) => { try { return c.writable(); } catch (e) { return false; } });
  let cal;
  if (args.calendarName) {
    cal = writable(app.calendars.whose({ name: args.calendarName })())[0];
    if (!cal) throw new Error("No writable calendar named " + args.calendarName);
  } else {
    cal = writable(app.calendars.whose({ name: "Calendar" })())[0] || writable(app.calendars())[0];
    if (!cal) throw new Error("No writable calendar found");
  }
  const props = {
    summary: args.title,
    startDate: new Date(args.start),
    endDate: new Date(args.end),
    alldayEvent: args.isAllDay,
  };
  if (args.location) props.location = args.location;
  if (args.notes) props.description = args.notes;
  const event = app.Event(props);
  cal.events.push(event);
  return JSON.stringify({ uid: event.uid(), calendarName: cal.name() });
}`,
            {
                title,
                start: start.toISOString(),
                end: end.toISOString(),
                location: location ?? null,
                notes: notes ?? null,
                isAllDay: !!isAllDay,
                calendarName: calendarName ?? null,
            },
            { app: "Calendar", timeoutMs: 30000 },
        );

        return {
            success: true,
            message: `Event "${title}" created successfully in calendar "${result.calendarName}".`,
            eventId: result.uid,
            calendarName: result.calendarName,
        };
    } catch (error) {
        return {
            success: false,
            message: `Error creating event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Open a specific calendar event in the Calendar app
 * @param eventId ID (uid) of the event to open
 * @param calendarName Optional calendar to look in; searching every calendar is slow
 */
async function openEvent(
    eventId: string,
    calendarName?: string
): Promise<{ success: boolean; message: string }> {
    try {
        const title = await runJxa<string | null>(
            `function run(argv) {
  const args = JSON.parse(argv[0]);
  const app = Application("Calendar");
  const calendars = args.calendarName
    ? app.calendars.whose({ name: args.calendarName })()
    : app.calendars();
  for (const cal of calendars) {
    const matches = cal.events.whose({ uid: args.eventId });
    if (matches.length > 0) {
      const event = matches[0];
      app.activate();
      app.show(event);
      return JSON.stringify(event.summary());
    }
  }
  return JSON.stringify(null);
}`,
            { eventId, calendarName: calendarName ?? null },
            { app: "Calendar", timeoutMs: CONFIG.SCRIPTING_TIMEOUT_MS },
        );
        if (title === null) {
            return { success: false, message: `Event not found: ${eventId}` };
        }
        return { success: true, message: `Opened event "${title}" in Calendar.` };
    } catch (error) {
        return {
            success: false,
            message: `Error opening event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

const calendar = {
    searchEvents,
    openEvent,
    getEvents,
    createEvent,
    requestCalendarAccess
};

export default calendar;
