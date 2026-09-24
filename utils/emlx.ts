import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import PostalMime from "postal-mime";

/**
 * Message bodies straight from Mail's store on disk.
 *
 * Asking Mail for `content` makes it convert HTML to text with legacy WebKit on its
 * main thread (NSHTMLReader -> +[WebView initialize]): 0.35-0.7s per message, every
 * other client blocked meanwhile, and an ExcUserFault report per Mail launch. Mail
 * already keeps each message as `<id>.emlx` under ~/Library/Mail/V10, so read it
 * there and never involve Mail.
 */

const MAIL_ROOT = process.env.APPLE_MCP_MAIL_ROOT || join(homedir(), "Library/Mail/V10");
const pathCache = new Map<number, string>();

/** `Data/<digits of id/1000 reversed>/Messages`, e.g. 52102 -> "2/5/". */
export function emlxSubdir(id: number): string {
	const k = Math.floor(id / 1000);
	return k === 0 ? "" : String(k).split("").reverse().join("/") + "/";
}

let dataDirs: string[] | null = null;
let dataDirsAt = 0;

/** Every `<Box>.mbox/<uuid>/Data` folder in the Mail store, listed once and reused. */
async function mailboxDataDirs(refresh = false): Promise<string[]> {
	if (dataDirs && !refresh) return dataDirs;
	const found: string[] = [];
	const walk = async (dir: string, depth: number) => {
		if (depth > 8) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory() || e.name === "Messages" || e.name === "Attachments") continue;
			const p = join(dir, e.name);
			if (e.name === "Data") found.push(p);
			else await walk(p, depth + 1);
		}
	};
	await walk(MAIL_ROOT, 0);
	dataDirs = found;
	dataDirsAt = Date.now();
	return found;
}

async function exists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

/** Path of the .emlx (or .partial.emlx) file for a Mail message id, or null. */
export async function findEmlx(id: number): Promise<string | null> {
	const cached = pathCache.get(id);
	if (cached) return cached;
	const rel = `${emlxSubdir(id)}Messages/${id}`;
	for (let pass = 0; pass < 2; pass++) {
		// A miss may mean a mailbox created since the list was made: relist once, at most every 60s
		if (pass === 1 && Date.now() - dataDirsAt < 60_000) break;
		const dirs = await mailboxDataDirs(pass === 1);
		let partial: string | null = null;
		for (const d of dirs) {
			if (await exists(join(d, `${rel}.emlx`))) {
				const p = join(d, `${rel}.emlx`);
				pathCache.set(id, p);
				return p;
			}
			if (!partial && (await exists(join(d, `${rel}.partial.emlx`)))) partial = join(d, `${rel}.partial.emlx`);
		}
		if (partial) return partial;
	}
	return null;
}

/** The RFC 822 bytes inside an .emlx: first line is the byte count, then the message, then a plist. */
export function emlxMessageBytes(file: Uint8Array): Uint8Array {
	const nl = file.indexOf(10);
	const count = Number(new TextDecoder().decode(file.subarray(0, nl)).trim());
	const start = nl + 1;
	return Number.isFinite(count) && count > 0 ? file.subarray(start, start + count) : file.subarray(start);
}

// HTML 4 Latin-1 entities (code points 160-255, in order) plus the common typographic ones
const LATIN1 =
	"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(" ");
const ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
	ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201a",
	ldquo: "\u201c", rdquo: "\u201d", bdquo: "\u201e", hellip: "\u2026", bull: "\u2022",
	euro: "\u20ac", trade: "\u2122", zwnj: "", zwj: "",
	...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCharCode(160 + i)])),
	shy: "",
};

export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
			if (e[0] === "#") {
				const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
				return Number.isFinite(n) ? String.fromCodePoint(n) : m;
			}
			return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
		})
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Plain-text body of a raw RFC 822 message. */
export async function bodyFromRfc822(raw: Uint8Array | string): Promise<string> {
	const parsed = await PostalMime.parse(raw);
	if (parsed.text && parsed.text.trim()) return parsed.text.trim();
	return parsed.html ? htmlToText(parsed.html) : "";
}

/** Body of a Mail message read from disk, or null when the file is missing or has no body. */
export async function bodyFromDisk(id: number): Promise<string | null> {
	const path = await findEmlx(id);
	if (!path) return null;
	try {
		const body = await bodyFromRfc822(emlxMessageBytes(new Uint8Array(await readFile(path))));
		return body || (path.endsWith(".partial.emlx") ? null : "");
	} catch {
		return null;
	}
}
