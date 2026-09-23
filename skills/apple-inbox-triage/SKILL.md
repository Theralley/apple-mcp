---
name: apple-inbox-triage
description: Summarise unread and recent Apple Mail and iMessages and propose next actions. Use when the user asks "what's new in my inbox", "any unread messages", "catch me up on email", or "did X reply", and the apple-mcp server is connected.
---

# Inbox triage (read only)

## Tools

- `mail.accounts` — account names (use them for `account`)
- `mail.unread` (limit, account, mailbox) — unread mail, newest first
- `mail.latest` (account, limit, mailbox) — newest mail in one account
- `mail.search` (searchTerm, limit, account, mailbox) — subject or sender match
- `mail.mailboxes` (account) — mailbox names
- `messages.unread` (limit) — unread iMessages/SMS with sender names
- `messages.read` (phoneNumber, limit) — one conversation
- `reminders.create` (name, dueDate, listName, notes) — follow-ups the user approves

## Steps

1. `mail.accounts` once, then `mail.unread` with a small `limit` (5-10), per account if
   the user has several. Use `mail.search` for "did X reply" (sender or subject).
2. `messages.unread` (limit 10) for texts.
3. Group by urgency: needs reply today, FYI, can wait. One line each: sender, subject,
   why it matters. Do not paste whole bodies.
4. Propose follow-ups as reminders and create them only after the user agrees.
5. Never send mail or messages from this workflow; drafting text in the chat is fine.
6. Mail can be slow while it syncs. A "did not respond within" error is a timeout, not an
   empty inbox: retry once with a single `account` and a smaller `limit`.
