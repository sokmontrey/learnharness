/**
 * One Ask turn (owner, 2026-11): the lean sibling of the teaching turn.
 *
 * Pins the whole lean contract: the global Ask role resolves from the Cheap
 * slot (no strong-slot gate), the system prompt carries the retrieved
 * passages AND the pinned excerpt (never the whole transcript), the answer
 * persists with its usage + Ask usage log, and the source transcript's
 * indicator refs light up. No compaction, no extraction, no tools.
 *
 * Isolated LH_DATA_DIR (the chat-kind discipline) + a scripted faux engine
 * injected through the handler's builder seam — zero tokens.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-ask-turn-"));
process.env.LH_DATA_DIR = TMP_DATA;
// The key-presence gate reads env-first truth (the chat-flow discipline).
process.env.OPENROUTER_API_KEY = "test-key-presence-gate";

const { chatStore } = await import("../src/store/chats.ts");
const { writeSettings } = await import("../src/store/settings.ts");
const { handleChatInput } = await import("../src/server/chat-handler.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { isTurnRunning } = await import("../src/server/turn-liveness.ts");
const { askRefsFor } = await import("../src/server/ask-context.ts");
const { createAskAgent } = await import("../src/agent/teacher-agent.ts");
import type { LhMessage } from "../src/core/native-messages.ts";

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** The Cheap slot gives the Ask role its model (ROLE_SLOT.ask). */
function configureAsk(): void {
	writeSettings({
		version: 1,
		models: { cheap: { model: { provider: "openrouter", id: "qwen/qwen3.8-flash" } } },
	});
}

let serial = 0;
const user = (text: string): LhMessage =>
	({ id: `u${++serial}`, role: "user", content: text, timestamp: 1 }) as LhMessage;
const assistant = (text: string): LhMessage =>
	({ id: `a${++serial}`, role: "assistant", content: [{ type: "text", text }], timestamp: 1 }) as LhMessage;

