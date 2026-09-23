import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { McpStdioClient } from "../e2e/mcp-client.js";
import { loadSkills, refKey } from "./parse.js";

/**
 * Static checks for skills/: frontmatter is valid and every tool, operation and
 * parameter a skill names exists in the live server's tools/list.
 */

const client = new McpStdioClient("bun", ["run", "index.ts"], new URL("../..", import.meta.url).pathname);
let tools: any[] = [];

beforeAll(async () => {
	await client.start();
	tools = await client.listTools();
});

afterAll(async () => {
	await client.stop();
});

const skills = loadSkills();

describe("skills library", () => {
	it("has 5-7 skills", () => {
		expect(skills.length).toBeGreaterThanOrEqual(5);
		expect(skills.length).toBeLessThanOrEqual(7);
	});

	for (const skill of skills) {
		describe(skill.dir, () => {
			it("has valid frontmatter", () => {
				expect(Object.keys(skill.frontmatter).sort()).toEqual(["description", "name"]);
				expect(skill.frontmatter.name).toBe(skill.dir);
				expect(skill.frontmatter.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
				expect(skill.frontmatter.name.length).toBeLessThanOrEqual(64);
				const description = skill.frontmatter.description;
				expect(description.length).toBeGreaterThan(40);
				expect(description.length).toBeLessThanOrEqual(1024);
				// Descriptions must say when to trigger
				expect(description).toMatch(/\b(Use when|Use whenever)\b/);
			});

			it("references tools", () => {
				expect(skill.refs.length).toBeGreaterThan(0);
			});

			it("references only live tools, operations and parameters", () => {
				for (const ref of skill.refs) {
					const tool = tools.find((t) => t.name === ref.tool);
					expect(tool, `unknown tool ${ref.tool}`).toBeDefined();
					const props = tool.inputSchema.properties ?? {};
					if (ref.operation) {
						expect(props.operation?.enum ?? [], `unknown operation ${refKey(ref)}`).toContain(ref.operation);
					}
					for (const param of ref.params) {
						expect(Object.keys(props), `unknown param ${param} of ${refKey(ref)}`).toContain(param);
					}
				}
			});
		});
	}
});
