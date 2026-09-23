/**
 * Read-only mode: APPLE_MCP_READ_ONLY=1 blocks every operation that sends
 * something on the user's behalf. Reads, and creating local notes, reminders
 * and calendar events, stay available. Read at call time, so the flag cannot
 * be captured before the environment is set.
 */
export const READ_ONLY_BLOCKED: Record<string, readonly string[]> = {
	messages: ["send", "schedule"],
	mail: ["send"],
};

export function isReadOnly(env: Record<string, string | undefined> = process.env): boolean {
	return /^(1|true|yes)$/i.test(env.APPLE_MCP_READ_ONLY ?? "");
}

/** The error text for a blocked call, or null when the call may run. */
export function readOnlyBlock(
	tool: string,
	operation: unknown,
	env: Record<string, string | undefined> = process.env,
): string | null {
	if (!isReadOnly(env)) return null;
	const blocked = READ_ONLY_BLOCKED[tool];
	if (!blocked || typeof operation !== "string" || !blocked.includes(operation)) return null;
	return `${tool} ${operation} is blocked by APPLE_MCP_READ_ONLY.`;
}
