"use client";

/**
 * "Deviner le sens" — translation-free meaning inference from selection.
 * Staged: clues → guess → confirm (definition revealed client-side after guess).
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { LightbulbIcon, XIcon } from "lucide-react";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import {
	MEANING_CLUE_RELATION_LABEL_FR,
	isMeaningInferInsufficient,
	type MeaningClueRelation,
	type MeaningInferResult,
	type MeaningInferSuccess,
} from "@/src/core";

export interface MeaningInferRequest {
	targetMessageId: string;
	pointer: string;
	anchorY: number;
}

interface MeaningInferContextValue {
	open: (req: MeaningInferRequest) => void;
}

const MeaningInferContext = createContext<MeaningInferContextValue | null>(null);

export function useMeaningInfer(): MeaningInferContextValue {
	const ctx = useContext(MeaningInferContext);
	if (!ctx) throw new Error("useMeaningInfer called outside MeaningInferProvider");
	return ctx;
}

const MARGIN_GAP = 16;
const PANEL_W = 320;
const MIN_MARGIN = 240;

type Status = "idle" | "loading" | "ready" | "error";

const RELATION_BORDER: Record<MeaningClueRelation, string> = {
	"refers-to": "border-l-blue-500",
	"same-idea": "border-l-emerald-500",
	opposite: "border-l-orange-500",
	example: "border-l-violet-500",
	cause: "border-l-zinc-500",
};

export function MeaningInferProvider({
	chatId,
	columnRef,
	children,
}: {
	chatId: string;
	columnRef: RefObject<HTMLElement | null>;
	children: ReactNode;
}) {
	const [req, setReq] = useState<MeaningInferRequest | null>(null);
	const [status, setStatus] = useState<Status>("idle");
	const [result, setResult] = useState<MeaningInferResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [guess, setGuess] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [x, setX] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const runId = useRef(0);

	const close = useCallback(() => {
		setReq(null);
		setStatus("idle");
		setResult(null);
		setError(null);
		setGuess("");
		setConfirmed(false);
	}, []);

	usePopoverDismiss(rootRef, req !== null, close);

	const fetchInfer = useCallback(
		async (targetMessageId: string, pointer: string) => {
			const id = ++runId.current;
			setStatus("loading");
			setError(null);
			setResult(null);
			setGuess("");
			setConfirmed(false);
			try {
				const res = await fetch(`/api/chats/${chatId}/infer-meaning`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ targetMessageId, pointer }),
				});
				const body = (await res.json().catch(() => null)) as { result?: MeaningInferResult; error?: string } | null;
				if (id !== runId.current) return;
				if (!res.ok) {
					setStatus("error");
					setError(body?.error ?? "Échec — réessaie");
					return;
				}
				if (!body?.result) {
					setStatus("error");
					setError("Réponse invalide");
					return;
				}
				setResult(body.result);
				setStatus("ready");
			} catch {
				if (id !== runId.current) return;
				setStatus("error");
				setError("Connexion — vérifie le réseau");
			}
		},
		[chatId],
	);

	const open = useCallback(
		(next: MeaningInferRequest) => {
			if (!next.pointer.trim()) return;
			setReq(next);
			setStatus("loading");
			void fetchInfer(next.targetMessageId, next.pointer.trim());
		},
		[fetchInfer],
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

	const top = req ? Math.max(8, Math.min(Math.max(req.anchorY, 16), window.innerHeight - 160)) : 0;
	const maxH = Math.max(window.innerHeight - top - 16, 120);
	const width = req ? Math.min(PANEL_W, window.innerWidth - 32) : PANEL_W;
	const left = x === null ? 16 : Math.min(Math.max(x, 16), window.innerWidth - width - 16);

	const success = result && !isMeaningInferInsufficient(result) ? (result as MeaningInferSuccess) : null;

	return (
		<MeaningInferContext.Provider value={{ open }}>
			{children}
			{req && x !== null && (
				<div
					ref={rootRef}
					data-testid="meaning-infer-panel"
					className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
					style={{ left, top, maxHeight: maxH, width }}
				>
					<div className="flex items-center justify-between border-b border-border px-3 py-2">
						<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							<LightbulbIcon className="size-3.5" /> Deviner le sens
						</span>
						<button
							type="button"
							aria-label="Close"
							data-testid="meaning-infer-panel-close"
							onClick={close}
							className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<XIcon className="size-3.5" />
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
						<div className="mb-2 rounded border border-border bg-muted/40 px-2 py-1.5">
							<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Sélection</div>
							<div className="mt-0.5 max-h-20 overflow-y-auto text-xs italic text-muted-foreground">&ldquo;{req.pointer}&rdquo;</div>
						</div>

						{status === "loading" && <div className="text-muted-foreground">Je cherche des indices…</div>}
						{status === "error" && <div className="text-destructive">{error}</div>}

						{status === "ready" && result && isMeaningInferInsufficient(result) && (
							<p className="text-sm text-foreground">{result.messageFr}</p>
						)}

						{status === "ready" && success && (
							<div className="flex flex-col gap-3">
								{success.clues.length > 0 && (
									<div>
										<div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
											Indices dans le texte
										</div>
										<ul className="flex flex-col gap-2">
											{success.clues.map((clue, i) => (
												<li
													key={i}
													className={`border-l-4 pl-2 ${RELATION_BORDER[clue.relation]}`}
												>
													<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
														{MEANING_CLUE_RELATION_LABEL_FR[clue.relation]}
													</div>
													<blockquote className="mt-0.5 text-xs text-foreground">&ldquo;{clue.quote}&rdquo;</blockquote>
													<p className="mt-0.5 text-xs text-muted-foreground">{clue.nudge}</p>
												</li>
											))}
										</ul>
									</div>
								)}

								{!confirmed ? (
									<form
										data-testid="meaning-infer-guess-form"
										onSubmit={(e) => {
											e.preventDefault();
											if (!guess.trim()) return;
											setConfirmed(true);
										}}
										className="flex flex-col gap-2 border-t border-border pt-3"
									>
										<label className="text-xs text-foreground" htmlFor="meaning-infer-guess">
											{success.guessPrompt}
										</label>
										<textarea
											id="meaning-infer-guess"
											autoFocus
											rows={2}
											value={guess}
											onChange={(e) => setGuess(e.target.value)}
											className="w-full resize-none rounded border border-border bg-background p-2 text-sm outline-none focus:border-foreground/40"
											placeholder="Ta réponse en français…"
										/>
										<button
											type="submit"
											disabled={!guess.trim()}
											className="self-end rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
										>
											Vérifier
										</button>
									</form>
								) : (
									<div data-testid="meaning-infer-confirm" className="flex flex-col gap-2 border-t border-border pt-3">
										<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
											Ta réponse
										</div>
										<p className="text-sm">{guess.trim()}</p>
										<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
											Définition
										</div>
										<p className="text-sm text-foreground">{success.definition}</p>
										<div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
											Exemple
										</div>
										<p className="text-sm text-muted-foreground">{success.example}</p>
										{success.caveat?.trim() && (
											<p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-foreground">
												{success.caveat}
											</p>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</MeaningInferContext.Provider>
	);
}