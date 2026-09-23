---
name: apple-mcp-troubleshooting
description: Diagnose apple-mcp failures - permission errors, timeouts, empty results, slow calendar reads. Use when an apple-mcp tool returns "Not authorized", "did not respond within", "access is required", unexpectedly empty results, or the server will not start.
---

# apple-mcp troubleshooting

## Tools

- `contacts` (name) — cheapest Contacts probe
- `notes.list` — Notes probe
- `reminders.list` — Reminders probe
- `calendar.list` (fromDate, toDate, calendarName) — Calendar probe
- `mail.accounts` — Mail probe
- `messages.unread` (limit) — Messages database probe
- `maps.search` (query) — MapKit probe (no permission needed)

## Steps

1. Probe each app with the calls above and note which fail and how.
2. "Not authorized to control X" or "access is required": System Settings > Privacy &
   Security > Automation, enable X for the app that runs the server (Terminal, iTerm,
   Claude). Restart that app.
3. `messages.*` errors about the database: grant Full Disk Access to that same app; the
   server reads `~/Library/Messages/chat.db` read-only.
4. Calendar reads are slow (tens of seconds, timeouts) without Full Calendar access:
   Privacy & Security > Calendars > set the host app to "Full Access" (not "Add Events
   Only"). Until then pass `calendarName` to `calendar.list`/`calendar.search`. Reminders
   reads are fast with Full Access under Privacy & Security > Reminders.
5. "did not respond within Ns": the app is busy (Mail syncing, Notes waking iCloud,
   another script driving the app). Retry once; raise `APPLE_MCP_TIMEOUT_MS`,
   `APPLE_MCP_MAIL_TIMEOUT_MS` or `APPLE_MCP_CALENDAR_TIMEOUT_MS` in the server's env.
6. Server does not start: `bun --version` must work (install with
   `brew install oven-sh/bun/bun`), then run `bun run index.ts` in the repo and read stderr.
