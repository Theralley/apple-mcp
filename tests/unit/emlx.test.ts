import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "emlx-"));
process.env.APPLE_MCP_MAIL_ROOT = root;
const { bodyFromDisk, bodyFromRfc822, emlxMessageBytes, emlxSubdir, htmlToText } = await import("../../utils/emlx");

function emlx(rfc822: string): string {
	return `${Buffer.byteLength(rfc822)}\n${rfc822}<?xml version="1.0"?><plist version="1.0"><dict/></plist>`;
}
function put(box: string, id: number, rfc822: string, partial = false) {
	const dir = join(root, "ACCT", `${box}.mbox`, "UUID", "Data", emlxSubdir(id), "Messages");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${id}.${partial ? "partial." : ""}emlx`), emlx(rfc822));
}

beforeAll(() => {
	put("INBOX", 51, "Subject: a\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlain body");
	put("[Gmail].mbox/All e-post", 52102, "Subject: b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hej <b>d&auml;r</b></p><style>x{}</style><p>rad 2</p>");
	put("INBOX", 1000,
		'Subject: c\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="B"\r\n\r\n' +
		"--B\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nK=E4ra v=E4n\r\n" +
		"--B\r\nContent-Type: text/html\r\n\r\n<p>ignored</p>\r\n--B--\r\n");
	put("INBOX", 999, "Subject: d\r\nContent-Type: multipart/mixed; boundary=X\r\n\r\n--X--\r\n", true);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("emlx", () => {
	test("subdir is the reversed digits of id/1000", () => {
		expect(emlxSubdir(51)).toBe("");
		expect(emlxSubdir(999)).toBe("");
		expect(emlxSubdir(1000)).toBe("1/");
		expect(emlxSubdir(52102)).toBe("2/5/");
	});

	test("message bytes stop at the declared length, before the plist", () => {
		const bytes = emlxMessageBytes(new TextEncoder().encode(emlx("Subject: x\r\n\r\nbody")));
		expect(new TextDecoder().decode(bytes)).toBe("Subject: x\r\n\r\nbody");
	});

	test("html is turned into text", () => {
		expect(htmlToText("<p>a&amp;b</p><script>x()</script><br>c&#229;")).toBe("a&b\n\ncå");
	});

	test("bodies are read from disk in any mailbox, including nested Gmail folders", async () => {
		expect(await bodyFromDisk(51)).toBe("Plain body");
		const html = await bodyFromDisk(52102);
		expect(html).toContain("Hej där");
		expect(html).toContain("rad 2");
		expect(await bodyFromDisk(1000)).toBe("Kära vän");
	});

	test("a partial message without a body and an unknown id give null (caller falls back)", async () => {
		expect(await bodyFromDisk(999)).toBeNull();
		expect(await bodyFromDisk(424242)).toBeNull();
	});

	test("raw source fallback parses the same way", async () => {
		expect(await bodyFromRfc822("Content-Type: text/html\r\n\r\n<div>x</div>")).toBe("x");
	});

	test("no code asks Mail for message content", () => {
		const dir = join(import.meta.dir, "../../utils");
		for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
			const src = readFileSync(join(dir, f), "utf8").replace(/\/\/.*$/gm, "");
			expect({ f, hit: /\.content\(\)|content of /.test(src) }).toEqual({ f, hit: false });
		}
	});
});
