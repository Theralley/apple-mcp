---
name: apple-reminder-capture
description: Capture tasks and follow-ups as Apple Reminders with correct lists and due dates, and review what is open. Use when the user says "remind me to...", "add a task", "what's on my todo list", or lists several action items, and the apple-mcp server is connected.
---

# Reminder capture

## Tools

- `reminders.list` (listName) — lists with IDs, plus open reminders (soonest due first)
- `reminders.search` (searchText) — open reminders matching name or notes
- `reminders.create` (name, listName, notes, dueDate) — create one reminder
- `reminders.listById` (listId, props) — open reminders of one list
- `reminders.open` (searchText) — show a reminder in the Reminders app

## Steps

1. First use in a session: `reminders.list` to learn the list names. Several lists can
   share a name; if so, confirm with the user and use `reminders.listById` to inspect.
2. Before creating, `reminders.search` for the key words to avoid duplicates.
3. `reminders.create` with a short imperative name, `listName` set to an existing list
   (unknown names are rejected with the available list names), and `dueDate` in ISO 8601
   **with an offset**, e.g. `2026-10-01T09:00:00+02:00`. Put context in the notes parameter.
4. For several items, create them one by one and report each name, list and due time
   returned by the server. The reply includes the reminder ID.
5. Anything without a time and without an action belongs in Notes, not Reminders.
