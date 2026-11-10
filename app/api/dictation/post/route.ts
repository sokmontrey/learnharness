/**
 * POST /api/dictation/post — repair a finished dictation with the Fast
 * model. The body is `{ text, ask }`. `ask` is the learner-visible
 * question only. The route always returns `{ text }`: the repair, or the
 * transcript unchanged.
 */
import { repairDictation } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "body must be JSON" }, { status: 400 });
	}
	const raw = body as { text?: unknown; ask?: unknown; context?: unknown };
	if (typeof raw.text !== "string") {
		return Response.json({ error: "text must be a string" }, { status: 400 });
	}
	const ask = typeof raw.ask === "string" ? raw.ask : "";
	const context = typeof raw.context === "string" ? raw.context : "";
	const text = await repairDictation(raw.text, ask, context);
	return Response.json({ text });
}
