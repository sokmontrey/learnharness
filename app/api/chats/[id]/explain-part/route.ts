/**
 * "EXPLAIN THIS PART" (annotation wave, owner 2026-11): POST /api/chats/:id/explain
 * → { text } from the explain sub-agent — synchronous (the caller is a
 * popover waiting on the response, not a background job). Body:
 * { targetMessageId, pointer } — `targetMessageId` anchors the last-two-
 * turns context window, `pointer` is the selected span or the learner's
 * typed question. 404 unknown chat, 400 empty pointer, 503 the usual
 * BYOK refusal envelopes (models_not_configured / provider_key_missing),
 * 502 if the sub-agent call itself fails.
 */
import { explainPart } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const body = (await req.json().catch(() => null)) as { targetMessageId?: unknown; pointer?: unknown } | null;
	const targetMessageId = typeof body?.targetMessageId === "string" ? body.targetMessageId : "";
	const pointer = typeof body?.pointer === "string" ? body.pointer : "";
	if (!targetMessageId) return Response.json({ error: "Missing targetMessageId" }, { status: 400 });

	const outcome = await explainPart(id, targetMessageId, pointer);
	if (!outcome.ok) return Response.json(outcome.body, { status: outcome.status });
	return Response.json({ text: outcome.text });
}
