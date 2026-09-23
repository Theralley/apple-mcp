---
name: apple-notes-capture
description: Find information in Apple Notes and save new reference notes. Use when the user asks "do I have a note about...", "find my notes on...", "save this to Notes", or wants meeting minutes or research kept for later, and the apple-mcp server is connected.
---

# Notes search and capture

## Tools

- `notes.search` (searchText) — case-insensitive match on title and body; newest first
- `notes.list` — the 50 most recently modified notes with folder and ID
- `notes.create` (title, body, folderName) — new note; title becomes the heading

## Steps

1. Search with 1-2 distinctive words via `notes.search`; widen or narrow once if the
   result is empty or too broad. `notes.list` answers "what did I write recently".
2. Results show a 200-character preview. Quote only what answers the question.
3. To save: `notes.create` with a descriptive title and plain-text body (one line per
   paragraph). `folderName` must be an existing folder; the default `Claude` folder is
   created on first use. Report the folder and note ID from the reply.
4. The server cannot edit, append to or delete notes. To "add" to a note, create a new
   one with a clear title (e.g. "Project X - follow-up 2026-10-01") and say so.
