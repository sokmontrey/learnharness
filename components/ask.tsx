"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtSignIcon, PinIcon, SendIcon, XIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { useChatSession } from "@/components/session";
import type { AskContextView, ChatListItem, LhMessage } from "@/src/core";
import { cn } from "@/lib/utils";

/**
 * The Ask surface (owner, 2026-11): a lean Q&A thread beside Teaching and
 * Practice. No teacher chrome, no plan/question machinery — a transcript,
 * the thread's linked-session + pinned-passage chips, and one composer.
 *
 * Ask is ONE fast model call per question. Retrieval is server-side
 * (core/ask-context.ts) from the linked sessions and pins; the visible
 * transcript stores only questions and answers. `@` opens the session
 * picker and links the chosen teaching/practice session to the whole
 * thread (context scope is thread-level by design).
 */

export interface AskProps {
	chatId: string;
	title: string;
	initialMessages: LhMessage[];
	initialContext: AskContextView;
	/** The global Ask role resolves to a model (own override or cheap slot). */
	initialConfigured: boolean;
	initiallyInFlight: boolean;
	/** Click-through target from a transcript indicator (?at=<answer id>). */
	atAnswerId?: string;
	/** First question from the create-then-redirect flow (?prompt=). */
	initialPrompt?: string;
}

interface PickableSession {
	id: string;
	title: string;
	kind?: string;
}

/** Does the ?prompt seed still owe its first send? The gate is "no real
 *  conversation yet" — NOT emptiness (a thread may carry scaffolding).
 *  Same law as Chat's initialPromptOwed. */
export function askInitialPromptOwed(messages: readonly { role: string }[], prompt: string | undefined): boolean {
	if (!prompt) return false;
	return !messages.some((m) => m.role === "user" || m.role === "assistant");
}

