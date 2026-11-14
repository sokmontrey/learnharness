/**
 * Ask retrieval pins (owner, 2026-11): the pure, deterministic selection of
 * source-transcript turns that ride an Ask turn's system prompt.
 *
 * Ask is ONE fast model call — no tool loop, no selector model — so this
 * module carries the whole grounding contract: turn grouping (one learner
 * message + its assistant replies), the indicator anchor map, pins-first
 * selection with one neighboring turn each side, lexical scoring, and the
 * latest-turn fallback. Pure: plain native transcripts in, a context block
 * and usage refs out.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ASK_MAX_TURNS,
	askTurnAnchorMap,
	askTurns,
	retrieveAskContext,
	type AskSourceSession,
} from "../src/core/ask-context.ts";
import type { AskPin } from "../src/core/contracts/chat.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

let serial = 0;
const nextId = (prefix: string) => `${prefix}${++serial}`;

const user = (text: string): LhMessage =>
	({ id: nextId("u"), role: "user", content: text, timestamp: 1 }) as LhMessage;

const assistant = (...texts: string[]): LhMessage =>
	({
		id: nextId("a"),
		role: "assistant",
		content: texts.map((text) => ({ type: "text", text })),
		timestamp: 1,
	}) as LhMessage;

const marker = (): LhMessage =>
	({
		id: nextId("m"),
		role: "custom",
		customType: "graph-context",
		content: "scaffolding",
		display: false,
		details: {},
		timestamp: 1,
	}) as LhMessage;

const pin = (chatId: string, messageIds: string[], text: string, label?: string): AskPin => ({
	id: nextId("pin"),
	chatId,
	messageIds,
	text,
	...(label ? { label } : {}),
	createdAt: "2026-01-01T00:00:00.000Z",
});

const session = (chatId: string, title: string, messages: LhMessage[]): AskSourceSession => ({
	chatId,
	title,
	messages,
});

describe("askTurns — the turn grouping (learner message + its replies)", () => {
	it("one learner message plus consecutive assistant steps form ONE turn", () => {
		const u = user("What is entropy?");
		const a1 = assistant("A measure of disorder.");
		const a2 = assistant("It counts microstates.");
		const turns = askTurns("c1", [u, a1, a2]);
		assert.equal(turns.length, 1);
		assert.deepEqual(turns[0]!.messageIds, [u.id, a1.id, a2.id]);
		assert.equal(turns[0]!.anchorId, u.id, "the learner message anchors the turn");
		assert.match(turns[0]!.text, /Learner: What is entropy\?/);
		assert.match(turns[0]!.text, /Teacher: A measure of disorder\./);
		assert.match(turns[0]!.text, /Teacher: It counts microstates\./);
	});

	it("a learner message always OPENS a new turn; assistants stay in it", () => {
		const u1 = user("first");
		const a1 = assistant("one");
		const u2 = user("second");
		const a2 = assistant("two");
		const turns = askTurns("c1", [u1, a1, u2, a2]);
		assert.equal(turns.length, 2);
		assert.deepEqual(turns[0]!.messageIds, [u1.id, a1.id]);
		assert.deepEqual(turns[1]!.messageIds, [u2.id, a2.id]);
		assert.equal(turns[1]!.index, 1);
	});

	it("an assistant message before the first learner message opens its own turn (the opening wake)", () => {
		const wake = assistant("Welcome — let's probe.");
		const u = user("ready");
		const turns = askTurns("c1", [wake, u]);
		assert.equal(turns.length, 2);
		assert.equal(turns[0]!.anchorId, wake.id);
		assert.equal(turns[1]!.anchorId, u.id);
	});

	it("markers and tool results attach to the current turn for anchoring but add no text", () => {
		const u = user("posed");
		const a = assistant("here is a check");
		const m = marker();
		const turns = askTurns("c1", [u, a, m]);
		assert.equal(turns.length, 1);
		assert.deepEqual(turns[0]!.messageIds, [u.id, a.id, m.id]);
		assert.ok(!turns[0]!.text.includes("scaffolding"), "marker text never reaches the model");
	});

	it("a textless turn is dropped (orphan scaffolding before any conversation)", () => {
		const turns = askTurns("c1", [marker()]);
		assert.deepEqual(turns, []);
	});

	it("turn text is lowercased once beside the original (the lexical seam)", () => {
		const turns = askTurns("c1", [user("Mixed CASE")]);
		assert.equal(turns[0]!.lower, turns[0]!.text.toLowerCase());
	});
});

describe("askTurnAnchorMap — every id maps to its turn's first message", () => {
	it("user, assistant steps, and markers all share the learner-message anchor", () => {
		const u = user("q");
		const a1 = assistant("a1");
		const a2 = assistant("a2");
		const m = marker();
		const map = askTurnAnchorMap([u, a1, a2, m]);
		for (const id of [u.id, a1.id, a2.id, m.id]) assert.equal(map.get(id), u.id);
	});

	it("the opening wake anchors assistant messages that precede any learner message", () => {
		const wake = assistant("hello");
		const u = user("hi");
		const map = askTurnAnchorMap([wake, u]);
		assert.equal(map.get(wake.id), wake.id);
		assert.equal(map.get(u.id), u.id);
	});

	it("a scaffold marker before any message stays unmapped (no turn to anchor it)", () => {
		const m = marker();
		const u = user("q");
		const map = askTurnAnchorMap([m, u]);
		assert.equal(map.get(m.id), undefined, "orphan scaffolding never gets an indicator anchor");
		assert.equal(map.get(u.id), u.id);
	});
});

describe("retrieveAskContext — pins, lexical match, fallback", () => {
	it("no sources and no pins → empty context, no usage (honestly ungrounded)", () => {
		const out = retrieveAskContext({ question: "anything", sources: [], pins: [] });
		assert.equal(out.context, "");
		assert.deepEqual(out.used, []);
		assert.deepEqual(out.sourceChatIds, []);
	});

	it("a pin selects its turn plus ONE neighbor each side — never the whole transcript", () => {
		const u1 = user("turn one question");
		const a1 = assistant("turn one answer about entropy");
		const u2 = user("turn two question");
		const a2 = assistant("turn two answer about the second law");
		const u3 = user("turn three question");
		const a3 = assistant("turn three answer about photosynthesis");
		const source = session("src", "Thermodynamics", [u1, a1, u2, a2, u3, a3]);
		const pinned = pin("src", [a1.id], "Entropy is disorder.", "Selected passage");

		const out = retrieveAskContext({ question: "why?", sources: [source], pins: [pinned] });

		// Pin (turn 0) + turn 1 neighbor; the distant turn 2 stays out.
		assert.match(out.context, /turn one answer about entropy/);
		assert.match(out.context, /turn two answer about the second law/);
		assert.ok(!out.context.includes("photosynthesis"), "a far turn never rides a pin");

		// Pinned text rides verbatim, labeled, under its own section.
		assert.match(out.context, /## Pinned passages/);
		assert.match(out.context, /Selected passage: Entropy is disorder\./);
		assert.match(out.context, /### Session: Thermodynamics/);

		assert.equal(out.used.length, 1);
		assert.equal(out.used[0]!.chatId, "src");
		assert.deepEqual(new Set(out.used[0]!.messageIds), new Set([u1.id, a1.id, u2.id, a2.id]));
		assert.deepEqual(out.sourceChatIds, ["src"]);
	});

	it("a lexical match selects the relevant turn (and leaves unrelated turns out)", () => {
		const u1 = user("What is entropy?");
		const a1 = assistant("Disorder.");
		const u2 = user("Explain photosynthesis.");
		const a2 = assistant("Plants convert light to sugar.");
		const source = session("src", "Biology", [u1, a1, u2, a2]);

		const out = retrieveAskContext({ question: "photosynthesis again", sources: [source], pins: [] });

		assert.match(out.context, /Plants convert light to sugar/);
		assert.match(out.context, /Explain photosynthesis/);
		assert.ok(!out.context.includes("Disorder."), "unmatched turns stay out");
		assert.deepEqual(new Set(out.used[0]!.messageIds), new Set([u2.id, a2.id]));
	});

	it("a session with no pin and no match falls back to its latest turn", () => {
		const u1 = user("first question");
		const a1 = assistant("first answer");
		const u2 = user("last question");
		const a2 = assistant("last answer");
		const source = session("src", "Session", [u1, a1, u2, a2]);

		const out = retrieveAskContext({ question: "zzz unrelated zzz", sources: [source], pins: [] });

		assert.match(out.context, /last question/);
		assert.match(out.context, /last answer/);
		assert.ok(!out.context.includes("first answer"));
	});

	it("the global turn budget caps selection (pins first, then scored turns)", () => {
		const messages: LhMessage[] = [];
		for (let i = 0; i < ASK_MAX_TURNS + 4; i++) {
			messages.push(user(`alpha question ${i}`));
			messages.push(assistant(`alpha answer ${i}`));
		}
		const source = session("src", "Alpha", messages);

		const out = retrieveAskContext({ question: "alpha", sources: [source], pins: [] });

		// Each selected turn contributes its two ids.
		assert.equal(out.used[0]!.messageIds.length, ASK_MAX_TURNS * 2);
	});

	it("a stale pin whose source is gone selects no turn but its stored excerpt still rides", () => {
		const u = user("q");
		const a = assistant("a");
		const source = session("src", "Session", [u, a]);
		const stale = pin("missing-chat", ["nope"], "gone excerpt");

		const out = retrieveAskContext({ question: "zzz", sources: [source], pins: [stale] });
		// No turn is selected from the missing id; the linked source still
		// falls back to its latest turn.
		assert.equal(out.used.length, 1);
		assert.equal(out.used[0]!.chatId, "src");
		assert.deepEqual(new Set(out.used[0]!.messageIds), new Set([u.id, a.id]));
		// The excerpt itself is the learner's stored selection — it rides
		// verbatim even when the live source is unavailable.
		assert.match(out.context, /gone excerpt/);
	});

	it("linked sessions are listed by title and id", () => {
		const source = session("s1", "Calculus review", [user("What is a derivative?")]);
		const out = retrieveAskContext({ question: "", sources: [source], pins: [] });
		assert.match(out.context, /## Linked sessions/);
		assert.match(out.context, /- Calculus review \(s1\)/);
		assert.deepEqual(out.used[0]!.chatId, "s1");
	});

	it("a source with no messages never contributes (nothing to retrieve)", () => {
		const out = retrieveAskContext({
			question: "",
			sources: [session("s1", "Empty session", [])],
			pins: [],
		});
		assert.equal(out.context, "");
		assert.deepEqual(out.used, []);
	});

	it("title matches add a small score bonus across sessions", () => {
		// Two linked sessions both contain the term; the titled one is
		// selected first when the budget cannot hold both. Without the
		// bonus, equal scores tie-break by chat id ("s-plain" wins).
		const many = (token: string) => {
			const out: LhMessage[] = [];
			for (let i = 0; i < 5; i++) {
				out.push(user(`${token} question ${i}`));
				out.push(assistant(`${token} answer ${i}`));
			}
			return out;
		};
		const titled = session("s-titled", "Entropy session", many("entropy"));
		const untitled = session("s-plain", "Misc notes", many("entropy"));

		const out = retrieveAskContext({ question: "entropy", sources: [titled, untitled], pins: [] });
		const usedIds = out.used.flatMap((u) => u.messageIds);
		assert.equal(usedIds.length, ASK_MAX_TURNS * 2, "the global cap holds");
		const titledUsed = out.used.find((u) => u.chatId === "s-titled")!;
		const plainUsed = out.used.find((u) => u.chatId === "s-plain")!;
		assert.equal(titledUsed.messageIds.length, 10, "the titled session keeps all five turns");
		assert.equal(plainUsed.messageIds.length, 6, "the untitled session only fills the leftover budget");
	});
});
