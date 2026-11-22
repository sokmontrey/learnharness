import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { danglingDockCallOf, newAnswerResult } from "../src/core/native-messages.ts";
import { buildListeningAnswer } from "../src/core/question-core.ts";
import { inputAppends } from "../src/core/input-events.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { AssistantMessage } from "@earendil-works/pi-ai";

function assistantWithListening(callId = "call_l1"): LhMessage & AssistantMessage {
	return {
		id: "a1",
		role: "assistant",
		timestamp: 1,
		content: [
			{ type: "text", text: "Paraphrase only." },
			{ type: "toolCall", id: callId, name: "listening", arguments: { targetText: "Bonjour le monde", contextText: "Greeting" } },
		],
	} as LhMessage & AssistantMessage;
}

describe("listening dock gate", () => {
	it("danglingDockCallOf surfaces unanswered listening", () => {
		const pending = danglingDockCallOf([assistantWithListening()]);
		assert.equal(pending?.tool, "listening");
		assert.equal(pending?.toolCallId, "call_l1");
	});

	it("listening before quiz — listening wins while unanswered", () => {
		const msg = {
			...assistantWithListening("call_l"),
			content: [
				{ type: "toolCall", id: "call_l", name: "listening", arguments: { targetText: "Salut" } },
				{ type: "toolCall", id: "call_q", name: "quiz", arguments: { question: "Q?" } },
			],
		} as LhMessage & AssistantMessage;
		assert.equal(danglingDockCallOf([msg])?.toolCallId, "call_l");
	});

	it("answer append clears dangling listening", () => {
		const record = { messages: [assistantWithListening()] };
		const answer = buildListeningAnswer("Bonjour le monde", "Greeting", "Bonjour le monde");
		const appends = inputAppends(record, { type: "answer", toolCallId: "call_l1", answer });
		assert.equal(appends.length, 1);
		assert.equal(danglingDockCallOf([...record.messages, ...appends]), null);
	});

	it("quiz pending after listening answered", () => {
		const msg = {
			...assistantWithListening("call_l"),
			content: [
				{ type: "toolCall", id: "call_l", name: "listening", arguments: { targetText: "Salut" } },
				{ type: "toolCall", id: "call_q", name: "quiz", arguments: { question: "Q?" } },
			],
		} as LhMessage & AssistantMessage;
		const answered = [
			msg,
			newAnswerResult("call_l", "listening", buildListeningAnswer("Salut", undefined, "Salut")),
		];
		assert.equal(danglingDockCallOf(answered)?.toolCallId, "call_q");
	});
});