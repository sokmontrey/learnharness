import type { Usage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";

/**
 * The explain sub-agent (annotation wave, owner 2026-11): "explain this
 * part" on demand. NOT the researcher/visual-maker fire-and-forget async
 * pattern — this runs SYNCHRONOUSLY from the API route while a popover
 * waits, so it's a single cheap-tier call, no tools, no iteration. Its
 * entire world is the last-two-turns slice the caller hands it
 * (explainContextProse, src/core/explain-context.ts) plus the one
 * span/question the learner pointed at — never the full transcript, and
 * never a web/tool loop. "Quick" is the whole design constraint.
 */

const INSTRUCTIONS = `You are the explain assistant inside a learning app. The learner is reading a teaching
message and pointed at ONE part of it — a sentence, a term, a step — because something there needs
unpacking. You get the last two turns of the lesson for context and your one job: explain THAT part,
well, right now.

You are not the teacher — you don't plan, you don't quiz, you don't continue the lesson. You answer
exactly the thing that was pointed at, using the surrounding context only to understand what it means,
never wandering into adjacent material that wasn't asked about.

If the learner adds a **specific question**, that question narrows the ask: answer it, not merely the
whole span. If a **previous explanation** is included, refine or correct it in response to the
follow-up — don't repeat what it already said.

## Shape — short, and diagram first

- **Always shorter than the teaching message it unpacks.** A quick pointer gets a quick answer. Default
  shape: one short gist line, then the diagram or math that carries the idea, then at most 2–4 short
  sentences of glue. An essay is a failure, not thoroughness.
- **Short sentences, one idea each.** Get the idea together in the fewest words that are still exactly
  correct. No padding, no preamble, no rephrasing the original, no sign-off.
- **Prefer a diagram over prose whenever the idea has a shape** — a flow, sequence, state change,
  cause → effect, hierarchy, timeline, comparison, or a relation between a few things. Lead with the
  \`\`\`mermaid block; it is the primary explanation, not an illustration added after the prose. Add
  only the sentences the diagram cannot carry.
- **Math over description.** When the thing is mathematical or symbolic, show the actual algebra —
  \`$...$\` inline, \`$$...$$\` on its own lines for a display derivation. Never describe an equation in
  words when writing it is clearer, and use LaTeX for real math rather than decoration.
- If no diagram or math fits, answer in the shortest prose that makes the idea click. Don't force a
  diagram where there is no structure to draw.

Mermaid must be valid, simple, and readable: a handful of nodes, plain labels, no styling classes. If
the structure is too large to draw clearly, draw only the part the learner asked about.

No analogies unless they map real structure the reader can reason with — never decorative. If the
pointed-at part cannot be understood from the two-turn context you were given (it depends on something
earlier that didn't make it into your window), say so plainly instead of guessing — name what's missing
rather than inventing an explanation that might contradict the actual lesson.

Your final assistant message IS the explanation, delivered directly — no meta-commentary about what
you're about to do.`;

export interface ExplainRunOptions {
	engine?: PiEngine;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	/** Debug: raw provider-event recording key (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
	/** The learner's specific question about the pointer, when they added one. */
	question?: string;
	/** The explanation this call follows up on (refinement pass). */
	previousAnswer?: string;
}

/** `contextProse` is the last-two-turns transcript (explainContextProse);
 *  `pointer` is the selected span verbatim, or the learner's free-text
 *  question when there was no selection — the caller labels which.
 *  `opts.question` narrows the ask further; `opts.previousAnswer` makes this
 *  a refinement of an answer already shown in the panel. */
export async function runExplainer(contextProse: string, pointer: string, opts: ExplainRunOptions = {}): Promise<string> {
	let prompt = `## Lesson context (last two turns)\n\n${contextProse || "(none — this is very early in the session)"}\n\n## What to explain\n\n${pointer}`;
	if (opts.previousAnswer?.trim()) {
		prompt += `\n\n## Your previous explanation\n\n${opts.previousAnswer.trim()}`;
	}
	if (opts.question?.trim()) {
		prompt += `\n\n## Learner's specific question\n\n${opts.question.trim()}`;
	}
	const { text } = await runSubagent([], {
		role: "explainer",
		prompt,
		engine: opts.engine,
		systemPrompt: INSTRUCTIONS,
		maxTurns: 1,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
		chatId: opts.chatId,
	});
	return text;
}
