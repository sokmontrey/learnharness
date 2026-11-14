"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * Snippet → Ask thread (owner, 2026-11): the one client seam shared by the
 * transcript selection toolbar and the per-question/problem Ask buttons.
 *
 * Creating the thread and attaching its first reference is ONE server call
 * (`POST /api/chats` with kind:"ask" + link/pin), so the learner never sees
 * an empty thread appear before the snippet lands. The new thread then opens
 * directly — the question that follows is the thread's first turn.
 */

export interface AskCaptureInput {
	/** The teaching/practice session the snippet came from. */
	sourceChatId: string;
	sourceTitle: string;
	/** The source turn's message id(s) — retrieval expands to the turn. */
	messageIds: string[];
	/** The selected passage / question prompt, verbatim. */
	text: string;
	/** Optional chip label ("Quiz question", "Practice problem", …). */
	label?: string;
}

/** A one-line, bounded thread title from the captured text. */
export function askTitleFor(sourceTitle: string, text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	if (!line) return `Ask about ${sourceTitle}`;
	return `Ask: ${line.slice(0, 64)}${line.length > 64 ? "…" : ""}`;
}

/** Create the thread + first reference and return its id (null on failure). */
export async function createAskThread(input: AskCaptureInput): Promise<string | null> {
	const res = await fetch("/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: askTitleFor(input.sourceTitle, input.text),
			kind: "ask",
			ask: {
				links: [input.sourceChatId],
				pins: [
					{
						chatId: input.sourceChatId,
						messageIds: input.messageIds,
						text: input.text,
						...(input.label ? { label: input.label } : {}),
					},
				],
			},
		}),
	});
	const data = (await res.json().catch(() => null)) as { id?: string } | null;
	return res.ok && data?.id ? data.id : null;
}

/** Create an Ask thread linked to a whole session (no pin) and return its id. */
export async function createAskThreadForSession(sourceChatId: string, sourceTitle: string): Promise<string | null> {
	const res = await fetch("/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: `Ask about ${sourceTitle}`,
			kind: "ask",
			ask: { links: [sourceChatId] },
		}),
	});
	const data = (await res.json().catch(() => null)) as { id?: string } | null;
	return res.ok && data?.id ? data.id : null;
}
export function useAskCapture() {
	const router = useRouter();
	return useCallback(
		async (input: AskCaptureInput) => {
			const id = await createAskThread(input);
			if (id) router.push(`/chat/${id}`);
			return id;
		},
		[router],
	);
}
