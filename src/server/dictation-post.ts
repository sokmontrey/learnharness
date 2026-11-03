/**
 * One fast-model pass over a finished dictation. No Fast model, a catalog
 * miss, a timeout, or a reply that is not word-level repairs: the raw
 * transcript is returned. Dictation never fails closed.
 */
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { acceptDictationRepair, dictationRepairPrompt, dictationSentencePrompt, validateDictationRepair } from "../../lib/dictation-markup.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { readSettings } from "../store/settings.ts";

const REPAIR_TIMEOUT_MS = 12_000;

function assistantText(message: { content: Array<{ type: string; text?: string }> }): string {
	return message.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text ?? "")
		.join("");
}

export async function repairDictation(text: string, ask: string, context: string = ""): Promise<string> {
	if (!text.trim()) return text;
	const slot = readSettings()?.models?.fast;
	if (!slot?.model) return text;
	try {
		const engine = piEngineForSpec({
			provider: slot.model.provider,
			id: slot.model.id,
			thinkingLevel: slot.thinkingLevel,
		});
		const opts = {
			reasoning: engine.level && engine.level !== "off" ? engine.level : undefined,
			timeoutMs: REPAIR_TIMEOUT_MS,
			maxRetries: 0,
		} as const;

		// Pass 1: word-level repairs with markup.
		const message = await completeSimple(
			engine.model,
			{ messages: [{ role: "user", content: dictationRepairPrompt(text, ask, context), timestamp: Date.now() }] },
			opts,
		);
		if (!message.errorMessage) {
			const out = assistantText(message).trim();
			if (out) {
				const accepted = acceptDictationRepair(text, out);
				const valid = validateDictationRepair(text, accepted);
				console.log("[dictation] repair:word", { input: text, output: accepted, valid });
				if (valid && accepted !== text) return accepted;
			}
		}

		// Pass 2 (hybrid fallback): full sentence correction without markup.
		const fallback = await completeSimple(
			engine.model,
			{ messages: [{ role: "user", content: dictationSentencePrompt(text, ask, context), timestamp: Date.now() }] },
			opts,
		);
		if (!fallback.errorMessage) {
			const out = assistantText(fallback).trim();
			if (out) {
				const accepted = acceptDictationRepair(text, out);
				const valid = validateDictationRepair(text, accepted);
				console.log("[dictation] repair:sentence", { input: text, output: accepted, valid });
				if (valid) return accepted;
			}
		}
		return text;
	} catch {
		return text;
	}
}
