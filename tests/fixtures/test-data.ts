// Tests that send messages/mail, open Maps UI flows, or write outside the throwaway
// test containers only run with APPLE_MCP_TEST_UNSAFE=1.
export const ALLOW_UNSAFE = process.env.APPLE_MCP_TEST_UNSAFE === "1";

// Every item the tests create carries this prefix so cleanup can find exactly it.
export const TEST_PREFIX = "[mcp-e2e]";

export const TEST_DATA = {
	// Test phone number for all messaging and contact tests
	PHONE_NUMBER: "+1 9999999999",

	// Test contact data
	CONTACT: {
		name: "Test Contact Claude",
		phoneNumber: "+1 9999999999",
	},

	// Test note data
	NOTES: {
		folderName: "[mcp-e2e] Test-Claude",
		testNote: {
			title: "[mcp-e2e] Claude Test Note",
			body: "This is a test note created by Claude for testing purposes. Please do not delete manually.",
		},
		searchTestNote: {
			title: "[mcp-e2e] Search Test Note",
			body: "This note contains the keyword SEARCHABLE for testing search functionality.",
		},
	},

	// Test reminder data
	REMINDERS: {
		listName: "[mcp-e2e] Test-Claude-Reminders",
		testReminder: {
			name: "[mcp-e2e] Claude Test Reminder",
			notes: "This is a test reminder created by Claude",
		},
	},

	// Test calendar data
	CALENDAR: {
		calendarName: "[mcp-e2e] Test-Claude-Calendar",
		testEvent: {
			title: "[mcp-e2e] Claude Test Event",
			location: "Test Location",
			notes: "This is a test calendar event created by Claude",
		},
	},

	// Test mail data
	MAIL: {
		testSubject: "Claude MCP Test Email",
		testBody: "This is a test email sent by Claude MCP for testing purposes.",
		testEmailAddress: "test@example.com",
	},

	// Test web search data
	WEB_SEARCH: {
		testQuery: "OpenAI Claude AI assistant",
		expectedResultsCount: 1, // Minimum expected results
	},

	// Test maps data
	MAPS: {
		testLocation: {
			name: "Apple Park",
			address: "One Apple Park Way, Cupertino, CA 95014",
		},
		testGuideName: "Claude Test Guide",
		testDirections: {
			from: "Apple Park, Cupertino, CA",
			to: "Googleplex, Mountain View, CA",
		},
	},
} as const;

export type TestData = typeof TEST_DATA;
