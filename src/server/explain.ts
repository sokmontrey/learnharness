/**
 * THE EXPLAIN REQUEST (annotation wave, owner 2026-11): the server-layer
 * seam for "explain this part" — app/ never touches src/agent directly
 * (the architecture law), so this wraps the explainer sub-agent
 * (src/agent/subagents/explainer.ts) the same way chat-handler wraps the
 * teaching agents. SYNCHRONOUS by design (unlike research/visual/demo,
 * which are fire-and-forget jobs): the caller is a popover waiting on an
 * HTTP response, so there is no job queue here — one direct call, one
 * cheap-tier model, no tools, done.
 */
import { runExplainer } from "../agent/subagents/explainer.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { explainContextProse, lastTwoTurnsSlice } from "../core/explain-context.ts";
import { emit } from "../core/events.ts";
import { newExplainNoteMessage, type ExplainNoteDetails } from "../core/native-messages.ts";
import { modelsNotConfigured, providerKeyMissing as providerKeyMissingEnvelope, type ModelsNotConfigured, type ProviderKeyMissing } from "../core/settings.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { providerKeyPresent } from "./keys.ts";
import { stores } from "./stores.ts";

export interface ExplainOutcome {
	ok: true;
	text: string;
}

export interface ExplainRefusal {
	ok: false;
	status: number;
	body: ModelsNotConfigured | ProviderKeyMissing | { error: string };
}

/** `targetMessageId` anchors the last-two-turns window (src/core/
 *  explain-context.ts); `pointer` is the selected span verbatim, or the
 *  learner's typed question when there was no selection. `question` is an
 *  extra specific ask about that pointer; `previousAnswer` turns the call
 *  into a refinement of the explanation already on screen. */
export async function explainPart(
	chatId: string,
	targetMessageId: string,
	pointer: string,
	question = "",
	previousAnswer = "",
): Promise<ExplainOutcome | ExplainRefusal> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { ok: false, status: 404, body: { error: "Unknown chat" } };
	if (!pointer.trim() && !question.trim()) return { ok: false, status: 400, body: { error: "Nothing to explain" } };

	const spec = resolveRoleSpec("explainer", stores.settingsStore.readSettings());
	if (!spec) return { ok: false, status: 503, body: modelsNotConfigured(["cheap"]) };
	if (!providerKeyPresent(spec.provider)) return { ok: false, status: 503, body: providerKeyMissingEnvelope(spec.provider, ["cheap"]) };

	const engine = piEngineForSpec(spec, true);
	const slice = lastTwoTurnsSlice(record.messages, targetMessageId);
	const contextProse = explainContextProse(slice);

	try {
		const text = await runExplainer(contextProse, pointer, { engine, chatId, question, previousAnswer });
		return { ok: true, text };
	} catch (err) {
		return { ok: false, status: 502, body: { error: err instanceof Error ? err.message : "Explain failed" } };
	}
}

export interface ExplainNoteOutcome {
	ok: true;
}

export interface ExplainNoteRefusal {
	ok: false;
	status: number;
	body: { error: string };
}

/** Keeps an explain result in the transcript after the margin popover
 *  closes (owner request: "no way to get the explanation back"). UI-only,
 *  write-ahead, turn-less — the same discipline as the dismissal route:
 *  the record is the only state that moves, no agent runs, and
 *  toLlmMessages filters the marker out of the model's own context
 *  (native-messages.ts). */
export function insertExplainNote(chatId: string, details: ExplainNoteDetails): ExplainNoteOutcome | ExplainNoteRefusal {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return { ok: false, status: 404, body: { error: "Unknown chat" } };
	if (!details.text.trim()) return { ok: false, status: 400, body: { error: "Nothing to insert" } };
	const merged = [...record.messages, newExplainNoteMessage(details)];
	stores.chatStore.saveMessages(chatId, merged);
	emit("record-changed", { chatId });
	return { ok: true };
}
