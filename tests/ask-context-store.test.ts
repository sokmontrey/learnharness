/**
 * Ask server-seam pins (owner, 2026-11): the bridge between persisted Ask
 * context and its three consumers — the Ask turn (retrieval sources), the
 * Ask surface (resolved chips), and the teaching/practice transcript
 * (indicator refs).
 *
 * Runs under an isolated LH_DATA_DIR (the chat-kind discipline: the seam is
 * set before any config-loading import, so every app-module import is
 * dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ask-context-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const {
	askContextView,
	askRefsFor,
	askRetrievalFor,
	askSourcesFor,
	isAskSourceChat,
	makeAskPin,
	parseAskPinInput,
	pruneAskSources,
} = await import("../src/server/ask-context.ts");
const { retrieveAskContext } = await import("../src/core/ask-context.ts");
import type { LhMessage } from "../src/core/native-messages.ts";
import type { AskPin } from "../src/core/contracts/chat.ts";

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

let serial = 0;
const user = (text: string): LhMessage =>
	({ id: `u${++serial}`, role: "user", content: text, timestamp: 1 }) as LhMessage;
const assistant = (text: string): LhMessage =>
	({ id: `a${++serial}`, role: "assistant", content: [{ type: "text", text }], timestamp: 1 }) as LhMessage;

/** A teach session with a two-turn transcript. */
function teachSession(title: string): { id: string; turns: LhMessage[] } {
	const chat = chatStore.createChat(title);
	const messages = [user(`${title} question`), assistant(`${title} answer`)];
	chatStore.saveMessages(chat.id, messages);
	return { id: chat.id, turns: messages };
}

function askThread(title = "Ask thread"): string {
	return chatStore.createChat(title, "ask").id;
}

const emptyPin = (chatId: string, messageIds: string[], text = "excerpt"): AskPin => ({
	id: `pin_${++serial}`,
	chatId,
	messageIds,
	text,
	createdAt: "2026-01-01T00:00:00.000Z",
});

describe("parseAskPinInput — the network boundary", () => {
	it("rejects non-objects, empty ids, and empty text", () => {
		for (const bad of [null, [], "x", 3, {}, { chatId: "c", messageIds: [], text: "x" }, { chatId: "c", messageIds: ["m"], text: "   " }]) {
			assert.equal(parseAskPinInput(bad), null, JSON.stringify(bad));
		}
	});

	it("dedupes ids, caps at 24, clips text at 4000, and trims the label", () => {
		const ids = Array.from({ length: 30 }, (_, i) => `m${i}`);
		const out = parseAskPinInput({
			chatId: "c",
			messageIds: ids,
			text: "x".repeat(5_000),
			label: `  Quiz question  `,
		});
		assert.ok(out);
		assert.equal(out!.messageIds.length, 24);
		assert.equal(new Set(out!.messageIds).size, 24);
		assert.equal(out!.text.length, 4_000);
		assert.equal(out!.label, "Quiz question");
	});

	it("dedupes repeated ids before capping", () => {
		const out = parseAskPinInput({ chatId: "c", messageIds: ["a", "a", "b", "b"], text: "t" });
		assert.ok(out);
		assert.deepEqual(out!.messageIds, ["a", "b"]);
	});

	it("drops a blank label entirely", () => {
		const out = parseAskPinInput({ chatId: "c", messageIds: ["m"], text: "t", label: "  " });
		assert.ok(out);
		assert.equal("label" in out!, false);
	});
});

describe("isAskSourceChat — only teaching/practice can be linked", () => {
	it("teach and practice yes; Ask threads and unknown ids no", () => {
		const teach = teachSession("Teach");
		const practice = chatStore.createChat("Practice", "practice");
		const ask = askThread();
		assert.equal(isAskSourceChat(teach.id), true);
		assert.equal(isAskSourceChat(practice.id), true);
		assert.equal(isAskSourceChat(ask), false);
		assert.equal(isAskSourceChat("chat_missing"), false);
	});
});

