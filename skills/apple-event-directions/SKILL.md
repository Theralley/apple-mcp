---
name: apple-event-directions
description: Work out travel time and directions to a calendar event or place with Apple Maps, and optionally set a leave-by reminder. Use when the user asks "how long to get to my 3pm", "when should I leave", "directions to ...", or "find a cafe near ...", and the apple-mcp server is connected.
---

# Directions for an event

## Tools

- `calendar.search` (searchText, fromDate, toDate, calendarName) — find the event
- `calendar.list` (fromDate, toDate, limit) — or take the next event
- `maps.search` (query, limit) — places with address and coordinates
- `maps.directions` (fromAddress, toAddress, transportType) — distance and travel time
- `reminders.create` (name, dueDate, listName) — optional leave-by reminder

## Steps

1. Get the event and its `Location`. No location: ask for it or use `maps.search` on the
   event title plus city.
2. Ask for (or reuse) the starting point; do not assume the current location.
3. `maps.directions` with `transportType` `driving`, `walking` or `transit`. The reply
   gives km, minutes and an Apple Maps link; share the link.
4. Leave-by time = event start - travel time - buffer (10 min driving/walking, 15 min
   transit). Offer `reminders.create` due at that time, with the offset (e.g.
   `+02:00`) and the Maps link in the notes.
5. `maps.search` is for finding places only; saving favourites, pins and guides just opens
   the Maps app and is not automated.
