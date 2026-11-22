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

## Hard rules

- **Never use English or any L1** — all fields you produce must be French (except JSON keys).
- **Never put the target's meaning in clue nudges** — nudges orient reading ("Ici, on parle de…") without defining the target.
- Quotes in \`clues[].quote\` must be **verbatim substrings** from the lesson context you were given (minor ellipsis … allowed only mid-quote).
- Disambiguate to the **passage sense** only; do not list dictionary senses.
- At most **3** clues; prefer high-informativeness (contrast markers mais/pourtant/contrairement, appositives, examples par exemple, cause car/donc, coreference).
- \`definition\`: simple French, short, controlled vocabulary (A2–B1); full sentence if possible (COBUILD style).
- \`guessPrompt\`: invite a guess before they see the definition.
- If the two-turn window truly cannot support inference, submit \`insufficient: true\` and \`messageFr\` telling them what to re-read (in French).

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
			const problems = meaningInferProblems(value);
			return problems.length > 0 ? problems.join(" ") : null;
		},
		onStep: (usage) => opts.onUsage?.(usage),
	});
}

/** Type guard for downstream callers that branch on success. */
export function meaningInferSuccess(r: MeaningInferResult): r is MeaningInferSuccess {
	return !("insufficient" in r && r.insufficient === true);
}