function waitFor(cond: () => boolean, timeoutMs = 8000, what = "condition"): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (cond()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${what}`));
			setTimeout(tick, 10);
		};
		tick();
	});
}

/** Drain a turn that settled before we subscribed (faux turns are fast). */
async function settle(chatId: string): Promise<void> {
	const handle = runningTurn(chatId);
	if (handle) {
		await new Response(handle.subscribe()).text();
	}
	await waitFor(() => !isTurnRunning(chatId), 8000, "the Ask turn to settle");
}

/** The scripted Ask builder: records the system prompt and answers once. */
function askFactory(answer: string, captured?: string[]) {
	const faux = createFauxCore({});
	faux.setResponses([fauxAssistantMessage([fauxText(answer)])]);
	const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return (opts: Parameters<typeof createAskAgent>[0]) => {
		captured?.push(opts?.systemPrompt ?? "");
		return createAskAgent({ ...opts, engine });
	};
}

/** The assistant text of the record's last message. */
function lastAssistantText(messages: readonly LhMessage[]): string {
	const last = messages[messages.length - 1] as
		| { role?: string; content?: Array<{ type?: string; text?: string }> }
		| undefined;
	assert.equal(last?.role, "assistant");
	return (last?.content ?? [])
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("");
}

function groundedSource(): { id: string; messages: LhMessage[] } {
	const chat = chatStore.createChat("Thermodynamics");
	const u1 = user("What is entropy?");
	const a1 = assistant("Entropy is a measure of disorder.");
	const u2 = user("What is the second law?");
	const a2 = assistant("The second law says total entropy rises.");
	const u3 = user("What is photosynthesis?");
	const a3 = assistant("Plants convert light into sugar.");
	chatStore.saveMessages(chat.id, [u1, a1, u2, a2, u3, a3]);
	return { id: chat.id, messages: [u1, a1, u2, a2, u3, a3] };
}

describe("handleAskInput — the grounded Ask turn", () => {
	it("runs ONE call, grounds the prompt in the pin + its neighbors, and logs usage", async () => {
		configureAsk();
		const source = groundedSource();
		const ask = chatStore.createChat("Ask: entropy", "ask");
		chatStore.addAskLink(ask.id, { chatId: source.id, linkedAt: "2026-01-01T00:00:00.000Z" });
		chatStore.addAskPin(ask.id, {
			id: "pin_1",
			chatId: source.id,
			messageIds: [source.messages[1]!.id],
			text: "Entropy is a measure of disorder.",
			label: "Selected passage",
			createdAt: "2026-01-01T00:00:00.000Z",
		});

		const prompts: string[] = [];
		const res = await handleChatInput(
			ask.id,
			{ type: "text", text: "Why does entropy increase?" },
			askFactory("Because more microstates mean more disorder.", prompts),
		);
		assert.equal(res.status, 200);
		await settle(ask.id);

		// The model saw the pinned excerpt, its turn + the neighboring turn,
		// and NOT the distant photosynthesis turn.
		const prompt = prompts[0] ?? "";
		assert.match(prompt, /## Pinned passages/);
		assert.match(prompt, /Selected passage: Entropy is a measure of disorder\./);
		assert.match(prompt, /The second law says total entropy rises\./);
		assert.ok(!prompt.includes("Plants convert light into sugar"), "the whole transcript never rides");
		assert.match(prompt, /## Linked sessions/);
		assert.match(prompt, /Thermodynamics/);

		// The record holds only the question and the answer.
		const record = chatStore.getChat(ask.id)!;
		assert.equal(record.messages.length, 2);
		const question = record.messages[0] as { role?: string; content?: unknown };
		assert.equal(question.role, "user");
		assert.equal(question.content, "Why does entropy increase?");
		assert.match(lastAssistantText(record.messages), /more microstates/);

		// Usage logging: one turn entry on the resolved Ask model.
		assert.equal(record.turns?.length, 1);
		assert.match(record.turns![0]!.model, /^openrouter:/);

		// The Ask usage log names the source turns that were in context.
		const usage = record.ask?.usages ?? [];
		const answerId = (record.messages[1] as { id: string }).id;
		assert.equal(usage.length, 1);
		assert.equal(usage[0]!.messageId, answerId);
		assert.deepEqual(usage[0]!.used.map((u) => u.chatId), [source.id]);
		assert.ok(
			usage[0]!.used[0]!.messageIds.includes(source.messages[1]!.id),
			"the pinned turn is logged as used",
		);

		// The source transcript now carries both indicator reasons.
		const refs = askRefsFor(source.id).filter((r) => r.askChatId === ask.id);
		assert.ok(refs.some((r) => r.reason === "pinned"));
		const used = refs.find((r) => r.reason === "used");
		assert.ok(used);
		assert.equal(used!.answerMessageId, answerId);
	});

	it("an unlinked thread answers honestly ungrounded", async () => {
		configureAsk();
		const ask = chatStore.createChat("Ask: general", "ask");
		const prompts: string[] = [];
		const before = chatStore.getChat(ask.id)!.messages.length;
		const res = await handleChatInput(
			ask.id,
			{ type: "text", text: "What is a matrix?" },
			askFactory("A rectangular array of numbers.", prompts),
		);
		assert.equal(res.status, 200);
		await settle(ask.id);

		assert.match(prompts[0] ?? "", /No teaching or practice session is linked/);
		const record = chatStore.getChat(ask.id)!;
		assert.equal(record.messages.length, before + 2);
		assert.match(lastAssistantText(record.messages), /rectangular array/);
	});
});

describe("handleAskInput — gates and refusals", () => {
	it("no Ask model (empty settings) refuses with the cheap-tier 503 envelope", async () => {
		writeSettings({ version: 1 });
		const ask = chatStore.createChat("Ask: unconfigured", "ask");
		const res = await handleChatInput(
			ask.id,
			{ type: "text", text: "hello" },
			askFactory("should never run"),
		);
		assert.equal(res.status, 503);
		const body = (await res.json()) as { code?: string; missing?: string[] };
		assert.equal(body.code, "models_not_configured");
		assert.deepEqual(body.missing, ["cheap"], "Ask reports its real tier");
		assert.equal(chatStore.getChat(ask.id)!.messages.length, 0, "nothing durable changed");
	});

	it("a steer input is a programming error — 400, no turn", async () => {
		configureAsk();
		const ask = chatStore.createChat("Ask: steer", "ask");
		const res = await handleChatInput(
			ask.id,
			{ type: "steers", steers: [user("sneaky")] },
			askFactory("should never run"),
		);
		assert.equal(res.status, 400);
		assert.equal(isTurnRunning(ask.id), false);
	});

	it("a second turn while one is in flight is 409 (the liveness claim)", async () => {
		configureAsk();
		const ask = chatStore.createChat("Ask: busy", "ask");
		const first = await handleChatInput(
			ask.id,
			{ type: "text", text: "first" },
			askFactory("first answer"),
		);
		assert.equal(first.status, 200);
		const second = await handleChatInput(
			ask.id,
			{ type: "text", text: "second" },
			askFactory("second answer"),
		);
		assert.equal(second.status, 409);
		await settle(ask.id);
	});
});
