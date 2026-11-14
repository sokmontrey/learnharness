/**
 * One Ask turn (owner, 2026-11): the lean sibling of handleChatInput.
 *
 * Ask is deliberately NOT the teaching composition: no strong-slot gate, no
 * compaction, no extraction, no tools. It resolves the GLOBAL Ask role
 * (settings → agent.models.ask → cheap slot), retrieves the relevant turns
 * from the thread's linked sessions, and runs ONE model call through the
 * same background-turn machinery (write-ahead persistence, liveness, usage
 * logging, reattach) so the surface's streaming is free.
 *
 * The context rides the system prompt, never the visible transcript: the Ask
 * record stores only the learner's questions and the assistant's answers;
 * retrieved source turns are recomputed each turn.
 */

import type { Usage } from "@earendil-works/pi-ai";
import { createAskAgent, type AgentBuildOptions, type TeachingAgent } from "../agent/teacher-agent.ts";
import { composeAskSystemPrompt } from "../agent/ask-prompt.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { isSubscriptionProvider } from "../agent/subscription-connections.ts";
import { refreshConnectionCatalog } from "./model-catalog.ts";
import { asAgentMessages } from "../core/native-messages.ts";
import { inputAppends, ChatInputError, type TurnInput } from "../core/input-events.ts";
import { modelsNotConfigured, providerKeyMissing as providerKeyMissingEnvelope } from "../core/settings.ts";
import { emit } from "../core/events.ts";
import type { AskUsedRef, CallUsage, ChatRecord } from "../core/contracts.ts";
import type { EffectiveSettings } from "../core/settings-resolution.ts";
import { providerKeyPresent } from "./keys.ts";
import { beginTurn, endTurn } from "./turn-liveness.ts";
import { registerLiveAgent, unregisterLiveAgent } from "./jobs.ts";
import { runPiTurn } from "./pi/ui-stream.ts";
import { collectToolCallIds } from "./pi/call-ids.ts";
import { registerTurn, unregisterTurn } from "./turn-runs.ts";
import { persistTurn } from "./turn-service.ts";
import { askRetrievalFor } from "./ask-context.ts";
import { stores } from "./stores.ts";

type AskAgentBuilder = (opts: AgentBuildOptions & { teaching: boolean }) => TeachingAgent;

/** The Ask turn entry. The caller (chat-handler) has already loaded the
 *  record and established kind === "ask". */
export async function handleAskInput(
	chatId: string,
	record: ChatRecord,
	input: TurnInput,
	effective: EffectiveSettings,
	buildAgent?: AskAgentBuilder,
): Promise<Response> {
	// THE ASK MODEL GATE (BYOK, same envelope family as the turn gate): the
	// global Ask role — its own override over the cheap slot. No model =
	// honest 503; the surface offers Settings → Agent → Models (Ask).
	const spec = effective.agent.models.ask;
	if (!spec) {
		const envelope = modelsNotConfigured(["cheap"]);
		console.info(`[chat ${chatId}] ask turn refused — ${JSON.stringify(envelope)}`);
		return Response.json(envelope, { status: 503 });
	}
	if (isSubscriptionProvider(spec.provider)) {
		await refreshConnectionCatalog(spec.provider);
	}
	if (!providerKeyPresent(spec.provider)) {
		const envelope = providerKeyMissingEnvelope(spec.provider, ["cheap"]);
		console.info(`[chat ${chatId}] ask turn refused — ${JSON.stringify(envelope)}`);
		return Response.json(envelope, { status: 503 });
	}

	let engine: PiEngine;
	try {
		engine = piEngineForSpec(spec, false);
	} catch {
		return Response.json({ error: "The selected Ask model is unavailable." }, { status: 503 });
	}
	const modelId = `${engine.model.provider}:${engine.model.id}`;

	// The input's native appends (the same text-event contract as teaching).
	// Computed before beginTurn so a malformed input leaves no liveness.
	// Ask has no steer channel — a steer input is a programming error.
	if (input.type === "steers") {
		return Response.json({ error: "Ask threads do not accept automatic steers" }, { status: 400 });
	}
	let appends;
	try {
		appends = inputAppends(record, input);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	if (!beginTurn(chatId)) {
		console.info(`[chat ${chatId}] ask turn already in flight — request rejected`);
		return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
	}

	// Write-ahead: the learner's question is durable before the model runs.
	const merged = [...record.messages, ...appends];
	try {
		stores.chatStore.saveMessages(chatId, merged);
	} catch (err) {
		console.error(`[chat ${chatId}] ask write-ahead persist failed:`, err);
	}

	// Retrieval happens against the CURRENT record's links/pins, and the
	// question text is this turn's learner message.
	const question = input.type === "text" ? input.text : "";
	const retrieval = askRetrievalFor(record, question);
	const systemPrompt = composeAskSystemPrompt(retrieval.context);

	const turnUsageId = crypto.randomUUID();
	const steps: CallUsage[] = [];
	const collectUsage = (usage: Usage) => {
		steps.push({
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheReadTokens: usage.cacheRead,
			cacheWriteTokens: usage.cacheWrite,
			cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
			reasoningTokens: usage.reasoning ?? 0,
		});
	};

	const agentOpts: AgentBuildOptions = {
		engine,
		callPurpose: { background: false },
		messages: asAgentMessages(merged),
		onUsage: collectUsage,
		chatId,
		systemPrompt,
	};
	const constructed: TeachingAgent = buildAgent
		? buildAgent({ ...agentOpts, teaching: false })
		: createAskAgent(agentOpts);

	try {
		registerLiveAgent(chatId, constructed);
		const handle = runPiTurn({
			agent: (constructed as unknown as import("@earendil-works/pi-agent-core").Agent),
			usedToolCallIds: new Set(collectToolCallIds(merged)),
			onError: () => "An error occurred.",
			onFinish: (turnMessages, isAborted) => {
				const stamped = persistTurn(stores.chatStore, chatId, merged.length, turnMessages, isAborted);
				const response = stamped.find((m) => (m as { role?: string }).role === "assistant");
				if (response && steps.length > 0) {
					stores.chatStore.appendTurnUsage(chatId, {
						id: turnUsageId,
						messageId: response.id,
						at: new Date().toISOString(),
						model: modelId,
						steps,
					});
				}
				// The indicator log: which source turns this answer actually
				// had in context. One entry per answer message (idempotent).
				if (response && retrieval.used.length > 0) {
					stores.chatStore.appendAskUsage(chatId, {
						messageId: response.id,
						used: retrieval.used satisfies AskUsedRef[],
						at: new Date().toISOString(),
					});
				}
				for (const sourceChatId of retrieval.sourceChatIds) emit("ask-refs-changed", { chatId: sourceChatId });
				endTurn(chatId);
				unregisterTurn(chatId);
				unregisterLiveAgent(chatId);
			},
		});
		registerTurn(chatId, handle);
		return Response.json({ ok: true });
	} catch (err) {
		endTurn(chatId);
		unregisterLiveAgent(chatId);
		console.error(`[chat ${chatId}] ask turn failed to start:`, err);
		return Response.json({ error: "Failed to start the Ask turn" }, { status: 500 });
	}
}