describe("store Ask-context actions", () => {
	it("addAskLink is idempotent per source (the original timestamp survives)", () => {
		const source = teachSession("Idempotent");
		const ask = askThread();
		const first = chatStore.addAskLink(ask, { chatId: source.id, linkedAt: "2026-01-01T00:00:00.000Z" });
		assert.equal(first.links?.length, 1);
		assert.equal(chatStore.addAskLink(ask, { chatId: source.id, linkedAt: "2026-02-02T00:00:00.000Z" }).links?.length, 1);
		assert.equal(chatStore.getChat(ask)!.ask?.links?.[0]?.linkedAt, "2026-01-01T00:00:00.000Z");
	});

	it("pinning auto-links the source; unpinning keeps the link", () => {
		const source = teachSession("Pin");
		const ask = askThread();
		const pin = emptyPin(source.id, [source.turns[0]!.id]);
		chatStore.addAskPin(ask, pin);
		const ctx = chatStore.getAskContext(ask)!;
		assert.deepEqual(ctx.links?.map((l) => l.chatId), [source.id], "a pin's session is retrievable");
		assert.deepEqual(ctx.pins?.map((p) => p.id), [pin.id]);

		chatStore.removeAskPin(ask, pin.id);
		const after = chatStore.getAskContext(ask)!;
		assert.deepEqual(after.pins, []);
		assert.deepEqual(after.links?.map((l) => l.chatId), [source.id], "the link is a separate choice");
	});

	it("unlinking drops the source's pins (a dead reference never stays)", () => {
		const source = teachSession("Unlink");
		const ask = askThread();
		chatStore.addAskPin(ask, emptyPin(source.id, [source.turns[0]!.id]));
		chatStore.addAskPin(ask, emptyPin(source.id, [source.turns[1]!.id]));
		chatStore.removeAskLink(ask, source.id);
		const ctx = chatStore.getAskContext(ask)!;
		assert.deepEqual(ctx.links, []);
		assert.deepEqual(ctx.pins, []);
	});

	it("getAskContext returns undefined for non-Ask records", () => {
		const teach = teachSession("No ask block");
		assert.equal(chatStore.getAskContext(teach.id), undefined);
	});
});

describe("askContextView — resolved chips, missing sources marked", () => {
	it("resolves a linked session's title", () => {
		const source = teachSession("Linear algebra");
		const ask = askThread();
		chatStore.addAskLink(ask, { chatId: source.id, linkedAt: "2026-01-01T00:00:00.000Z" });
		const view = askContextView(chatStore.getChat(ask)!);
		assert.deepEqual(view.links, [
			{ chatId: source.id, title: "Linear algebra", missing: false, linkedAt: "2026-01-01T00:00:00.000Z" },
		]);
	});

	it("keeps a dead source visible as a removable chip", () => {
		const ask = askThread();
		chatStore.addAskLink(ask, { chatId: "chat_gone", linkedAt: "2026-01-01T00:00:00.000Z" });
		const view = askContextView(chatStore.getChat(ask)!);
		assert.equal(view.links[0]!.missing, true);
		assert.equal(view.links[0]!.title, "Missing session");
	});
});

describe("askRefsFor — the transcript indicator contract", () => {
	it("a pin produces a pinned ref naming its turn ids", () => {
		const source = teachSession("Refs pin");
		const ask = askThread("Entropy questions");
		chatStore.addAskPin(ask, emptyPin(source.id, [source.turns[1]!.id]));

		const refs = askRefsFor(source.id).filter((r) => r.askChatId === ask);
		assert.equal(refs.length, 1);
		assert.equal(refs[0]!.reason, "pinned");
		assert.deepEqual(refs[0]!.messageIds, [source.turns[1]!.id]);
		assert.equal(refs[0]!.askTitle, "Entropy questions");
	});

	it("a usage produces a used ref carrying the answer to open, latest answer wins", () => {
		const source = teachSession("Refs usage");
		const ask = askThread();
		chatStore.appendAskUsage(ask, {
			messageId: "answer-1",
			used: [{ chatId: source.id, messageIds: [source.turns[0]!.id] }],
			at: "2026-01-01T00:00:00.000Z",
		});
		chatStore.appendAskUsage(ask, {
			messageId: "answer-2",
			used: [{ chatId: source.id, messageIds: [source.turns[0]!.id] }],
			at: "2026-02-02T00:00:00.000Z",
		});

		const used = askRefsFor(source.id).filter((r) => r.askChatId === ask && r.reason === "used");
		assert.equal(used.length, 2, "each answer's use is its own ref (the client merges at the anchor)");
		assert.equal(used[1]!.answerMessageId, "answer-2");
	});

	it("a turn both pinned and used emits both reasons; the pin points at the used answer", () => {
		const source = teachSession("Refs both");
		const ask = askThread();
		chatStore.addAskPin(ask, emptyPin(source.id, [source.turns[0]!.id]));
		chatStore.appendAskUsage(ask, {
			messageId: "answer-both",
			used: [{ chatId: source.id, messageIds: [source.turns[0]!.id] }],
			at: "2026-01-01T00:00:00.000Z",
		});

		const refs = askRefsFor(source.id).filter((r) => r.askChatId === ask);
		const pinned = refs.find((r) => r.reason === "pinned")!;
		const used = refs.find((r) => r.reason === "used")!;
		assert.equal(pinned.answerMessageId, "answer-both", "click-through opens the answer that used it");
		assert.equal(used.answerMessageId, "answer-both");
	});

	it("links alone produce no indicator (they do not point at a turn)", () => {
		const source = teachSession("Refs link only");
		const ask = askThread();
		chatStore.addAskLink(ask, { chatId: source.id, linkedAt: "2026-01-01T00:00:00.000Z" });
		assert.equal(askRefsFor(source.id).filter((r) => r.askChatId === ask).length, 0);
	});

	it("appendAskUsage is idempotent per answer message id", () => {
		const source = teachSession("Refs idempotent");
		const ask = askThread();
		const usage = {
			messageId: "answer-once",
			used: [{ chatId: source.id, messageIds: [source.turns[0]!.id] }],
			at: "2026-01-01T00:00:00.000Z",
		};
		chatStore.appendAskUsage(ask, usage);
		chatStore.appendAskUsage(ask, usage);
		assert.equal(chatStore.getAskContext(ask)!.usages?.length, 1);
	});
});

