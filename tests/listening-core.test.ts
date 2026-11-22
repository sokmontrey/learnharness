import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	diffListeningTokens,
	highlightTypedSegments,
	stripListeningAccents,
	listeningInputProblems,
	normalizeListeningText,
	scoreListening,
	tokenizeListening,
} from "../src/core/listening-core.ts";

describe("listening-core", () => {
	it("normalizes whitespace and NFC", () => {
		assert.equal(normalizeListeningText("  Bonjour   le  monde  "), "Bonjour le monde");
	});

	it("tokenizes elisions and splits punctuation", () => {
		assert.deepEqual(tokenizeListening("l'homme est là"), ["l'homme", "est", "là"]);
		assert.deepEqual(tokenizeListening("Bonjour, comment allez-vous ?"), [
			"Bonjour",
			",",
			"comment",
			"allez-vous",
			"?",
		]);
	});

	it("diff marks progressive tokens", () => {
		const d = diffListeningTokens("Bonjour le monde", "Bonjour la");
		assert.equal(d[0]?.status, "correct");
		assert.equal(d[1]?.status, "wrong");
		assert.equal(d[2]?.status, "pending");
	});

	it("scoreListening is case-insensitive for token score", () => {
		const s = scoreListening("Je vais bien.", "je vais bien.");
		assert.equal(s.tokenScore, 1);
		assert.equal(s.perfect, false);
	});

	it("scoreListening reports perfect match", () => {
		const s = scoreListening("Je vais bien.", "Je vais bien.");
		assert.equal(s.perfect, true);
		assert.equal(s.tokenScore, 1);
	});

	it("listeningInputProblems rejects empty target", () => {
		assert.ok(listeningInputProblems({ targetText: "   " }).length > 0);
	});

	it("listeningInputProblems accepts short French", () => {
		assert.deepEqual(listeningInputProblems({ targetText: "Bonjour, comment allez-vous ?" }), []);
	});

	it("highlightTypedSegments omits pending targets and marks partial prefixes", () => {
		const segs = highlightTypedSegments("Bonjour le monde", "Bonjour le mo");
		const words = segs.filter((s) => s.status !== "neutral");
		assert.ok(words.some((s) => s.status === "partial" || s.status === "exact"));
		assert.ok(!segs.some((s) => s.text === "monde"), "no ghost of untyped words");
	});

	it("accent-insensitive tokens score correct; highlights wrong accent chars", () => {
		assert.equal(stripListeningAccents("café"), stripListeningAccents("cafe"));
		const segs = highlightTypedSegments("Je prends un café.", "Je prends un cafe.");
		const accentSeg = segs.find((s) => s.status === "accent");
		assert.ok(accentSeg, "marks the missing/wrong accent letter");
		assert.ok(accentSeg!.text.includes("e"));
		const { tokenScore, perfect } = scoreListening("Je prends un café.", "Je prends un cafe.");
		assert.equal(tokenScore, 1);
		assert.equal(perfect, false);
	});

	it("punctuation is its own token in highlights", () => {
		const segs = highlightTypedSegments("Salut !", "Salut ?");
		const punct = segs.find((s) => s.text === "?");
		assert.equal(punct?.status, "wrong");
	});
});