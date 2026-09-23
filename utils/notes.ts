import { runAppleScript, runJxa } from "./osascript.js";

// Configuration
const CONFIG = {
	// Maximum notes to return
	MAX_NOTES: 50,
	// Maximum content length for previews
	MAX_CONTENT_PREVIEW: 200,
	// Notes can take several seconds to wake up its iCloud store
	TIMEOUT_MS: 45000,
};

type Note = {
	name: string;
	content: string;
	id?: string;
	folder?: string;
	creationDate?: Date;
	modificationDate?: Date;
};

type CreateNoteResult = {
	success: boolean;
	note?: Note;
	message?: string;
	folderName?: string;
	usedDefaultFolder?: boolean;
};

// Deleted notes stay in this folder for 30 days and still show up in `notes`
const RECENTLY_DELETED = "Recently Deleted";

type RawNote = { id: string; name: string; text: string; folder: string; modified: string };

/**
 * Check if Notes app is accessible
 */
async function checkNotesAccess(): Promise<boolean> {
	try {
		await runAppleScript('tell application "Notes" to return name', {
			app: "Notes",
			timeoutMs: 10000,
		});
		return true;
	} catch (error) {
		console.error(
			`Cannot access Notes app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Notes app access and provide instructions if not available
 */
async function requestNotesAccess(): Promise<{ hasAccess: boolean; message: string }> {
	const hasAccess = await checkNotesAccess();
	if (hasAccess) {
		return { hasAccess: true, message: "Notes access is already granted." };
	}
	return {
		hasAccess: false,
		message:
			"Notes access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Notes'\n3. Restart your terminal and try again\n4. If the option is not available, run this command again to trigger the permission dialog",
	};
}

/**
 * Load every note's id, title, plaintext, folder and modification date with bulk
 * Apple Events (one round trip per property, not per note), newest first.
 */
async function loadNotes(folderName?: string): Promise<RawNote[]> {
	const notes = await runJxa<RawNote[]>(
		`function run(argv) {
  const args = JSON.parse(argv[0]);
  const Notes = Application("Notes");
  let spec = Notes.notes;
  if (args.folderName) {
    const folders = Notes.folders.whose({ name: args.folderName });
    if (folders.length === 0) return JSON.stringify([]);
    spec = folders[0].notes;
  }
  const ids = spec.id();
  const names = spec.name();
  const texts = spec.plaintext();
  const modified = spec.modificationDate();
  // Map note id -> folder name with one call per folder rather than per note
  const folderOf = {};
  Notes.folders().forEach((folder) => {
    try {
      const folderName = folder.name();
      folder.notes.id().forEach((id) => { folderOf[id] = folderName; });
    } catch (e) {}
  });
  return JSON.stringify(ids.map((id, i) => ({
    id, name: names[i] || "", text: texts[i] || "", folder: folderOf[id] || "",
    modified: modified[i] ? modified[i].toISOString() : "",
  })));
}`,
		{ folderName: folderName ?? null },
		{ app: "Notes", timeoutMs: CONFIG.TIMEOUT_MS },
	);
	return notes
		.filter((n) => n.folder !== RECENTLY_DELETED)
		.sort((a, b) => b.modified.localeCompare(a.modified));
}

function toNote(raw: RawNote): Note {
	const text = raw.text.length > CONFIG.MAX_CONTENT_PREVIEW
		? `${raw.text.slice(0, CONFIG.MAX_CONTENT_PREVIEW)}...`
		: raw.text;
	return {
		id: raw.id,
		name: raw.name || "Untitled Note",
		content: text,
		folder: raw.folder,
		modificationDate: raw.modified ? new Date(raw.modified) : undefined,
	};
}

/**
 * Get the most recently modified notes (limited for output size)
 */
async function getAllNotes(): Promise<Note[]> {
	const accessResult = await requestNotesAccess();
	if (!accessResult.hasAccess) {
		throw new Error(accessResult.message);
	}
	return (await loadNotes()).slice(0, CONFIG.MAX_NOTES).map(toNote);
}

/**
 * Find notes whose title or body contains the search text (case-insensitive)
 */
async function findNote(searchText: string): Promise<Note[]> {
	if (!searchText || searchText.trim() === "") {
		return [];
	}
	const accessResult = await requestNotesAccess();
	if (!accessResult.hasAccess) {
		throw new Error(accessResult.message);
	}
	const term = searchText.toLowerCase();
	return (await loadNotes())
		.filter((n) => n.name.toLowerCase().includes(term) || n.text.toLowerCase().includes(term))
		.slice(0, CONFIG.MAX_NOTES)
		.map(toNote);
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Create a new note. Notes stores HTML, so the title becomes the heading and each
 * body line its own paragraph.
 */
async function createNote(
	title: string,
	body: string,
	folderName: string = "Claude",
): Promise<CreateNoteResult> {
	try {
		const accessResult = await requestNotesAccess();
		if (!accessResult.hasAccess) {
			return { success: false, message: accessResult.message };
		}

		if (!title || title.trim() === "") {
			return { success: false, message: "Note title cannot be empty" };
		}

		const html =
			`<div><h1>${escapeHtml(title)}</h1></div>` +
			body
				.trim()
				.split("\n")
				.map((line) => `<div>${line.trim() ? escapeHtml(line) : "<br>"}</div>`)
				.join("");

		const result = await runJxa<{ id: string; folder: string; createdFolder: boolean }>(
			`function run(argv) {
  const args = JSON.parse(argv[0]);
  const Notes = Application("Notes");
  let folders = Notes.folders.whose({ name: args.folderName });
  let createdFolder = false;
  let folder;
  if (folders.length > 0) {
    folder = folders[0];
  } else if (args.folderName === "Claude") {
    // Only the server's own default folder is created on demand
    folder = Notes.Folder({ name: args.folderName });
    Notes.defaultAccount().folders.push(folder);
    folder = Notes.defaultAccount().folders.whose({ name: args.folderName })[0];
    createdFolder = true;
  } else {
    throw new Error("Folder not found: " + args.folderName);
  }
  const note = Notes.Note({ body: args.html });
  folder.notes.push(note);
  return JSON.stringify({ id: note.id(), folder: folder.name(), createdFolder });
}`,
			{ folderName, html },
			{ app: "Notes", timeoutMs: CONFIG.TIMEOUT_MS },
		);

		return {
			success: true,
			note: { id: result.id, name: title, content: body.trim() },
			folderName: result.folder,
			usedDefaultFolder: result.createdFolder,
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to create note: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get notes from a specific folder
 */
async function getNotesFromFolder(
	folderName: string,
): Promise<{ success: boolean; notes?: Note[]; message?: string }> {
	try {
		const accessResult = await requestNotesAccess();
		if (!accessResult.hasAccess) {
			return { success: false, message: accessResult.message };
		}
		const folderExists = await runJxa<boolean>(
			`function run(argv) {
  const args = JSON.parse(argv[0]);
  return JSON.stringify(Application("Notes").folders.whose({ name: args.folderName }).length > 0);
}`,
			{ folderName },
			{ app: "Notes", timeoutMs: CONFIG.TIMEOUT_MS },
		);
		if (!folderExists) {
			return { success: false, message: "Folder not found" };
		}
		const notes = (await loadNotes(folderName)).slice(0, CONFIG.MAX_NOTES).map(toNote);
		return { success: true, notes };
	} catch (error) {
		return {
			success: false,
			message: `Failed to get notes from folder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get recent notes from a specific folder
 */
async function getRecentNotesFromFolder(
	folderName: string,
	limit: number = 5,
): Promise<{ success: boolean; notes?: Note[]; message?: string }> {
	const result = await getNotesFromFolder(folderName);
	if (result.success && result.notes) {
		return { success: true, notes: result.notes.slice(0, Math.max(0, limit)) };
	}
	return result;
}

/**
 * Get notes from a folder modified within a date range
 */
async function getNotesByDateRange(
	folderName: string,
	fromDate?: string,
	toDate?: string,
	limit: number = 20,
): Promise<{ success: boolean; notes?: Note[]; message?: string }> {
	const result = await getNotesFromFolder(folderName);
	if (!result.success || !result.notes) return result;
	const from = fromDate ? new Date(fromDate).getTime() : -Infinity;
	const to = toDate ? new Date(toDate).getTime() : Infinity;
	const notes = result.notes.filter((n) => {
		const t = n.modificationDate?.getTime();
		return t === undefined || (t >= from && t <= to);
	});
	return { success: true, notes: notes.slice(0, Math.max(0, limit)) };
}

export default {
	getAllNotes,
	findNote,
	createNote,
	getNotesFromFolder,
	getRecentNotesFromFolder,
	getNotesByDateRange,
	requestNotesAccess,
};
