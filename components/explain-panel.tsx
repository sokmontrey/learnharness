"use client";

/**
 * "EXPLAIN THIS PART" (annotation wave, owner 2026-11): a margin popover
 * that calls the explain sub-agent (app/api/chats/[id]/explain-part) and
 * renders the result through the SAME markdown path as the transcript
 * (MessageResponse — LaTeX, mermaid, footnote pins all intact). Two
 * triggers feed it (explain-selection-button.tsx for a text selection,
 * the per-message corner button in chat.tsx for a free-text ask) — both
 * go through `useExplain().open(...)`, this module owns the one visible
 * panel and its fetch lifecycle.
 *
 * Placement (owner choice, "the empty space on the side"): pinned to the
 * COLUMN's right edge + a gap when the viewport has room; on narrow
 * viewports (no real margin) it falls back to hugging the column's own
 * right inset instead of overflowing off-screen. Vertical position
 * follows the trigger (selection rect top, or the corner button's rect
 * top) — it always opens level with what's being explained.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { SparklesIcon, XIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { usePopoverDismiss } from "@/components/popover-dismiss";

export interface ExplainRequest {
	/** Anchors the last-two-turns context window (src/core/explain-context.ts). */
	targetMessageId: string;
	/** The selected span verbatim — present and non-empty fires immediately
	 *  ("pointer" mode). Absent/empty opens the free-text ask form instead. */
	pointer?: string;
	/** Viewport y to open level with (the selection rect's top, or the
	 *  triggering button's rect top). */
	anchorY: number;
}

interface ExplainContextValue {
	open: (req: ExplainRequest) => void;
}

const ExplainContext = createContext<ExplainContextValue | null>(null);

/** Trigger components call this — throws outside ExplainProvider (a
 *  wiring bug, not a runtime condition to handle gracefully). */
export function useExplain(): ExplainContextValue {
	const ctx = useContext(ExplainContext);
	if (!ctx) throw new Error("useExplain called outside ExplainProvider");
	return ctx;
}

const MARGIN_GAP = 16;
const PANEL_W = 320;
/** Below this much room past the column's right edge, there's no real
 *  margin to speak of — fall back to hugging the column's inset instead
 *  of running the panel off the viewport. */
const MIN_MARGIN = 240;

type Status = "idle" | "loading" | "done" | "error";

export function ExplainProvider({
	chatId,
	columnRef,
	children,
}: {
	chatId: string;
	columnRef: RefObject<HTMLElement | null>;
	children: ReactNode;
}) {
	const [req, setReq] = useState<ExplainRequest | null>(null);
	const [question, setQuestion] = useState("");
	const [status, setStatus] = useState<Status>("idle");
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [x, setX] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const runId = useRef(0);

	const close = useCallback(() => {
		setReq(null);
		setStatus("idle");
		setText("");
		setError(null);
		setQuestion("");
	}, []);

	usePopoverDismiss(rootRef, req !== null, close);

	const run = useCallback(
		async (targetMessageId: string, pointer: string) => {
			const id = ++runId.current;
			setStatus("loading");
			setError(null);
			try {
				const res = await fetch(`/api/chats/${chatId}/explain-part`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ targetMessageId, pointer }),
				});
				const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
				if (id !== runId.current) return; // a newer request superseded this one
				if (!res.ok) {
					setStatus("error");
					setError(body?.error ?? "Explain failed");
					return;
				}
				setText(body?.text ?? "");
				setStatus("done");
			} catch {
				if (id !== runId.current) return;
				setStatus("error");
				setError("Explain failed — check your connection");
			}
		},
		[chatId],
	);

	const open = useCallback(
		(next: ExplainRequest) => {
			setReq(next);
			setStatus("idle");
			setText("");
			setError(null);
			setQuestion("");
			const pointer = next.pointer?.trim();
			if (pointer) run(next.targetMessageId, pointer);
		},
		[run],
	);

	useEffect(() => {
		if (!req) return;
		const col = columnRef.current;
		if (!col) {
			setX(null);
			return;
		}
		const rect = col.getBoundingClientRect();
		const room = window.innerWidth - rect.right;
		setX(room >= MIN_MARGIN ? rect.right + MARGIN_GAP : Math.max(rect.right - PANEL_W - MARGIN_GAP, MARGIN_GAP));
	}, [req, columnRef]);

	return (
		<ExplainContext.Provider value={{ open }}>
			{children}
			{req && x !== null && (
				<div
					ref={rootRef}
					data-testid="explain-panel"
					className="fixed z-40 flex max-h-[70vh] w-[320px] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
					style={{ left: x, top: Math.min(Math.max(req.anchorY, 16), window.innerHeight - 160) }}
				>
					<div className="flex items-center justify-between border-b border-border px-3 py-2">
						<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							<SparklesIcon className="size-3.5" /> Explain
						</span>
						<button
							type="button"
							aria-label="Close"
							data-testid="explain-panel-close"
							onClick={close}
							className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<XIcon className="size-3.5" />
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
						{!req.pointer?.trim() && status === "idle" && (
							<form
								data-testid="explain-ask-form"
								onSubmit={(e) => {
									e.preventDefault();
									if (question.trim()) run(req.targetMessageId, question.trim());
								}}
								className="flex flex-col gap-2"
							>
								<label className="text-xs text-muted-foreground" htmlFor="explain-ask-input">
									What part should I explain?
								</label>
								<textarea
									id="explain-ask-input"
									autoFocus
									rows={3}
									value={question}
									onChange={(e) => setQuestion(e.target.value)}
									className="w-full resize-none rounded border border-border bg-background p-2 text-sm outline-none focus:border-foreground/40"
									placeholder="e.g. why does the sign flip in that step?"
								/>
								<button
									type="submit"
									disabled={!question.trim()}
									className="self-end rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
								>
									Ask
								</button>
							</form>
						)}
						{status === "loading" && <div className="text-muted-foreground">Thinking…</div>}
						{status === "error" && <div className="text-destructive">{error}</div>}
						{status === "done" && (
							<MessageResponse className="lh-prose text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{text}</MessageResponse>
						)}
					</div>
				</div>
			)}
		</ExplainContext.Provider>
	);
}
