/**
 * THE MEANING-INFER REQUEST: synchronous sub-agent for "Deviner le sens" on
 * selection — same seam as explain.ts (popover waits on HTTP).
 */
import { runMeaningInferer } from "../agent/subagents/meaning-inferer.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { explainContextProse, lastTwoTurnsSlice } from "../core/explain-context.ts";
import {
	modelsNotConfigured,
	providerKeyMissing as providerKeyMissingEnvelope,
	type ModelsNotConfigured,
	type ProviderKeyMissing,
} from "../core/settings.ts";
import type { MeaningInferResult } from "../core/meaning-infer.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { providerKeyPresent } from "./keys.ts";
import { stores } from "./stores.ts";

export interface InferMeaningOutcome {
	ok: true;
	result: MeaningInferResult;
}

export interface InferMeaningRefusal {
	ok: false;
	status: number;
	body: ModelsNotConfigured | ProviderKeyMissing | { error: string };
}

export async function inferMeaningPart(
	chatId: string,
	targetMessageId: string,
	pointer: string,
): Promise<InferMeaningOutcome | InferMeaningRefusal> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { ok: false, status: 404, body: { error: "Unknown chat" } };
	if (!pointer.trim()) return { ok: false, status: 400, body: { error: "Nothing to infer" } };

	const spec = resolveRoleSpec("explainer", stores.settingsStore.readSettings());
	if (!spec) return { ok: false, status: 503, body: modelsNotConfigured(["cheap"]) };
	if (!providerKeyPresent(spec.provider)) return { ok: false, status: 503, body: providerKeyMissingEnvelope(spec.provider, ["cheap"]) };

	const engine = piEngineForSpec(spec, true);
	const slice = lastTwoTurnsSlice(record.messages, targetMessageId);
	const contextProse = explainContextProse(slice);

	try {
		const result = await runMeaningInferer(contextProse, pointer, { engine, chatId });
		return { ok: true, result };
	} catch (err) {
		return { ok: false, status: 502, body: { error: err instanceof Error ? err.message : "Infer meaning failed" } };
	}
}