describe("askSourcesFor / askRetrievalFor", () => {
	it("dedupes links and pins into one source list, skipping self and missing ids", () => {
		const source = teachSession("Sources");
		const ask = askThread();
		chatStore.addAskLink(ask, { chatId: source.id, linkedAt: "2026-01-01T00:00:00.000Z" });
		chatStore.addAskPin(ask, emptyPin(source.id, [source.turns[0]!.id]));
		chatStore.addAskLink(ask, { chatId: "chat_missing", linkedAt: "2026-01-01T00:00:00.000Z" });

		const sources = askSourcesFor(chatStore.getChat(ask)!);
		assert.deepEqual(sources.map((s) => s.chatId), [source.id]);
		assert.equal(sources[0]!.title, "Sources");
	});

	it("askRetrievalFor runs retrieval against the record's current context", () => {
		const source = teachSession("Retrieval");
		const ask = askThread();
		chatStore.addAskPin(ask, emptyPin(source.id, [source.turns[0]!.id], "pinned excerpt"));
		const retrieval = askRetrievalFor(chatStore.getChat(ask)!, "anything");
		assert.match(retrieval.context, /pinned excerpt/);
		assert.deepEqual(retrieval.sourceChatIds, [source.id]);
	});
});

describe("pruneAskSources — deletion cleanup", () => {
	it("drops links and pins pointing at a deleted session across every Ask thread", () => {
		const source = teachSession("Deleted");
		const askA = askThread();
		const askB = askThread();
		chatStore.addAskLink(askA, { chatId: source.id, linkedAt: "2026-01-01T00:00:00.000Z" });
		chatStore.addAskPin(askB, emptyPin(source.id, [source.turns[0]!.id]));
		chatStore.addAskPin(askB, emptyPin(source.id, [source.turns[1]!.id]));

		pruneAskSources(source.id);

		assert.deepEqual(chatStore.getAskContext(askA)!.links, []);
		assert.deepEqual(chatStore.getAskContext(askB)!.pins, []);
		assert.deepEqual(chatStore.getAskContext(askB)!.links, []);
	});
});

describe("makeAskPin — identity minted at the write seam", () => {
	it("stamps a unique id, createdAt, and carries the validated payload", () => {
		const one = makeAskPin({ chatId: "c", messageIds: ["m"], text: "t", label: "Question prompt" });
		const two = makeAskPin({ chatId: "c", messageIds: ["m"], text: "t" });
		assert.match(one.id, /^pin_/);
		assert.notEqual(one.id, two.id);
		assert.ok(!Number.isNaN(Date.parse(one.createdAt)));
		assert.equal(one.label, "Question prompt");
		assert.equal("label" in two, false);
	});
});

describe("retrieveAskContext integration with the store shapes", () => {
	it("a linked session's turns are readable by the pure retriever", () => {
		const source = teachSession("Integrated");
		const out = retrieveAskContext({
			question: "Integrated",
			sources: askSourcesFor(
				(() => {
					const ask = askThread();
					chatStore.addAskLink(ask, { chatId: source.id, linkedAt: "2026-01-01T00:00:00.000Z" });
					return chatStore.getChat(ask)!;
				})(),
			),
			pins: [],
		});
		assert.match(out.context, /Integrated answer/);
	});
});
