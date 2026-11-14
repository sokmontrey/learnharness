"use client";

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ask } from "@/components/ask";
import { resolveRoleSpec, resolveSettings } from "@/src/core";
import type { AskContextView, LhMessage } from "@/src/core";

interface AskPanelProps {
	chatId: string;
	title: string;
	onClose: () => void;
}

/**
 * Embedded Ask thread (owner, 2026-11): fetches the Ask record + settings and
 * renders the Ask surface inside the session's right sidebar instead of a
 * dedicated page. Re-fetches when chatId changes.
 */
export function AskPanel({ chatId, title, onClose }: AskPanelProps) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [messages, setMessages] = useState<LhMessage[]>([]);
	const [context, setContext] = useState<AskContextView>({ links: [], pins: [] });
	const [configured, setConfigured] = useState(false);
	const [inFlight, setInFlight] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const [chatRes, settingsRes] = await Promise.all([
					fetch(`/api/chats/${chatId}`),
					fetch("/api/settings"),
				]);
				if (!chatRes.ok) throw new Error("Could not load Ask thread.");
				const chat = (await chatRes.json()) as {
					messages?: LhMessage[];
					ask?: AskContextView;
					askContext?: AskContextView;
					turnInFlight?: boolean;
				};
				const settingsRaw = (await settingsRes.json().catch(() => null)) as { settings?: unknown } | null;
				const settings = resolveSettings((settingsRaw?.settings ?? null) as never);
				if (cancelled) return;
				setMessages(chat.messages ?? []);
				setContext(chat.askContext ?? chat.ask ?? { links: [], pins: [] });
				setConfigured(Boolean(resolveRoleSpec("ask", (settingsRaw?.settings ?? null) as never)));
				setInFlight(Boolean(chat.turnInFlight));
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Could not load Ask thread.");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [chatId]);

	if (loading) {
		return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading Ask…</div>;
	}
	if (error) {
		return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{error}</div>;
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
				<span className="truncate font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">Ask</span>
				<Button type="button" size="icon-xs" variant="ghost" aria-label="Close Ask panel" onClick={onClose}>
					<XIcon className="size-3.5" />
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				<Ask
					key={chatId}
					chatId={chatId}
					title={title}
					initialMessages={messages}
					initialContext={context}
					initialConfigured={configured}
					initiallyInFlight={inFlight}
				/>
			</div>
		</div>
	);
}
