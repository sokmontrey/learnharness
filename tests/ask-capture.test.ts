/**
 * Snippet → Ask thread (owner, 2026-11): the one client seam shared by the
 * transcript selection toolbar and the per-question/problem Ask buttons.
 *
 * Pins the title shape and the SINGLE create call (thread + first
 * reference + link), so the learner never sees an empty thread appear
 * before the snippet lands. No DOM: the hook's navigation is the router's
 * job, the fetch is stubbed here.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { askTitleFor, createAskThread } from "../components/ask-capture.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("askTitleFor — one-line, bounded thread titles", () => {
	it("prefixes Ask: and collapses whitespace", () => {
		assert.equal(askTitleFor("Calculus", "  what   is\na limit?  "), "Ask: what is a limit?");
	});

	it("clips at 64 characters with an ellipsis", () => {
		const out = askTitleFor("Source", "x".repeat(100));
		assert.equal(out, `Ask: ${"x".repeat(64)}…`);
		assert.equal(out.length, 5 + 64 + 1);
	});

	it("keeps a short line verbatim (no ellipsis)", () => {
		assert.equal(askTitleFor("Source", "short"), "Ask: short");
	});

	it("falls back to the source title for a blank capture", () => {
		assert.equal(askTitleFor("Linear algebra", "   \n\t "), "Ask about Linear algebra");
	});
});

describe("createAskThread — one POST creates the thread + first reference", () => {
	it("sends kind:ask with the source link and pin, returns the new id", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return Response.json({ id: "chat_new" }, { status: 200 });
		}) as typeof fetch;

		const id = await createAskThread({
			sourceChatId: "chat_src",
			sourceTitle: "Thermodynamics",
			messageIds: ["msg_u1", "msg_a1"],
			text: "Entropy is disorder.",
			label: "Selected passage",
		});

		assert.equal(id, "chat_new");
		assert.equal(calls.length, 1, "one server call");
		assert.equal(calls[0]!.url, "/api/chats");
		assert.equal(calls[0]!.init.method, "POST");
		const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
		assert.equal(body.title, "Ask: Entropy is disorder.");
		assert.equal(body.kind, "ask");
		assert.deepEqual(body.ask, {
			links: ["chat_src"],
			pins: [
				{
					chatId: "chat_src",
					messageIds: ["msg_u1", "msg_a1"],
					text: "Entropy is disorder.",
					label: "Selected passage",
				},
			],
		});
	});

	it("omits a blank/absent label from the pin", async () => {
		let body: Record<string, unknown> = {};
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			body = JSON.parse(String(init.body)) as Record<string, unknown>;
			return Response.json({ id: "chat_new" }, { status: 200 });
		}) as typeof fetch;

		await createAskThread({
			sourceChatId: "chat_src",
			sourceTitle: "Source",
			messageIds: ["m"],
			text: "t",
		});
		const pins = (body.ask as { pins: Array<Record<string, unknown>> }).pins;
		assert.equal("label" in pins[0]!, false);
	});

	it("returns null on a non-200 (no half-created thread surfaces)", async () => {
		globalThis.fetch = (async () => Response.json({ error: "bad" }, { status: 400 })) as typeof fetch;
		assert.equal(
			await createAskThread({ sourceChatId: "c", sourceTitle: "s", messageIds: ["m"], text: "t" }),
			null,
		);
	});

	it("returns null when the response body is unreadable or id-less", async () => {
		globalThis.fetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
		assert.equal(
			await createAskThread({ sourceChatId: "c", sourceTitle: "s", messageIds: ["m"], text: "t" }),
			null,
		);
		globalThis.fetch = (async () => Response.json({}, { status: 200 })) as typeof fetch;
		assert.equal(
			await createAskThread({ sourceChatId: "c", sourceTitle: "s", messageIds: ["m"], text: "t" }),
			null,
		);
	});
});
