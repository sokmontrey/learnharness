import { chainsForSelection, formatChainLine } from "@/src/core";
import { newGraphContextMessage, type GraphContextPick } from "@/src/core";
import {
	compactionInFlight,
	createChat,
	isAskSourceChat,
	isTurnRunning,
	listChats,
	makeAskPin,
	parseAskPinInput,
	readSettingsRecord,
	stores,
	titleFromPrompt,
} from "@/src/server";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight". */
export async function GET() {
	const chats: ChatListItem[] = listChats().map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
	}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as {
		title?: unknown;
		kind?: unknown;
		graphContext?: unknown;
		ask?: unknown;
	};
	const title = typeof body.title === "string" ? body.title : "";
	// Practice/Ask sessions (owner, 2026-10-04 / 2026-11): the kind marker
	// selects the agent + storage semantics from birth.
	const kind = body.kind === "practice" ? ("practice" as const) : body.kind === "ask" ? ("ask" as const) : undefined;
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind);

	// ASK CREATION (owner, 2026-11): a thread born from a snippet carries its
	// initial link(s) and pin(s) atomically with creation. Ask threads have no
	// per-session model stamp — their model is the global Ask role.
	if (kind === "ask") {
		const ask = body.ask !== null && typeof body.ask === "object" && !Array.isArray(body.ask)
			? (body.ask as Record<string, unknown>)
			: {};
		const linkIds = Array.isArray(ask.links)
			? [...new Set(ask.links.filter((id): id is string => typeof id === "string" && id.length > 0))]
			: [];
		for (const linkId of linkIds) {
			if (isAskSourceChat(linkId)) {
				stores.chatStore.addAskLink(chat.id, { chatId: linkId, linkedAt: new Date().toISOString() });
			}
		}
		const pins = Array.isArray(ask.pins) ? ask.pins : [];
		for (const raw of pins) {
			const pin = parseAskPinInput(raw);
			if (pin && isAskSourceChat(pin.chatId)) stores.chatStore.addAskPin(chat.id, makeAskPin(pin));
		}
		return Response.json({ id: chat.id, title: chat.title });
	}

	// PER-SESSION MODELS (owner, 2026-09-28): a session owns its model +
	// thinking level from birth — stamped verbatim from the STRONG slot,
	// the new-session default. From here the strong slot never reaches
	// this session again: in-session picks write the session's own record
	// (PUT /api/chats/:id/settings). No strong slot configured (fresh BYOK
	// boot) → no stamp; the turn gate's 503 models_not_configured envelope
	// refuses honestly until the setup flow fills the slot.
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	// The session's map context (owner, 2026-10-04): the picked
	// propositions ride the CREATION — message[0] is a graph-context
	// marker (a separate custom message BEFORE the learner's first user
	// message), carrying the picks plus the reasoning chains among them.
	// The picks carry their own name/statement (what the learner saw at
	// pick time); the chains derive from the CURRENT graph snapshot.
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, 64)
			: [];
	if (picks.length > 0) {
		const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
			formatChainLine(c, Object.fromEntries(byId)),
		);
		stores.chatStore.saveMessages(chat.id, [newGraphContextMessage(picks, chainLines)]);
	}
	return Response.json({ id: chat.id, title: chat.title });
}
