---
name: apple-meeting-prep
description: Prepare for an upcoming meeting from Apple Calendar, Notes, Mail and Contacts. Use when the user asks "prep me for my next meeting", "what's on my calendar tomorrow and what do I need to know", or wants a briefing before a call, and the apple-mcp server is connected.
---

# Meeting prep

## Tools

- `calendar.list` (fromDate, toDate, limit, calendarName) — events in a window
- `calendar.search` (searchText, fromDate, toDate, calendarName) — title/location/notes match
- `notes.search` (searchText) — notes mentioning the meeting topic or people
- `mail.search` (searchTerm, limit, account) — recent threads by subject or sender
- `contacts` (name) — phone/email for attendees
- `notes.create` (title, body, folderName) — optional prep note

## Steps

1. Find the meeting: `calendar.list` for the requested window (ISO 8601 with offset, e.g.
   `2026-10-01T00:00:00+02:00`), or `calendar.search` if the user named it. Pass
   `calendarName` when the user has several calendars; it is much faster.
2. From the event take title, time, location and notes. Pick 1-3 keywords (company,
   project, person).
3. `notes.search` for each keyword; `mail.search` for each keyword and attendee name
   (limit 5). Summarise only what is relevant; quote sparingly.
4. `contacts` for named attendees if the user may need to reach them.
5. Present: time and place, purpose, open items from notes and mail, people, suggested
   questions. Offer (do not auto-create) a prep note via `notes.create` in a folder the
   user names; it must be an existing folder unless it is the default `Claude` folder.
