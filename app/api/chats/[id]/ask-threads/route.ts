import { askThreadsForSource, getChat } from "@/src/server";

/**
 * GET /api/chats/[id]/ask-threads (owner, 2026-11): every Ask thread that
 * refers to this teaching/practice session — linked or pinned. Powers the
 * session-level Ask popover ("Ask history").
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json({ threads: askThreadsForSource(id) });
}
