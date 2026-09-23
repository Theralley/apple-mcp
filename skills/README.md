# apple-mcp skills

Claude Code skills that drive this server's tools for common workflows. Each skill is a
folder with a `SKILL.md` (YAML frontmatter `name` + `description`, then the steps).

| Skill | Use it for |
| --- | --- |
| `apple-contact-lookup` | Resolve a name to a phone/email before texting, mailing or reading a thread |
| `apple-meeting-prep` | Brief an upcoming meeting from Calendar, Notes, Mail and Contacts |
| `apple-reminder-capture` | Turn action items into Reminders with the right list and due date |
| `apple-notes-capture` | Search Notes and save new reference notes |
| `apple-event-directions` | Travel time to an event, leave-by reminder |
| `apple-inbox-triage` | Summarise unread mail and iMessages (read only) |
| `apple-mcp-troubleshooting` | Permission errors, timeouts, slow calendar reads |

The skills assume the server is registered under the name `apple-mcp`, so its tools appear
as `mcp__apple-mcp__contacts`, `mcp__apple-mcp__calendar`, and so on. In a skill,
`calendar.list` means the `calendar` tool with `operation: "list"`.

## Install

Personal skills live in `~/.claude/skills/<name>/SKILL.md`. Symlink them so they follow
this checkout:

```bash
cd /path/to/apple-mcp
for d in skills/*/; do ln -sfn "$PWD/$d" ~/.claude/skills/"$(basename "$d")"; done
```

Or copy them (`cp -R skills/apple-* ~/.claude/skills/`), or into a project's
`.claude/skills/` to scope them to one repository. Claude Code picks up new skills in a
new session.

To ship them as a plugin instead, put this folder next to a `.claude-plugin/plugin.json`
in a plugin repository; Claude Code loads `skills/*/SKILL.md` from installed plugins.

## Tests

```bash
bun run test:skills
```

- `tests/skills/skills.test.ts` starts the server, reads `tools/list`, and checks every
  skill's frontmatter and that each `tool.operation` (and each listed parameter) exists.
- `tests/skills/run-skills.ts` runs each skill's steps against the real apps. Reads run
  as written; writes go only to throwaway `[mcp-e2e]` folders/lists/calendars that are
  deleted afterwards; `messages.send` and `mail.send` are never run. It prints counts
  and timings, not your data.
