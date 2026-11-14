import { askRefsFor, getChat } from "@/src/server";

/**
 * GET /api/chats/[id]/ask-refs (owner, 2026-11): every Ask thread that
 * refers to this teaching/practice transcript — pinned passages and turns
 * retrieved into an answer's context. The transcript merges entries at the
 * turn anchor and renders one stacked indicator per thread.
 *
 * Notification happens through ask-refs-changed; this route is the fetch
 * half of the notify-then-fetch contract.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ refs: askRefsFor(id) });
}
