---
name: apple-contact-lookup
description: Resolve a person's name to a phone number or email address from Apple Contacts before texting, calling, emailing or reading their message history. Use whenever the user refers to someone by name ("text Anna", "email my accountant", "what did Erik send me") and the apple-mcp server is connected.
---

# Contact lookup before messaging

Never guess a phone number or address. Resolve it from Contacts first.

## Tools

- `contacts` (name) — partial, case-insensitive name match; returns `Name: phones, emails`
- `messages.read` (phoneNumber, limit) — history with one handle (phone or email)
- `messages.send` (phoneNumber, message) — sends immediately; blocked when the server runs
  with `APPLE_MCP_READ_ONLY=1`
- `mail.send` (to, subject, body) — sends immediately; blocked under `APPLE_MCP_READ_ONLY=1`

## Steps

1. Call `contacts` with the name the user gave (first name is enough).
2. Zero matches: try a shorter or alternative spelling once, then ask the user.
3. Several matches or several numbers/emails: list them and ask which one. Do not pick.
4. For "what did X say", call `messages.read` with the chosen handle. International
   numbers must keep their `+country` prefix exactly as Contacts returned it.
5. Before `messages.send` or `mail.send`, show the recipient, the exact text and ask for a
   clear yes. These calls send immediately and cannot be recalled. If the call returns
   "blocked by APPLE_MCP_READ_ONLY", do not look for another way to send: give the user
   the recipient and text to send themselves (for email, a Mail draft is fine).
