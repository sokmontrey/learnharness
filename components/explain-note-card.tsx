"use client";

/**
 * THE KEPT EXPLANATION (annotation wave, owner 2026-11): an "explain this"
 * result the learner chose to insert into the transcript — the fix for
 * "no way to get the explanation back when the popover closes." Renders
 * with a visible accent LEFT BORDER (the "indicator border" the owner
 * asked for) so it reads as an inserted annotation, not a regular message
 * — same visual family as the plan-block/graph-context cards, but with a
 * border instead of a dashed toggle, since this one wants to stay legible
 * at a glance rather than collapsed.
 */

import { SparklesIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import type { ExplainNoteDetails } from "@/src/core";

export function ExplainNoteCard({ data }: { data: ExplainNoteDetails }) {
	const { pointer, text } = data ?? { pointer: "", text: "" };
	return (
		<div
			data-testid="explain-note-card"
			className="my-2 rounded-r-md border-l-2 border-foreground/40 bg-muted/30 py-2 pl-3 pr-3"
		>
			<div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<SparklesIcon className="size-3" />
				Explained
			</div>
			{pointer && (
				<div className="mb-1.5 text-xs italic text-muted-foreground">&ldquo;{pointer}&rdquo;</div>
			)}
			<MessageResponse className="lh-prose text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{text}</MessageResponse>
		</div>
	);
}
