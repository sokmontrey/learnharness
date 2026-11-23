import type { Usage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import {
	meaningInferProblems,
	meaningInferSubmitObject,
	type MeaningInferResult,
	type MeaningInferSuccess,
} from "../../core/meaning-infer.ts";
import { runSubmitAgent } from "./submit-agent.ts";

/**
 * Synchronous meaning-inference sub-agent: reads the same last-two-turns window
 * as the explainer, returns structured French-only clues + definition for the
 * staged "Deviner le sens" panel. No tools beyond submit; no L1.
 */

const INSTRUCTIONS = `You help a French learner infer the meaning of a word or phrase FROM CONTEXT alone.

You receive (1) the last two turns of a lesson and (2) the exact span the learner selected.

## Job (read this first)

1. **Locate** every place the selection appears in the lesson. Find the **full sentence** it sits in (especially French example lines).
2. **Clue #1** must be that sentence (or the shortest clause that still contains the selection) — relation \`example\` or \`same-idea\`. This is mandatory when such a sentence exists in the context.
3. Add at most **2** more clues only if they help infer **meaning in that situation** (contrast, who does what, coreference) — still verbatim from the lesson.
4. **Never** quote lesson meta-methodology (English rules about "try the word alone", morphology tests, "syllable", "leaning on the verb") unless the passage actually states what the word **means**. Those lines teach analysis technique, not meaning.
5. When the selection is **French**, clue \`quote\` strings must come from **French** passages in the lesson (example sentences, glosses in French) — not English prose about linguistics.

## Hard rules

- **Never use English or any L1** in nudges, definition, example, guessPrompt, caveat (JSON keys excepted). Clue \`quote\` may repeat English from the lesson only when there is no French material and you returned \`insufficient\`.
- **Never put the target's meaning in clue nudges** — nudges orient reading ("Ici, on voit qui fait quoi…") without defining the target.
- Quotes in \`clues[].quote\` must be **verbatim substrings** from the lesson context (minor ellipsis … only mid-quote).
- Disambiguate to the **passage sense** only.
- \`target\`: the selection (keep accents).
- \`definition\`: simple French, short, A2–B1; full sentence; states what the word means **in this context** (e.g. prêter = donner pour un moment).
- \`example\`: one short French sentence — reuse the lesson line when possible.
- \`guessPrompt\`: French; invite a guess about the selection **in the example sentence**.
- If the window has no situational text (only abstract English methodology), submit \`insufficient: true\` and \`messageFr\`: ask them to re-read the French example that contains the word.

## Relation types (clues[].relation)

- refers-to — coreference / who or what "il, elle, ce, dont" points to
- same-idea — synonym, paraphrase, cohesion
- opposite — contrast
- example — instance or illustration
- cause — cause or consequence

Submit exactly one \`meaning_infer\` tool call with the complete payload.`;

const TOOL_DESCRIPTION =
	"Submit the meaning-inference payload: clues, guess prompt, French definition, and example — or insufficient:true when context is too thin.";

function fillMeaningInfer(input: MeaningInferResult): MeaningInferResult {
	if ("insufficient" in input && input.insufficient === true) {
		return { insufficient: true, messageFr: input.messageFr.trim() };
	}
	const success = input as MeaningInferSuccess;
	return {
		...success,
		target: success.target.trim(),
		guessPrompt: success.guessPrompt.trim(),
		definition: success.definition.trim(),
		example: success.example.trim(),
		caveat: success.caveat?.trim() || undefined,
		expectedSense: success.expectedSense?.trim() || undefined,
		clues: success.clues.map((c) => ({
			quote: c.quote.trim(),
			relation: c.relation,
			nudge: c.nudge.trim(),
		})),
	};
}

export interface MeaningInferRunOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	chatId?: string;
}

export async function runMeaningInferer(
	contextProse: string,
	pointer: string,
	opts: MeaningInferRunOptions = {},
): Promise<MeaningInferResult> {
	const prompt = `## Lesson context (last two turns)

${contextProse || "(none — this is very early in the session)"}

## Selected span (infer meaning in this passage)

${pointer.trim()}`;

	return runSubmitAgent<MeaningInferResult>({
		role: "explainer",
		toolName: "meaning_infer",
		toolDescription: TOOL_DESCRIPTION,
		parameters: meaningInferSubmitObject,
		fill: fillMeaningInfer,
		systemPrompt: INSTRUCTIONS,
		prompt,
		engine: opts.engine,
		signal: opts.abortSignal,
		maxTurns: 4,
		chatId: opts.chatId,
		neverSubmitted: "meaning_infer was not submitted",
		validate: (value) => {
			const problems = meaningInferProblems(value, { pointer, lessonProse: contextProse });
			return problems.length > 0 ? problems.join(" ") : null;
		},
		onStep: (usage) => opts.onUsage?.(usage),
	});
}

/** Type guard for downstream callers that branch on success. */
export function meaningInferSuccess(r: MeaningInferResult): r is MeaningInferSuccess {
	return !("insufficient" in r && r.insufficient === true);
}