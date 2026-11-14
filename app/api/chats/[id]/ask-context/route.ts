import { emit } from "@/src/core/events";
import {
	askContextView,
	getChat,
	isAskSourceChat,
	makeAskPin,
	parseAskPinInput,
	stores,
} from "@/src/server";

/**
 * POST /api/chats/[id]/ask-context (owner, 2026-11): the Ask surface's one
 * context writer — link/unlink a session, pin/unpin a passage. Replace-free
 * actions keep the client simple and the stored context delta-shaped.
 *
 * Every mutating action returns the RESOLVED context (titles included) so
 * the chips update without a second fetch. Pin/unlink changes emit
 * ask-refs-changed for the affected source: the transcript indicators live
 * in another window and must refresh.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const record = getChat(id);
	if (!record) return Response.json({ error: "Not found" }, { status: 404 });
	if (record.kind !== "ask") return Response.json({ error: "Not an Ask thread" }, { status: 409 });

	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	const action = typeof body?.action === "string" ? body.action : "";
	const sourceChatId = typeof body?.chatId === "string" ? body.chatId : "";

	switch (action) {
		case "link": {
			if (!sourceChatId || sourceChatId === id) {
				return Response.json({ error: "chatId must name a source session" }, { status: 400 });
			}
			if (!isAskSourceChat(sourceChatId)) {
				return Response.json({ error: "Unknown teaching/practice session" }, { status: 404 });
			}
			stores.chatStore.addAskLink(id, { chatId: sourceChatId, linkedAt: new Date().toISOString() });
			break;
		}
		case "unlink": {
			if (!sourceChatId) return Response.json({ error: "chatId is required" }, { status: 400 });
			stores.chatStore.removeAskLink(id, sourceChatId);
			emit("ask-refs-changed", { chatId: sourceChatId });
			break;
		}
		case "pin": {
			const pin = parseAskPinInput(body?.pin);
			if (!pin) return Response.json({ error: "Invalid pin" }, { status: 400 });
			if (pin.chatId === id || !isAskSourceChat(pin.chatId)) {
				return Response.json({ error: "Unknown teaching/practice session" }, { status: 404 });
			}
			stores.chatStore.addAskPin(id, makeAskPin(pin));
			emit("ask-refs-changed", { chatId: pin.chatId });
			break;
		}
		case "unpin": {
			const pinId = typeof body?.pinId === "string" ? body.pinId : "";
			if (!pinId) return Response.json({ error: "pinId is required" }, { status: 400 });
			const pin = (record.ask?.pins ?? []).find((p) => p.id === pinId);
			stores.chatStore.removeAskPin(id, pinId);
			if (pin) emit("ask-refs-changed", { chatId: pin.chatId });
			break;
		}
		default:
			return Response.json({ error: "Unknown action" }, { status: 400 });
	}

	const fresh = getChat(id);
	return Response.json({ context: askContextView(fresh ?? record) });
}
