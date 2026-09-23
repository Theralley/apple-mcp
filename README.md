# 🍎 Apple MCP - Better Siri that can do it all :)

> **Plot twist:** Your Mac can do more than just look pretty. Turn your Apple apps into AI superpowers!

Love this MCP? Check out supermemory MCP too - https://mcp.supermemory.ai


Click below for one click install with `.dxt`

<a href="https://github.com/supermemoryai/apple-mcp/releases/download/1.0.0/apple-mcp.dxt">
  <img  width="280" alt="Install with Claude DXT" src="https://github.com/user-attachments/assets/9b0fa2a0-a954-41ee-ac9e-da6e63fc0881" />
</a>

[![smithery badge](https://smithery.ai/badge/@Dhravya/apple-mcp)](https://smithery.ai/server/@Dhravya/apple-mcp)


<a href="https://glama.ai/mcp/servers/gq2qg6kxtu">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/gq2qg6kxtu/badge" alt="Apple Server MCP server" />
</a>

## 🤯 What Can This Thing Do?

**Basically everything you wish your Mac could do automatically (but never bothered to set up):**

### 💬 **Messages** - Because who has time to text manually?

- Send messages to anyone in your contacts (even that person you've been avoiding)
- Read your messages (finally catch up on those group chats)
- Schedule messages for later (be that organized person you pretend to be)

### 📝 **Notes** - Your brain's external hard drive

- Create notes faster than you can forget why you needed them
- Search through that digital mess you call "organized notes"
- Actually find that brilliant idea you wrote down 3 months ago

### 👥 **Contacts** - Your personal network, digitized

- Find anyone in your contacts without scrolling forever
- Get phone numbers instantly (no more "hey, what's your number again?")
- Actually use that contact database you've been building for years

### 📧 **Mail** - Email like a pro (or at least pretend to)

- Send emails with attachments, CC, BCC - the whole professional shebang
- Search through your email chaos with surgical precision
- Schedule emails for later (because 3 AM ideas shouldn't be sent at 3 AM)
- Check unread counts (prepare for existential dread)

### ⏰ **Reminders** - For humans with human memory

- Create reminders with due dates (finally remember to do things)
- Search through your reminder graveyard
- List everything you've been putting off
- Open specific reminders (face your procrastination)

### 📅 **Calendar** - Time management for the chronically late

- Create events faster than you can double-book yourself
- Search for that meeting you're definitely forgetting about
- List upcoming events (spoiler: you're probably late to something)
- Open calendar events directly (skip the app hunting)

### 🗺️ **Maps** - For people who still get lost with GPS

- Search locations (find that coffee shop with the weird name)
- Save favorites (bookmark your life's important spots)
- Get directions (finally stop asking Siri while driving)
- Create guides (be that friend who plans everything)
- Drop pins like you're claiming territory

## 🎭 The Magic of Chaining Commands

Here's where it gets spicy. You can literally say:

_"Read my conference notes, find contacts for the people I met, and send them a thank you message"_

And it just... **works**. Like actual magic, but with more code.

## 🚀 Installation (The Easy Way)

### Option 1: Smithery (For the Sophisticated)

```bash
npx -y install-mcp apple-mcp --client claude
```

For Cursor users (we see you):

```bash
npx -y install-mcp apple-mcp --client cursor
```

### Option 2: Manual Setup (For the Brave)

<details>
<summary>Click if you're feeling adventurous</summary>

First, get bun (if you don't have it already):

```bash
brew install oven-sh/bun/bun
```

Then add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bunx",
      "args": ["--no-cache", "apple-mcp@latest"]
    }
  }
}
```

</details>

## 🎬 See It In Action

Here's a step-by-step video walkthrough: https://x.com/DhravyaShah/status/1892694077679763671

(Yes, it's actually as cool as it sounds)

## 🎯 Example Commands That'll Blow Your Mind

```
"Send a message to mom saying I'll be late for dinner"
```

```
"Find all my AI research notes and email them to sarah@company.com"
```

```
"Create a reminder to call the dentist tomorrow at 2pm"
```

```
"Show me my calendar for next week and create an event for coffee with Alex on Friday"
```

```
"Find the nearest pizza place and save it to my favorites"
```

## 🛠️ Local Development (For the Tinkerers)

```bash
git clone https://github.com/dhravya/apple-mcp.git
cd apple-mcp
bun install
bun run index.ts
```

Run the checkout as an MCP server (use absolute paths):

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bun",
      "args": ["run", "/path/to/apple-mcp/index.ts"]
    }
  }
}
```

### Permissions and timeouts

- Automation: allow the host app (Terminal, iTerm, Claude) to control Contacts, Notes,
  Reminders, Calendar, Mail and Messages (System Settings > Privacy & Security > Automation).
- Messages history reads `~/Library/Messages/chat.db` read-only and needs Full Disk Access.
- Reminders and Calendar reads use EventKit when the host app has Full Access (Privacy &
  Security > Reminders / Calendars), which is fast and expands recurring events. Otherwise
  they fall back to scripting, which for Calendar can take a minute or more; pass
  `calendarName` to limit the scan.
- Every Apple Event is bounded. Tune with `APPLE_MCP_TIMEOUT_MS` (default 30000),
  `APPLE_MCP_MAIL_TIMEOUT_MS` (45000) and `APPLE_MCP_CALENDAR_TIMEOUT_MS` (90000). A slow
  app returns a "did not respond within" error instead of hanging the request.
- Read-only mode: set `APPLE_MCP_READ_ONLY=1` to block everything that sends on your
  behalf (`messages` send and schedule, `mail` send). Reads, and creating notes, reminders
  and calendar events, keep working. A blocked call returns
  "... is blocked by APPLE_MCP_READ_ONLY."

### Tests

```bash
bun run typecheck
bun run test:unit     # compile-only checks of the send scripts
bun run test:e2e      # every tool over stdio against the real apps
bun run test:skills   # skills/ frontmatter + live run of each skill's steps
bun run test          # upstream integration suite
```

The e2e and skills runs never send messages or mail, and only write to throwaway
`[mcp-e2e]` folders, lists and calendars that they delete afterwards. The upstream suite
skips its sending and Maps UI tests unless `APPLE_MCP_TEST_UNSAFE=1`.

See [skills/README.md](skills/README.md) for the Claude Code skills that ship with this repo.

Now go forth and automate your digital life! 🚀

---

_Made with ❤️ by supermemory (and honestly, claude code)_
