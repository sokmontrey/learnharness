/**
 * Meaning inference (Mercury / translation-free selection flow): the structured
 * payload the meaning-inferer sub-agent submits and the client panel renders.
 * Pure — browser-safe.
 */

import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const MEANING_CLUE_RELATIONS = [
	"refers-to",
	"same-idea",
	"opposite",
	"example",
	"cause",
] as const;

export type MeaningClueRelation = (typeof MEANING_CLUE_RELATIONS)[number];

/** French labels for the legend (Mercury §4.2) — UI only. */
export const MEANING_CLUE_RELATION_LABEL_FR: Record<MeaningClueRelation, string> = {
	"refers-to": "réfère à",
	"same-idea": "même idée",
	opposite: "au contraire",
	example: "exemple",
	cause: "cause / conséquence",
};

const meaningClueRelation = Type.Union([
	Type.Literal("refers-to"),
	Type.Literal("same-idea"),
	Type.Literal("opposite"),
	Type.Literal("example"),
	Type.Literal("cause"),
]);

export const meaningClueObject = Type.Object({
	quote: Type.String({
		description:
			"Verbatim quote from the lesson context (must appear in the provided text). Short phrase or sentence.",
	}),
	relation: meaningClueRelation,
	nudge: Type.String({
		description:
			"One short French line that orients reading — never the target's definition or any English.",
	}),
});

export type MeaningClue = Static<typeof meaningClueObject>;

export const meaningInferSuccessObject = Type.Object({
	target: Type.String({ description: "The learner's selection, normalized (lemma or phrase as in the text)." }),
	guessPrompt: Type.String({
		description: "French question inviting a guess, e.g. À ton avis, que veut dire … ici ?",
	}),
	clues: Type.Array(meaningClueObject, { minItems: 0, maxItems: 3 }),
	definition: Type.String({ description: "Simple French definition for this sense only — controlled vocabulary." }),
	example: Type.String({ description: "One short French example sentence (may be from context or new, level-appropriate)." }),
	caveat: Type.Optional(
		Type.String({ description: "Optional French warning: false friend, register, polysemy note." }),
	),
	expectedSense: Type.Optional(
		Type.String({ description: "Hidden grading gist — French, one line, not shown to learner in v1." }),
	),
});

export const meaningInferInsufficientObject = Type.Object({
	insufficient: Type.Literal(true),
	messageFr: Type.String({
		description: "French instruction when context is too thin — suggest re-reading, never English.",
	}),
});

export const meaningInferSubmitObject = Type.Union([meaningInferSuccessObject, meaningInferInsufficientObject]);

export type MeaningInferSuccess = Static<typeof meaningInferSuccessObject>;
export type MeaningInferInsufficient = Static<typeof meaningInferInsufficientObject>;
export type MeaningInferResult = Static<typeof meaningInferSubmitObject>;

export function isMeaningInferInsufficient(r: MeaningInferResult): r is MeaningInferInsufficient {
	return "insufficient" in r && r.insufficient === true;
}

/** Semantic validation after schema decode (submit-agent validate hook). */
export function meaningInferProblems(input: MeaningInferResult): string[] {
	if (isMeaningInferInsufficient(input)) {
		const msg = input.messageFr.trim();
		if (!msg) return ["messageFr is empty when insufficient."];
		return [];
	}
	const success = input as MeaningInferSuccess;
	const problems: string[] = [];
	const target = success.target.trim();
	if (!target) problems.push("target is empty.");
	if (!success.guessPrompt.trim()) problems.push("guessPrompt is empty.");
	if (!success.definition.trim()) problems.push("definition is empty.");
	if (!success.example.trim()) problems.push("example is empty.");
	if (success.clues.length > 3) problems.push("At most 3 clues.");
	for (let i = 0; i < success.clues.length; i++) {
		const c = success.clues[i]!;
		if (!c.quote.trim()) problems.push(`clues[${i}].quote is empty.`);
		if (!c.nudge.trim()) problems.push(`clues[${i}].nudge is empty.`);
	}
	return problems;
}

/** Best-effort decode for tests / defensive parsing of raw JSON text. */
export function parseMeaningInferJson(text: string): MeaningInferResult | null {
	const trimmed = text.trim();
	const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
	const body = fence ? fence[1]!.trim() : trimmed;
	try {
		const raw: unknown = JSON.parse(body);
		if (!Value.Check(meaningInferSubmitObject, raw)) return null;
		return raw as MeaningInferResult;
	} catch {
		return null;
	}
}