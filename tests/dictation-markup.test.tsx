/**
 * Dictation repair markup: word-level spans only, and the raw transcript
 * wins when the model reply is anything else.
 */
import React from "react";

(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DictationText, DictationTextarea } from "../components/dictation-text.tsx";
import {
	acceptDictationRepair,
	dictationPlainText,
	hasDictationMarkup,
	learnerAsk,
} from "../lib/dictation-markup.ts";

const SPAN = (original: string, corrected: string) =>
	`<span data-dictation-correction data-original="${original}">${corrected}</span>`;

describe("acceptDictationRepair", () => {
	it("keeps a single-word swap and rejects a rewrite", () => {
		const original = "je dois derive the function";
		const repaired = `je dois ${SPAN("derive", "dérive")} the function`;
		assert.equal(acceptDictationRepair(original, repaired), repaired);
		assert.equal(acceptDictationRepair(original, "je dois dériver la fonction"), original);
		assert.equal(acceptDictationRepair(original, `je dois ${SPAN("derive the", "dérive")}`), original);
	});

	it("rejects any tag that is not the repair span", () => {
		const original = "bonjour";
		assert.equal(acceptDictationRepair(original, "<b>bonjour</b>"), original);
		assert.equal(acceptDictationRepair(original, `${SPAN("bonjour", "bonjour")}<script>`), original);
	});

	it("a reply with no repair is the original", () => {
		assert.equal(acceptDictationRepair("hello there", "hello there"), "hello there");
	});
});

describe("learnerAsk", () => {
	it("reads the question and details, never the answer key", () => {
		assert.equal(
			learnerAsk({ question: "Traduis.", details: "En français.", correctAnswer: "the secret", explanation: "hidden" }),
			"Traduis.\n\nEn français.",
		);
		assert.equal(learnerAsk({ statement: "Énonce la règle.", modelSolution: "hidden" }), "Énonce la règle.");
		assert.equal(learnerAsk(null), "");
	});
});

describe("DictationText", () => {
	it("paints a repaired word yellow and keeps the spoken word on hover", () => {
		const html = renderToStaticMarkup(<DictationText text={`je ${SPAN("derive", "dérive")}`} />);
		assert.match(html, /bg-yellow-200/);
		assert.match(html, /title="derive"/);
		assert.match(html, /data-original="derive"/);
		assert.match(html, />dérive</);
		assert.equal(hasDictationMarkup(`je ${SPAN("derive", "dérive")}`), true);
		assert.equal(dictationPlainText(`je ${SPAN("derive", "dérive")}`), "je dérive");
	});

	it("the field stays a textarea and shows the repaired words, not the tags", () => {
		const html = renderToStaticMarkup(
			<DictationTextarea value={`je ${SPAN("derive", "dérive")}`} onChange={() => {}} />,
		);
		assert.match(html, /<textarea[^>]*>je dérive<\/textarea>/);
		assert.doesNotMatch(html, /<textarea[^>]*>[^<]*data-dictation-correction/);
		assert.match(html, /title="derive"/);
	});
});
