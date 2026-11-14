/**
 * Ask retrieval (owner, 2026-11): the pure selection of source-transcript
 * turns that ride an Ask turn's system prompt.
 *
 * The Ask surface is one fast model call with no tool loop — so retrieval
 * happens HERE, deterministically, before the agent build: lexical scoring
 * over the linked sessions' turns, plus pinned turns (always, with one
 * neighbor each side), plus the latest turn of each linked session as the
 * no-match fallback. No extra model call, no embedding pass.
 *
 * A "turn" is one learner message plus the assistant reply/replies that
 * follow it (the same pair the transcript indicator anchors to). Assistant
 * messages before the first learner message (the opening wake) form their
 * own turn. Only user/assistant text and compact tool-call summaries are
 * model-facing; UI-only markers and tool results never enter the prompt.
 *
 * Pure and browser-safe: the plain transcript types only. The prompt text
 * lives in src/agent/ask-agent.ts; this module owns WHAT is retrieved.
 */

import type { AskPin, AskUsedRef } from "./contracts/chat.ts";
import type { LhMessage } from "./native-messages.ts";

/** One linked teaching/practice session, as retrieval sees it. */
export interface AskSourceSession {
	chatId: string;
	title: string;
	messages: readonly LhMessage[];
}

/** One transcript turn. `text` is the model-facing rendering; `lower` is
 *  the same text lowercased for the lexical score (kept beside it so a
 *  large transcript isn't re-lowered per question term). */
export interface AskTurn {
	chatId: string;
	/** Every source message id belonging to the turn, in record order. */
	messageIds: string[];
	/** The turn's first message (the indicator anchor / click-through id). */
	anchorId: string;
	/** 0-based position among the source's turns. */
	index: number;
	text: string;
	lower: string;
}

/** The retrieval result: the formatted context block, the refs actually
 *  placed in it (the Ask answer's usage log), and the contributing source
 *  ids (for the refs-changed event). */
export interface AskRetrieval {
	context: string;
	used: AskUsedRef[];
	sourceChatIds: string[];
}

/** The selection budget. Turns are capped globally (pins first) and the
 *  rendered block is capped by characters — a cheap, stable proxy for the
 *  token budget that keeps one fast call fast. */
export const ASK_MAX_TURNS = 8;
export const ASK_MAX_CONTEXT_CHARS = 9_000;
const ASK_MAX_TURN_CHARS = 2_200;
const ASK_MAX_PIN_CHARS = 1_200;

const STOPWORDS = new Set([
	"the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
	"is", "are", "was", "were", "be", "been", "being", "it", "this", "that",
	"these", "those", "i", "you", "we", "they", "he", "she", "do", "does", "did",
	"how", "why", "what", "when", "where", "which", "who", "whom", "can", "could",
	"should", "would", "about", "from", "at", "as", "by", "if", "then", "than",
	"so", "not", "no", "yes", "my", "your", "our", "their", "me", "us", "them",
	"there", "here", "have", "has", "had", "will", "just", "also", "into", "out",
	"up", "down", "over", "under", "again", "more", "most", "some", "any", "all",
	"one", "two", "please", "tell", "explain", "mean", "means", "say", "said",
	"did", "don", "doesn", "isn", "wasn", "aren", "weren", "won", "wouldn",
]);

/** The text blocks of an assistant/user message. */
function messageText(message: LhMessage): string {
	const role = (message as { role?: string }).role;
	if (role === "user") {
		const content = (message as { content?: unknown }).content;
		return typeof content === "string" ? content : "";
	}
	if (role !== "assistant") return "";
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content as Array<Record<string, unknown>>) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		} else if (block.type === "toolCall" && typeof block.name === "string") {
			// Questions/problems are transcript content too: a learner can
			// ask why a particular quiz was posed. Compact the arguments —
			// the full tool result (grading detail) is noise here.
			const args = block.arguments;
			let brief = "";
			try {
				brief = JSON.stringify(args);
			} catch {
				brief = "";
			}
			if (brief.length > 600) brief = `${brief.slice(0, 600)}…`;
			parts.push(`[tool: ${block.name}${brief ? ` ${brief}` : ""}]`);
		}
	}
	return parts.join("\n").trim();
}

