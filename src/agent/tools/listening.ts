import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult } from "../tool-execute.ts";
import { listeningResult } from "../tool-execute.ts";
import { listeningInputObject, listeningInputProblems } from "../../core/listening-core.ts";

/** Mechanical description only — craft lives in prompts/shared/35-listening.md */
const LISTENING_DESCRIPTION =
	"End every turn with exactly one listening dictation clip. " +
	"The learner hears targetText via TTS and types it in the dock — do NOT spell targetText verbatim in your prose (anti-spoiler). " +
	"When you also call a quiz/ask in the same turn, call listening FIRST, then the question. " +
	"targetText: one short French sentence central to this turn. contextText: optional English setup for the dock.";

export const listeningTool: AgentTool<typeof listeningInputObject> = {
	name: "listening",
	label: "listening",
	description: LISTENING_DESCRIPTION,
	parameters: listeningInputObject,
	executionMode: "sequential",
	execute: async (_toolCallId, input) => {
		const problems = listeningInputProblems(input);
		if (problems.length > 0) return invalidInputResult("listening", problems);
		return listeningResult();
	},
};