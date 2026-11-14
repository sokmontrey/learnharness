/**
 * Ask server seam (owner, 2026-11): the bridge between the persisted Ask
 * context and the three consumers —
 *
 *   - the Ask turn (retrieval sources + the answer's usage log),
 *   - the Ask surface (link/pin chips with resolved session titles),
 *   - the teaching/practice transcript (ask-refs indicators).
 *
 * Reads go through the ChatStore port only; no agent imports, no React.
 */

import { retrieveAskContext, type AskRetrieval, type AskSourceSession } from "../core/ask-context.ts";
import type { AskContext, AskContextView, AskPin, AskThreadRef, ChatRecord } from "../core/contracts.ts";
import { stores } from "./stores.ts";

/** Resolve one Ask record's context for the UI. Missing source sessions are
 *  marked, not dropped — the record is the truth. */
export function askContextView(ask: ChatRecord): AskContextView {
	const ctx = ask.ask ?? {};
	const links = (ctx.links ?? []).map((link) => {
		const source = stores.chatStore.getChat(link.chatId);
		return {
			chatId: link.chatId,
			title: source?.title ?? "Missing session",
			missing: !source,
			linkedAt: link.linkedAt,
		};
	});
	return { links, pins: ctx.pins ?? [] };
}

/** The source transcripts retrieval can read: linked sessions first, plus
 *  any pinned session that somehow is not linked (defensive — the store
 *  auto-links on pin). Missing sources are skipped. */
export function askSourcesFor(ask: ChatRecord): AskSourceSession[] {
	const ctx: AskContext = ask.ask ?? {};
	const ids = new Set<string>();
	for (const link of ctx.links ?? []) ids.add(link.chatId);
	for (const pin of ctx.pins ?? []) ids.add(pin.chatId);
	const sources: AskSourceSession[] = [];
	for (const id of ids) {
		if (id === ask.id) continue;
		const record = stores.chatStore.getChat(id);
		if (!record) continue;
		sources.push({ chatId: record.id, title: record.title, messages: record.messages });
	}
	return sources;
}

/** Run retrieval for one Ask question against the record's current links and
 *  pins. The handler calls this once per turn, immediately before the agent
 *  build, so a link added mid-thread is visible on the next question. */
export function askRetrievalFor(ask: ChatRecord, question: string): AskRetrieval {
	return retrieveAskContext({ question, sources: askSourcesFor(ask), pins: ask.ask?.pins ?? [] });
}

/** A pin payload as it arrives from the network. */
export interface AskPinInput {
	chatId: string;
	messageIds: string[];
	text: string;
	label?: string;
}

/** Validate one pin payload. The message ids are the turn locator; text is
 *  what the learner saw selected. Over-long text is clipped rather than
 *  rejected (the learner's selection can legitimately be a long paragraph).
 */
export function parseAskPinInput(raw: unknown): AskPinInput | null {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.chatId !== "string" || !r.chatId) return null;
	const ids = Array.isArray(r.messageIds)
		? [...new Set(r.messageIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 24)
		: [];
	if (ids.length === 0) return null;
	if (typeof r.text !== "string" || !r.text.trim()) return null;
	return {
		chatId: r.chatId,
		messageIds: ids,
		text: r.text.slice(0, 4_000),
		...(typeof r.label === "string" && r.label.trim() ? { label: r.label.trim().slice(0, 160) } : {}),
	};
}

/** A link is valid only when the source exists and is a real teaching or
 *  practice session (Ask threads never link Ask threads). */
export function isAskSourceChat(chatId: string): boolean {
	const record = stores.chatStore.getChat(chatId);
	const kind = record?.kind ?? "teach";
	return !!record && (kind === "teach" || kind === "practice");
}

/** The persisted pin for a validated input (identity + timestamp minted at
 *  the write seam so clients cannot collide pins). */