/** Group a native transcript into learner+assistant turns. Custom markers
 *  and tool results attach to the current turn (for anchoring) but never
 *  contribute text. */
export function askTurns(chatId: string, messages: readonly LhMessage[]): AskTurn[] {
	const raw: Array<Omit<AskTurn, "index" | "lower">> = [];
	for (const message of messages) {
		const role = (message as { role?: string }).role;
		if (role !== "user" && role !== "assistant") {
			// Markers/tool results belong to the turn they sit in, for the
			// click-through anchor map — but an orphan result with no turn
			// yet is scaffolding, not content.
			const turn = raw[raw.length - 1];
			if (turn) turn.messageIds.push(message.id);
			continue;
		}
		// A learner message always opens a new turn. An assistant message
		// opens one only when there is no current turn (the opening wake);
		// consecutive assistant messages are the same turn's steps.
		let turn = raw[raw.length - 1];
		if (!turn || role === "user") {
			turn = { chatId, messageIds: [], anchorId: message.id, text: "" };
			raw.push(turn);
		}
		turn.messageIds.push(message.id);
		const text = messageText(message);
		if (text) turn.text += `${role === "user" ? "Learner" : "Teacher"}: ${text}\n`;
	}
	return raw
		.filter((turn) => turn.text.trim().length > 0)
		.map((turn, index) => {
			let text = turn.text.trim();
			if (text.length > ASK_MAX_TURN_CHARS) text = `${text.slice(0, ASK_MAX_TURN_CHARS)}…`;
			return { ...turn, text, lower: text.toLowerCase(), index };
		});
}

/** Map every source message id to its turn's anchor (the first message id).
 *  The transcript uses this to hang one indicator at the start of the
 *  relevant pair, whatever message the ref names. */
export function askTurnAnchorMap(messages: readonly LhMessage[]): Map<string, string> {
	const map = new Map<string, string>();
	let anchor: string | undefined;
	for (const message of messages) {
		const role = (message as { role?: string }).role;
		if (role === "user" || (role === "assistant" && anchor === undefined)) {
			anchor = message.id;
		}
		if (anchor) map.set(message.id, anchor);
	}
	return map;
}

