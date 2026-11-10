/**
 * THE EXPLAIN SUBAGENT'S CONTEXT WINDOW (annotation wave, owner 2026-11):
 * "quick" is the whole point — the explainer reads the LAST TWO TURNS
 * ending at the target message, never the full transcript. A turn starts
 * at a user message; "last two turns" therefore means: walk back from the
 * target past the SECOND user message found (inclusive) and stop there.
 * Pure, browser-safe — no node imports, mirrors the coverage.ts discipline
 * (text extraction only, no tool calls/results, no thinking blocks).
 */

import type { LhMessage } from "./native-messages.ts";

/** The user-facing text of a native message (string or text blocks) —
 *  same shape coverage.ts's private textOf reads, exported here since the
 *  explainer needs BOTH roles' text, not just the teacher's. */
function nativeMessageText(content: unknown): string[] {
	if (typeof content === "string") return content.trim() ? [content] : [];
	if (!Array.isArray(content)) return [];
	return content
		.filter((c): c is { type: "text"; text: string } => (c as { type?: string }).type === "text")
		.map((c) => c.text)
		.filter((t) => t.trim().length > 0);
}

/** The slice of messages making up "the last two turns" ending at (and
 *  including) `uptoId`. Returns [] when the id isn't found — the caller's
 *  signal that the target message no longer exists (e.g. an edited/
 *  deleted session) and should refuse rather than explain stale context. */
export function lastTwoTurnsSlice(messages: readonly LhMessage[], uptoId: string): LhMessage[] {
	const idx = messages.findIndex((m) => m.id === uptoId);
	if (idx === -1) return [];
	let usersSeen = 0;
	let start = 0;
	for (let i = idx; i >= 0; i--) {
		start = i;
		if ((messages[i] as { role?: string }).role === "user") {
			usersSeen++;
			if (usersSeen >= 2) break;
		}
	}
	return messages.slice(start, idx + 1);
}

/** The slice rendered as a plain labeled transcript — the explainer's
 *  ENTIRE view of the lesson (it never sees anything else, same
 *  isolation discipline as the researcher/visual-maker sub-agents). */
export function explainContextProse(slice: readonly LhMessage[]): string {
	const lines: string[] = [];
	for (const message of slice) {
		const role = (message as { role?: string }).role;
		if (role !== "user" && role !== "assistant") continue;
		const label = role === "user" ? "Learner" : "Teacher";
		for (const text of nativeMessageText((message as { content: unknown }).content)) {
			lines.push(`${label}: ${text.trim()}`);
		}
	}
	return lines.join("\n\n");
}