export function Ask({
	chatId,
	title,
	initialMessages,
	initialContext,
	initialConfigured,
	initiallyInFlight,
	atAnswerId,
	initialPrompt,
}: AskProps) {
	const session = useChatSession({ chatId, initialMessages, initiallyInFlight });
	const { open: openSettings } = useSettingsDialog();
	const [context, setContext] = useState<AskContextView>(initialContext);
	const [draft, setDraft] = useState("");
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerQuery, setPickerQuery] = useState("");
	const [sessions, setSessions] = useState<PickableSession[] | null>(null);
	const [pickerIndex, setPickerIndex] = useState(0);
	const [configured, setConfigured] = useState(initialConfigured);
	const [error, setError] = useState<string | null>(null);
	const [highlightId, setHighlightId] = useState<string | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	// New-thread seed (home/sidebar ask doors route here with ?prompt=):
	// send the first question exactly once, same law as Chat.
	const sentInitial = useRef(false);
	useEffect(() => {
		if (!sentInitial.current && askInitialPromptOwed(initialMessages, initialPrompt)) {
			sentInitial.current = true;
			session.send({ type: "text", text: initialPrompt! });
		}
	}, [initialPrompt, initialMessages, session]);

	const busy = session.status === "submitted" || session.status === "streaming";
	const linkedIds = useMemo(() => new Set(context.links.map((l) => l.chatId)), [context.links]);
	const pickable = useMemo(() => {
		const q = pickerQuery.trim().toLowerCase();
		return (sessions ?? [])
			.filter((s) => (s.kind ?? "teach") !== "ask")
			.filter((s) => !linkedIds.has(s.id))
			.filter((s) => !q || s.title.toLowerCase().includes(q))
			.slice(0, 20);
	}, [sessions, pickerQuery, linkedIds]);

	// Keep the keyboard highlight in range as the filter narrows.
	useEffect(() => {
		setPickerIndex((i) => (pickable.length === 0 ? 0 : Math.min(i, pickable.length - 1)));
	}, [pickable.length]);

	// Keep the transcript pinned to the newest answer.
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [session.messages.length, session.status]);

	// Indicator click-through: scroll to the referenced answer and flash it.
	useEffect(() => {
		if (!atAnswerId) return;
		const ok = session.messages.some((m) => m.id === atAnswerId);
		if (!ok) return;
		setHighlightId(atAnswerId);
		const timer = window.setTimeout(() => {
			document.querySelector(`[data-ask-message="${CSS.escape(atAnswerId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
		}, 80);
		return () => window.clearTimeout(timer);
	}, [atAnswerId, session.messages]);

	const postContext = useCallback(
		async (body: Record<string, unknown>) => {
			setError(null);
			const res = await fetch(`/api/chats/${chatId}/ask-context`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = (await res.json().catch(() => null)) as { context?: AskContextView; error?: string } | null;
			if (!res.ok || !data?.context) {
				setError(data?.error ?? "Could not update the Ask references.");
				return false;
			}
			setContext(data.context);
			return true;
		},
		[chatId],
	);

	const loadSessions = useCallback(async () => {
		if (sessions) return;
		const res = await fetch("/api/chats");
		const data = (await res.json().catch(() => null)) as { chats?: ChatListItem[] } | null;
		setSessions((data?.chats ?? []).map((c) => ({ id: c.id, title: c.title, kind: c.kind })));
	}, [sessions]);

	const openPicker = useCallback(
		(query = "") => {
			setPickerQuery(query);
			setPickerOpen(true);
			setPickerIndex(0);
			void loadSessions();
		},
		[loadSessions],
	);

	const linkSession = useCallback(
		async (source: PickableSession) => {
			const ok = await postContext({ action: "link", chatId: source.id });
			if (!ok) return;
			setPickerOpen(false);
			setPickerQuery("");
			setPickerIndex(0);
			setDraft((prev) => prev.replace(/(?:^|\s)@[^\s@]*$/, " ").trimStart());
			textareaRef.current?.focus();
		},
		[postContext],
	);

	const send = useCallback(() => {
		const text = draft.trim();
		if (!text || busy || !configured) return;
		setDraft("");
		setPickerOpen(false);
		session.send({ type: "text", text });
	}, [draft, busy, configured, session]);

	// A 503 on the first send means the Ask model was never configured; the
	// surface turns the refusal into a direct Settings path instead of a
	// generic error banner.
	useEffect(() => {
		if (!session.error) return;
		const message = session.error.message;
		const notConfigured = message.includes("No model configured") || message.includes("No provider key");
		if (notConfigured) setConfigured(false);
	}, [session.error]);

	const onDraftChange = (value: string, cursor: number) => {
		setDraft(value);
		const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, cursor));
		if (match) openPicker(match[1] ?? "");
		else if (pickerOpen && !value.slice(0, cursor).endsWith("@")) setPickerOpen(false);
	};

	const grouped = useMemo(() => session.messages.filter((m) => m.role === "assistant" || m.role === "user"), [session.messages]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex shrink-0 items-baseline gap-3 border-b border-border/60 px-6 py-4">
				<span className="font-ui text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ask</span>
				<h1 className="min-w-0 truncate font-serif text-lg">{title}</h1>
			</header>

			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
					{grouped.length === 0 && (
						<div className="py-16 text-center text-sm text-muted-foreground">
							Ask about anything in your teaching or practice sessions. Link a session with{" "}
							<span className="font-mono text-foreground">@</span>.
						</div>
					)}
					{grouped.map((message) => {
						const text = message.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
						if (!text.trim()) return null;
						if (message.role === "user") {
							return (
								<div key={message.id} className="w-full border-l-[calc(3ch-14px)] border-muted-foreground/30 bg-card py-1 pl-[14px] pr-4 font-ui text-xs">
									<div className="font-medium uppercase tracking-wide text-muted-foreground">You</div>
									<div className="lh-prose whitespace-pre-wrap text-foreground">{text}</div>
								</div>
							);
						}
						return (
							<div
								key={message.id}
								data-ask-message={message.id}
								className={cn(
									"rounded-lg transition-colors",
									highlightId === message.id && "bg-accent/50 ring-1 ring-border",
								)}
							>
								<MessageResponse className="text-[15px]">{text}</MessageResponse>
							</div>
						);
					})}
					{busy && <div className="font-ui text-xs text-muted-foreground">Thinking…</div>}
					{session.error && !configured && (
						<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							<span>The Ask model is not set up.</span>
							<Button type="button" size="xs" variant="secondary" onClick={() => openSettings("agent")}>
								Set up the Ask model
							</Button>
						</div>
					)}
					{session.error && configured && <div className="text-sm text-muted-foreground">{session.error.message}</div>}
					{error && <div className="text-sm text-muted-foreground">{error}</div>}
				</div>
			</div>

			<div className="shrink-0 border-t border-border/60 bg-background/95 px-6 py-4">
				<div className="mx-auto w-full max-w-3xl">
					{(context.links.length > 0 || context.pins.length > 0) && (
						<div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="ask-context-chips">
							{context.links.map((link) => (
								<span
									key={link.chatId}
									title={link.missing ? "This session no longer exists" : `Linked session: ${link.title}`}
									className={cn(
										"inline-flex max-w-64 items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 font-ui text-xs",
										link.missing ? "text-muted-foreground/60 line-through" : "text-muted-foreground",
									)}
								>
									<AtSignIcon className="size-3 shrink-0" />
									<span className="truncate">{link.title}</span>
									<button
										type="button"
										aria-label={`Unlink ${link.title}`}
										className="cursor-pointer rounded-full p-0.5 hover:bg-accent hover:text-foreground"
										onClick={() => void postContext({ action: "unlink", chatId: link.chatId })}
									>
										<XIcon className="size-3" />
									</button>
								</span>
							))}
							{context.pins.map((pin) => (
								<span
									key={pin.id}
									title={pin.text}
									className="inline-flex max-w-64 items-center gap-1 rounded-full border border-border/70 bg-card px-2 py-0.5 font-ui text-xs text-muted-foreground"
								>
									<PinIcon className="size-3 shrink-0" />
									<span className="truncate">{pin.label ?? pin.text}</span>
									<button
										type="button"
										aria-label="Remove pinned reference"
										className="cursor-pointer rounded-full p-0.5 hover:bg-accent hover:text-foreground"
										onClick={() => void postContext({ action: "unpin", pinId: pin.id })}
									>
										<XIcon className="size-3" />
									</button>
								</span>
							))}
						</div>
					)}

					<div className="relative">
						{pickerOpen && (
							<div
								data-testid="ask-session-picker"
								className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
							>
								<div className="border-b border-border/60 px-3 py-2 font-ui text-xs text-muted-foreground">Link a session — ↑↓ navigate, Enter/Tab select, Esc close</div>
								<div className="max-h-64 overflow-y-auto p-1">
									{pickable.length === 0 ? (
										<div className="px-2 py-3 text-xs text-muted-foreground">
											{sessions === null ? "Loading…" : "No sessions left to link."}
										</div>
									) : (
										pickable.map((s, i) => (
											<button
												key={s.id}
												type="button"
												onClick={() => void linkSession(s)}
												className={cn(
												"flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
												i === pickerIndex ? "bg-accent text-foreground" : "hover:bg-accent",
											)}
											>
												<AtSignIcon className="size-3 shrink-0 text-muted-foreground" />
												<span className="truncate">{s.title}</span>
												<span className="ml-auto font-ui text-[10px] uppercase tracking-wide text-muted-foreground">
													{(s.kind ?? "teach") === "practice" ? "Practice" : "Teaching"}
												</span>
											</button>
										))
									)}
								</div>
							</div>
						)}
						<div className="flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2">
							<button
								type="button"
								aria-label="Link a session"
								title="Link a session (@)"
								disabled={!configured}
								onClick={() => openPicker("")}
								className="mb-1 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
							>
								<AtSignIcon className="size-4" />
							</button>
							<textarea
								ref={textareaRef}
								value={draft}
								rows={1}
								placeholder={configured ? "Ask a question…" : "Set up the Ask model first"}
								disabled={!configured}
								onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
								onKeyDown={(e) => {
									if (pickerOpen && pickable.length > 0) {
										if (e.key === "ArrowDown") {
											e.preventDefault();
											setPickerIndex((i) => (i + 1) % pickable.length);
											return;
										}
										if (e.key === "ArrowUp") {
											e.preventDefault();
											setPickerIndex((i) => (i - 1 + pickable.length) % pickable.length);
											return;
										}
										if (e.key === "Tab") {
											e.preventDefault();
											void linkSession(pickable[pickerIndex]!);
											return;
										}
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											void linkSession(pickable[pickerIndex]!);
											return;
										}
									}
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										send();
									} else if (e.key === "Escape") {
										setPickerOpen(false);
									}
								}}
								className="max-h-40 min-h-6 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
							/>
							<Button
								type="button"
								size="icon-xs"
								variant="secondary"
								aria-label="Send question"
								disabled={!configured || busy || !draft.trim()}
								onClick={send}
								className="mb-0.5"
							>
								<SendIcon className="size-3.5" />
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