function queryTerms(question: string): string[] {
	const terms = new Set<string>();
	for (const raw of question.toLowerCase().split(/[^a-z0-9+#]+/)) {
		const term = raw.trim();
		if (term.length < 2 || STOPWORDS.has(term)) continue;
		terms.add(term);
	}
	return [...terms];
}

function turnHits(turn: AskTurn, terms: readonly string[]): number {
	let hits = 0;
	for (const term of terms) if (turn.lower.includes(term)) hits++;
	return hits;
}

/** Select and format the context for one Ask question. */
export function retrieveAskContext(input: {
	question: string;
	sources: readonly AskSourceSession[];
	pins: readonly AskPin[];
}): AskRetrieval {
	const sources = input.sources.filter((source) => source.messages.length > 0);
	const byChat = new Map(sources.map((source) => [source.chatId, { source, turns: askTurns(source.chatId, source.messages) }]));
	const selected = new Set<string>(); // `${chatId}:${index}`
	const selectedOrder: Array<{ chatId: string; index: number }> = [];
	const selectedTurn = (chatId: string, index: number): void => {
		const key = `${chatId}:${index}`;
		if (selected.has(key)) return;
		const entry = byChat.get(chatId);
		if (!entry || !entry.turns[index]) return;
		selected.add(key);
		selectedOrder.push({ chatId, index });
	};
	const turnIndexForMessage = (chatId: string, messageId: string): number => {
		const entry = byChat.get(chatId);
		if (!entry) return -1;
		return entry.turns.findIndex((turn) => turn.messageIds.includes(messageId));
	};

	// PINS FIRST — always in context, plus one neighboring turn each side.
	// The stored messageIds are the authoritative turn locator; a stale pin
	// whose source is gone or edited simply contributes nothing.
	for (const pin of input.pins) {
		const indexes = pin.messageIds.map((id) => turnIndexForMessage(pin.chatId, id)).filter((i) => i >= 0);
		const unique = [...new Set(indexes)];
		for (const index of unique) {
			selectedTurn(pin.chatId, index - 1);
			selectedTurn(pin.chatId, index);
			selectedTurn(pin.chatId, index + 1);
		}
	}

	// LEXICAL PASS — distinct query terms per turn; title matches add a
	// small bonus so "the entropy session" reaches that session first.
	const terms = queryTerms(input.question);
	const scored: Array<{ chatId: string; index: number; score: number }> = [];
	for (const source of sources) {
		const entry = byChat.get(source.chatId)!;
		for (const turn of entry.turns) {
			const key = `${source.chatId}:${turn.index}`;
			if (selected.has(key)) continue;
			let score = turnHits(turn, terms);
			if (score > 0 && terms.some((term) => source.title.toLowerCase().includes(term))) score += 2;
			if (score > 0) scored.push({ chatId: source.chatId, index: turn.index, score });
		}
	}
	scored.sort((a, b) => b.score - a.score || a.chatId.localeCompare(b.chatId) || a.index - b.index);

	// RECENT FALLBACK — if a linked source contributes nothing (no pin, no
	// scored turn), its latest turn is the honest answer to "what were we
	// doing?". Cap the fallback by the same global turn budget as scoring.
	for (const source of sources) {
		if (selectedOrder.length >= ASK_MAX_TURNS) break;
		const entry = byChat.get(source.chatId)!;
		if (entry.turns.length === 0) continue;
		const already = selectedOrder.some((ref) => ref.chatId === source.chatId);
		const hasHit = scored.some((hit) => hit.chatId === source.chatId);
		if (!already && !hasHit) selectedTurn(source.chatId, entry.turns.length - 1);
	}

	for (const hit of scored) {
		if (selectedOrder.length >= ASK_MAX_TURNS) break;
		selectedTurn(hit.chatId, hit.index);
	}

	// Budgeted rendering in stable source order, then turn order.
	const used: AskUsedRef[] = [];
	const sourceChatIds: string[] = [];
	const chunks: string[] = [];
	let chars = 0;
	for (const source of sources) {
		const entry = byChat.get(source.chatId)!;
		const refs = selectedOrder
			.filter((ref) => ref.chatId === source.chatId)
			.map((ref) => entry.turns[ref.index])
			.filter((turn): turn is AskTurn => turn !== undefined)
			.sort((a, b) => a.index - b.index);
		if (refs.length === 0) continue;
		const header = `### Session: ${source.title}`;
		const body = refs.map((turn) => turn.text).join("\n\n");
		const block = `${header}\n${body}`;
		if (chunks.length > 0 && chars + block.length > ASK_MAX_CONTEXT_CHARS) continue;
		chunks.push(block);
		chars += block.length;
		used.push({ chatId: source.chatId, messageIds: refs.flatMap((turn) => turn.messageIds) });
		sourceChatIds.push(source.chatId);
	}

	// Pinned passages ride verbatim — the learner pointed at THIS text, so
	// paraphrase risk is unacceptable even when the surrounding turn is in
	// the transcript block above.
	const pinChunks: string[] = [];
	for (const pin of input.pins) {
		const text = pin.text.trim();
		if (!text) continue;
		const clipped = text.length > ASK_MAX_PIN_CHARS ? `${text.slice(0, ASK_MAX_PIN_CHARS)}…` : text;
		const label = pin.label ? `${pin.label}: ` : "";
		pinChunks.push(`- ${label}${clipped}`);
	}

	const linkedLines = sources.map((source) => `- ${source.title} (${source.chatId})`);
	const context = [
		linkedLines.length > 0 ? `## Linked sessions\n${linkedLines.join("\n")}` : "",
		chunks.length > 0 ? `## Retrieved transcript passages\n\n${chunks.join("\n\n")}` : "",
		pinChunks.length > 0
			? `## Pinned passages\n\nThe learner attached these excerpts explicitly — treat them as the exact words they point to.\n\n${pinChunks.join("\n")}`
			: "",
	]
		.filter(Boolean)
		.join("\n\n");

	return { context, used, sourceChatIds: [...new Set(sourceChatIds)] };
}
