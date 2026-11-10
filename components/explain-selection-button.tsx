"use client";

/**
 * Floating "Explain" button for transcript text selection (the TTS
 * selection-button precedent, same selectionchange-driven pattern). Shows
 * above the selection whenever it's non-empty, anchored inside `scopeRef`,
 * AND anchored inside a text block that carries `data-source-message-id`
 * (chat.tsx's text-part wrapper) — the attribute IS the target message id
 * the explainer's last-two-turns window anchors to; a selection outside
 * any such block (e.g. in the composer) shows nothing.
 */

import { useEffect, useState, type RefObject } from "react";
import { SparklesIcon } from "lucide-react";
import { useExplain } from "@/components/explain-panel";

interface SelectionAnchor {
	x: number;
	y: number;
	text: string;
	messageId: string;
}

export function ExplainSelectionButton({ scopeRef }: { scopeRef: RefObject<HTMLElement | null> }) {
	const { open } = useExplain();
	const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);

	useEffect(() => {
		const updateFromSelection = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) return setAnchor(null);
			const text = sel.toString().trim();
			if (!text) return setAnchor(null);
			const node = sel.anchorNode;
			const el = node instanceof Element ? node : node?.parentElement;
			const scope = scopeRef.current;
			if (!el || !scope || !scope.contains(el)) return setAnchor(null);
			const holder = el.closest("[data-source-message-id]") as HTMLElement | null;
			const messageId = holder?.dataset.sourceMessageId;
			if (!messageId) return setAnchor(null);
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			setAnchor({
				x: Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70),
				y: rect.top,
				text,
				messageId,
			});
		};
		const onScroll = () => setAnchor(null);
		document.addEventListener("selectionchange", updateFromSelection);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("selectionchange", updateFromSelection);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, [scopeRef]);

	if (!anchor) return null;

	return (
		<div
			className="fixed z-50"
			style={{ left: anchor.x, top: anchor.y, transform: "translate(-50%, -100%) translateY(-8px)" }}
		>
			<button
				type="button"
				data-testid="explain-selection-button"
				onMouseDown={(e) => e.preventDefault()}
				onClick={() => {
					const a = anchor;
					setAnchor(null);
					open({ targetMessageId: a.messageId, pointer: a.text, anchorY: a.y });
				}}
				className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs font-medium shadow-lg hover:bg-accent"
			>
				<SparklesIcon className="size-3" />
				Explain
			</button>
		</div>
	);
}
