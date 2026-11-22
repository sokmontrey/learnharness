/**
 * POST /api/chats/:id/infer-meaning — structured French clues + definition for
 * the staged "Deviner le sens" panel. Body: { targetMessageId, pointer }.
 */
import { inferMeaningPart } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const body = (await req.json().catch(() => null)) as { targetMessageId?: unknown; pointer?: unknown } | null;
	const targetMessageId = typeof body?.targetMessageId === "string" ? body.targetMessageId : "";
	const pointer = typeof body?.pointer === "string" ? body.pointer : "";
	if (!targetMessageId) return Response.json({ error: "Missing targetMessageId" }, { status: 400 });

	const outcome = await inferMeaningPart(id, targetMessageId, pointer);
	if (!outcome.ok) return Response.json(outcome.body, { status: outcome.status });
	return Response.json({ result: outcome.result });
}