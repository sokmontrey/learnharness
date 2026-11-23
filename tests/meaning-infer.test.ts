import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	clueQuoteInLesson,
	isMeaningInferInsufficient,
	meaningInferProblems,
	parseMeaningInferJson,
	type MeaningInferResult,
} from "../src/core/meaning-infer.ts";

const GOLDEN_SUCCESS: MeaningInferResult = {
	target: "affiner",
	guessPrompt: "À ton avis, que veut dire « affiner » ici ?",
	clues: [
		{
			quote: "Il l'affinait dans sa cave.",
			relation: "refers-to",
			nudge: "Il s'agit du fromage dont on parlait.",
		},
		{
			quote: "contrairement au roquefort de son voisin, piquant et salé",
			relation: "opposite",
			nudge: "Le contraste aide à deviner le goût visé.",
		},
	],
	definition: "Rendre un fromage plus fort en goût en le faisant mûrir.",
	example: "On affine le camembert plusieurs semaines.",
	caveat: "Ne pas confondre avec « affiner une technique ».",
};

describe("meaning-infer", () => {
	it("meaningInferProblems accepts a golden success payload", () => {
		assert.deepEqual(meaningInferProblems(GOLDEN_SUCCESS), []);
	});

	it("meaningInferProblems rejects empty target", () => {
		assert.ok(meaningInferProblems({ ...GOLDEN_SUCCESS, target: "  " }).length > 0);
	});

	it("meaningInferProblems accepts insufficient payload", () => {
		assert.deepEqual(
			meaningInferProblems({ insufficient: true, messageFr: "Relis le passage sur le fromage." }),
			[],
		);
	});

	it("parseMeaningInferJson parses fenced JSON", () => {
		const wrapped = "```json\n" + JSON.stringify(GOLDEN_SUCCESS) + "\n```";
		const parsed = parseMeaningInferJson(wrapped);
		assert.ok(parsed);
		assert.equal(!parsed || isMeaningInferInsufficient(parsed), false);
		if (parsed && !isMeaningInferInsufficient(parsed)) {
			assert.equal(parsed.target, "affiner");
			assert.equal(parsed.clues.length, 2);
		}
	});

	it("parseMeaningInferJson parses insufficient branch", () => {
		const raw = JSON.stringify({ insufficient: true, messageFr: "Contexte insuffisant." });
		const parsed = parseMeaningInferJson(raw);
		assert.ok(parsed && isMeaningInferInsufficient(parsed));
	});

	it("rejects English methodology clues for a French token in a French line", () => {
		const lesson = `Teacher: The test: try to stand the word alone.
Teacher: Il prête son livre à ses voisins.`;
		const bad: MeaningInferResult = {
			...GOLDEN_SUCCESS,
			target: "prête",
			clues: [
				{
					quote: "The test: try to stand the word alone.",
					relation: "cause",
					nudge: "C'est une consigne de méthode, pas le sens.",
				},
			],
		};
		const problems = meaningInferProblems(bad, { pointer: "prête", lessonProse: lesson });
		assert.ok(problems.some((p) => p.includes("French situational") || p.includes("contains the selection")));
	});

	it("clueQuoteInLesson accepts ellipsis and rejects fabricated lines", () => {
		const lesson = "Il prête son livre à ses voisins.";
		assert.equal(clueQuoteInLesson("Il prête … à ses voisins.", lesson), true);
		assert.equal(clueQuoteInLesson("totally invented", lesson), false);
	});
});