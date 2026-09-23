import { runAppleScript, runJxa } from "./osascript.js";

// Configuration
const CONFIG = {
	// Contacts snapshot is reused for this long; one bulk fetch of ~1000 people takes ~4s
	CACHE_TTL_MS: 60000,
	TIMEOUT_MS: 30000,
};

export interface ContactRecord {
	name: string;
	phones: string[];
	emails: string[];
}

let cache: { at: number; contacts: ContactRecord[] } | null = null;

async function checkContactsAccess(): Promise<boolean> {
	try {
		await runAppleScript('tell application "Contacts" to return name', {
			app: "Contacts",
			timeoutMs: 10000,
		});
		return true;
	} catch (error) {
		console.error(
			`Cannot access Contacts app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

async function requestContactsAccess(): Promise<{ hasAccess: boolean; message: string }> {
	const hasAccess = await checkContactsAccess();
	if (hasAccess) {
		return { hasAccess: true, message: "Contacts access is already granted." };
	}
	return {
		hasAccess: false,
		message:
			"Contacts access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Contacts'\n3. Alternatively, open System Settings > Privacy & Security > Contacts\n4. Add your terminal/app to the allowed applications\n5. Restart your terminal and try again",
	};
}

/**
 * Fetch every person's name, phones and emails with three bulk Apple Events
 * instead of one round trip per contact.
 */
async function loadContacts(): Promise<ContactRecord[]> {
	if (cache && Date.now() - cache.at < CONFIG.CACHE_TTL_MS) {
		return cache.contacts;
	}
	const contacts = await runJxa<ContactRecord[]>(
		`function run() {
  const people = Application("Contacts").people;
  const names = people.name();
  const phones = people.phones.value();
  const emails = people.emails.value();
  return JSON.stringify(names.map((name, i) => ({
    name: name || "",
    phones: (phones[i] || []).filter(Boolean),
    emails: (emails[i] || []).filter(Boolean),
  })));
}`,
		null,
		{ app: "Contacts", timeoutMs: CONFIG.TIMEOUT_MS },
	);
	cache = { at: Date.now(), contacts };
	return contacts;
}

function cleanName(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/\p{Extended_Pictographic}|\p{M}/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Find contacts whose name matches. Exact matches win over prefix matches, which
 * win over substring matches.
 */
async function searchContacts(name: string): Promise<ContactRecord[]> {
	const query = cleanName(name);
	if (!query) return [];
	const all = (await loadContacts()).filter((c) => c.name);
	const exact = all.filter((c) => cleanName(c.name) === query);
	if (exact.length) return exact;
	const prefix = all.filter((c) =>
		cleanName(c.name)
			.split(" ")
			.some((word) => word.startsWith(query)),
	);
	if (prefix.length) return prefix;
	return all.filter((c) => cleanName(c.name).includes(query));
}

async function getAllNumbers(): Promise<{ [key: string]: string[] }> {
	const accessResult = await requestContactsAccess();
	if (!accessResult.hasAccess) {
		throw new Error(accessResult.message);
	}
	const phoneNumbers: { [key: string]: string[] } = {};
	for (const contact of await loadContacts()) {
		if (contact.name && contact.phones.length > 0) {
			phoneNumbers[contact.name] = [
				...(phoneNumbers[contact.name] ?? []),
				...contact.phones,
			];
		}
	}
	return phoneNumbers;
}

async function findNumber(name: string): Promise<string[]> {
	if (!name || name.trim() === "") {
		return [];
	}
	const matches = await searchContacts(name);
	return matches.flatMap((c) => c.phones);
}

function digits(phone: string): string {
	return phone.replace(/[^0-9]/g, "");
}

async function findContactByPhone(phoneNumber: string): Promise<string | null> {
	if (!phoneNumber || phoneNumber.trim() === "") {
		return null;
	}
	// iMessage handles can be email addresses
	if (phoneNumber.includes("@")) {
		const email = phoneNumber.toLowerCase();
		const hit = (await loadContacts()).find((c) =>
			c.emails.some((e) => e.toLowerCase() === email),
		);
		return hit?.name || null;
	}
	const search = digits(phoneNumber);
	if (search.length < 6) return null;
	// Compare on the trailing digits so "+46 70..." matches "070..."
	const tail = search.slice(-9);
	const hit = (await loadContacts()).find((c) =>
		c.phones.some((p) => {
			const d = digits(p);
			return d.length >= 6 && (d.endsWith(tail) || search.endsWith(d.slice(-9)));
		}),
	);
	return hit?.name || null;
}

export default {
	getAllNumbers,
	findNumber,
	findContactByPhone,
	searchContacts,
	requestContactsAccess,
};