export function makeAskPin(input: AskPinInput): AskPin {
	return {
		id: `pin_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		chatId: input.chatId,
		messageIds: input.messageIds,
		text: input.text,
		...(input.label ? { label: input.label } : {}),
		createdAt: new Date().toISOString(),
	};
}

/** Every referring Ask thread for one source chat — pins and per-answer
 *  usages. Links alone do not point at a turn, so they produce no indicator.
 *  The client merges entries at the turn anchor (a turn can be both pinned
 *  and used by the same thread). */
export function askRefsFor(sourceChatId: string): AskThreadRef[] {
	const refs: AskThreadRef[] = [];
	for (const summary of stores.chatStore.listChats()) {
		if (summary.kind !== "ask") continue;
		const ask = stores.chatStore.getChat(summary.id);
		if (!ask) continue;
		const ctx = ask.ask ?? {};
		// Latest answer per used source turn wins for click-through.
		const usedAnswer = new Map<string, string>();
		for (const usage of ctx.usages ?? []) {
			for (const used of usage.used) {
				if (used.chatId !== sourceChatId) continue;
				for (const id of used.messageIds) usedAnswer.set(id, usage.messageId);
			}
		}
		for (const pin of ctx.pins ?? []) {
			if (pin.chatId !== sourceChatId) continue;
			const answerMessageId = pin.messageIds.map((id) => usedAnswer.get(id)).find(Boolean);
			refs.push({
				askChatId: ask.id,
				askTitle: ask.title,
				sourceChatId,
				messageIds: pin.messageIds,
				reason: "pinned",
				...(answerMessageId ? { answerMessageId } : {}),
			});
		}
		for (const usage of ctx.usages ?? []) {
			for (const used of usage.used) {
				if (used.chatId !== sourceChatId) continue;
				refs.push({
					askChatId: ask.id,
					askTitle: ask.title,
					sourceChatId,
					messageIds: used.messageIds,
					reason: "used",
					answerMessageId: usage.messageId,
				});
			}
		}
	}
	return refs;
}

/** Ask threads that reference a given source chat — either linked or pinned.
 *  Used by the session-level Ask popover ("Ask history"). Each entry carries
 *  the thread's title and how many references (pins + used turns) it has to
 *  the source, so the popover can rank and label them. */
export interface AskThreadSummary {
	askChatId: string;
	title: string;
	refs: number;
	pinned: number;
}

export function askThreadsForSource(sourceChatId: string): AskThreadSummary[] {
	const out: AskThreadSummary[] = [];
	for (const summary of stores.chatStore.listChats()) {
		if (summary.kind !== "ask") continue;
		const ask = stores.chatStore.getChat(summary.id);
		if (!ask) continue;
		const ctx = ask.ask ?? {};
		const linked = (ctx.links ?? []).some((l) => l.chatId === sourceChatId);
		const pins = (ctx.pins ?? []).filter((p) => p.chatId === sourceChatId);
		let usedCount = 0;
		for (const usage of ctx.usages ?? []) {
			for (const used of usage.used) {
				if (used.chatId === sourceChatId) usedCount += used.messageIds.length;
			}
		}
		if (!linked && pins.length === 0 && usedCount === 0) continue;
		out.push({
			askChatId: ask.id,
			title: ask.title,
			refs: pins.length + usedCount,
			pinned: pins.length,
		});
	}
	return out;
}
export function pruneAskSources(sourceChatId: string): void {
	for (const summary of stores.chatStore.listChats()) {
		if (summary.kind !== "ask") continue;
		const ask = stores.chatStore.getChat(summary.id);
		if (!ask) continue;
		const ctx = ask.ask ?? {};
		const linked = (ctx.links ?? []).some((link) => link.chatId === sourceChatId);
		const pinned = (ctx.pins ?? []).some((pin) => pin.chatId === sourceChatId);
		if (linked || pinned) stores.chatStore.removeAskSource(ask.id, sourceChatId);
	}
}
