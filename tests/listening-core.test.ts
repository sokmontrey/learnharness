import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	diffListeningTokens,
	listeningInputProblems,
	normalizeListeningText,
	scoreListening,
	tokenizeListening,
} from "../src/core/listening-core.ts";

describe("listening-core", () => {
	it("normalizes whitespace and NFC", () => {
		assert.equal(normalizeListeningText("  Bonjour   le  monde  "), "Bonjour le monde");
	});

	it("tokenizes French elisions as one token", () => {
		assert.deepEqual(tokenizeListening("l'homme est là"), ["l'homme", "est", "là"]);
	});

	it("diff marks progressive tokens", () => {
		const d = diffListeningTokens("Bonjour le monde", "Bonjour la");
		assert.equal(d[0]?.status, "correct");
		assert.equal(d[1]?.status, "wrong");
		assert.equal(d[2]?.status, "pending");
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
});