import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Skill files reference server tools as `tool` or `tool.operation`, optionally
 * followed by the parameters used: `calendar.list` (fromDate, toDate).
 */

export const SKILLS_DIR = new URL("../../skills", import.meta.url).pathname;

export interface ToolRef {
	tool: string;
	operation?: string;
	params: string[];
}

export interface Skill {
	dir: string;
	frontmatter: Record<string, string>;
	body: string;
	refs: ToolRef[];
}

const TOOL_NAMES = ["contacts", "notes", "messages", "mail", "reminders", "calendar", "maps"];

export function parseFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
	const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) throw new Error("missing YAML frontmatter");
	const frontmatter: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const kv = line.match(/^([a-z][\w-]*):\s*(.*)$/);
		if (!kv) throw new Error(`unparseable frontmatter line: ${line}`);
		frontmatter[kv[1]] = kv[2].trim();
	}
	return { frontmatter, body: match[2] };
}

export function parseRefs(body: string): ToolRef[] {
	const refs: ToolRef[] = [];
	const pattern = /`([a-z]+)(?:\.([A-Za-z]+))?`(?: \(([A-Za-z, ]+)\))?/g;
	for (const m of body.matchAll(pattern)) {
		if (!TOOL_NAMES.includes(m[1])) continue;
		refs.push({
			tool: m[1],
			operation: m[2],
			params: m[3] ? m[3].split(",").map((p) => p.trim()).filter(Boolean) : [],
		});
	}
	return refs;
}

export function loadSkills(): Skill[] {
	return readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => {
			const text = readFileSync(join(SKILLS_DIR, d.name, "SKILL.md"), "utf8");
			const { frontmatter, body } = parseFrontmatter(text);
			return { dir: d.name, frontmatter, body, refs: parseRefs(body) };
		});
}

export function refKey(ref: { tool: string; operation?: string }): string {
	return ref.operation ? `${ref.tool}.${ref.operation}` : ref.tool;
}
