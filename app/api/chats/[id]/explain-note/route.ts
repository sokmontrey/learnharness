/**
 * KEEP AN EXPLANATION (annotation wave, owner 2026-11): POST
 * /api/chats/:id/explain-note appends the explain panel's result as a
 * bordered card in the transcript, UI-only (never re-enters the model's
 * context — see native-messages.ts toLlmMessages). This is how "insert the
 * explanation with an indicator border" survives the popover closing.
 */
import { insertExplainNote } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const body = (await req.json().catch(() => null)) as { targetMessageId?: unknown; pointer?: unknown; text?: unknown } | null;
	const targetMessageId = typeof body?.targetMessageId === "string" ? body.targetMessageId : "";
	const pointer = typeof body?.pointer === "string" ? body.pointer : "";
	const text = typeof body?.text === "string" ? body.text : "";
	if (!targetMessageId) return Response.json({ error: "Missing targetMessageId" }, { status: 400 });

	const outcome = insertExplainNote(id, { targetMessageId, pointer, text });
	if (!outcome.ok) return Response.json(outcome.body, { status: outcome.status });
	return Response.json({ ok: true });
}
