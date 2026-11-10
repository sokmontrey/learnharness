"use client";

/**
 * FOOTNOTE PINS (annotation wave, owner 2026-11): standard GFM footnote
 * syntax (`term[^1]` … `[^1]: elaboration`) — already parsed by remark-gfm,
 * already in the model's vocabulary — re-skinned as an inline numbered pin
 * instead of a bottom-of-message reference list. Point: keep the main
 * prose SHORT, and let optional elaboration on one term/symbol sit one
 * click away instead of forcing it into the sentence or a wall below.
 *
 * The transform happens at the MDAST level (remarkFootnotePins, appended
 * in the same remarkPluginsAfter slot message.tsx already uses for
 * remark-breaks): it lifts each footnoteDefinition's content out, re-
 * serializes it to markdown source (mdast-util-to-markdown — the
 * definition's own markdown/LaTeX survives verbatim), and stamps the
 * matching footnoteReference with `data.hName/hProperties` so it reaches
 * React as a plain `<footnote-pin data-note="...">` element instead of
 * remark-gfm's default `<sup><a data-footnote-ref>`. The default
 * `<section data-footnotes>` reference list is dropped — its content now
 * lives on the pins themselves, nothing is rendered twice.
 */

import { useId, useState, type ComponentProps } from "react";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfmFootnoteToMarkdown } from "mdast-util-gfm-footnote";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { Streamdown } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { cn } from "@/lib/utils";

// A pin's own content is never table/mermaid-bearing in practice (the
// doctrine below reserves pins for one term/symbol's elaboration) — a bare
// math-enabled Streamdown, deliberately NOT importing message.tsx's
// mdComponents (that would cycle: md-blocks → footnote-pin → message →
// md-blocks). If a pin ever needs the full block vocabulary, lift
// mdComponents out of message.tsx first instead of wiring the cycle.
const notePlugins = { math: createMathPlugin({ singleDollarTextMath: true }) } as never;

/** Serializes one footnote definition's children back to markdown source,
 *  numbered so pin labels stay stable even if a message re-renders mid-
 *  stream with definitions still arriving out of order. */
function definitionSource(children: Root["children"]): string {
	return toMarkdown({ type: "root", children } as Root, {
		extensions: [gfmFootnoteToMarkdown()],
	}).trim();
}

/** The remark plugin: GFM footnote refs/definitions → inline pins.
 *  Runs after remark-gfm has already produced footnoteReference /
 *  footnoteDefinition mdast nodes — pure tree rewrite, no new parsing. */
export function remarkFootnotePins() {
	return (tree: Root) => {
		const definitions = new Map<string, string>();
		visit(tree, "footnoteDefinition", (node: any, index, parent) => {
			definitions.set(node.identifier, definitionSource(node.children));
			if (parent && typeof index === "number") parent.children.splice(index, 1);
			return index; // revisit this index — the next sibling slid into it
		});
		let n = 0;
		visit(tree, "footnoteReference", (node: any) => {
			const note = definitions.get(node.identifier);
			if (note === undefined) return; // an unresolved ref — leave remark-gfm's default handling
			n += 1;
			node.data = {
				...node.data,
				hName: "footnote-pin",
				hProperties: { "data-num": n, "data-note": note },
			};
		});
	};
}

/** The pin: a small numbered button inline with the prose, opening a
 *  click-triggered popover with the elaboration rendered through the same
 *  MessageResponse path as the message itself (markdown + LaTeX intact).
 *  Click, not hover (desktop app — trackpad/touch hover is unreliable, and
 *  the content is substantial enough to want a held-open read, not a
 *  passing chip). */
export function FootnotePin(props: ComponentProps<"span"> & { "data-num"?: number; "data-note"?: string }) {
	const { ["data-num"]: num, ["data-note"]: note } = props;
	const [open, setOpen] = useState(false);
	const labelId = useId();
	if (note === undefined) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`Note ${num}`}
					aria-describedby={labelId}
					data-testid="md-footnote-pin"
					className={cn(
						"mx-0.5 inline-flex size-4 -translate-y-0.75 items-center justify-center rounded-full border border-muted-foreground/40 align-super text-[10px] leading-none text-muted-foreground",
						"hover:border-foreground/60 hover:text-foreground",
						open && "border-foreground/60 text-foreground"
					)}
					onClick={blurAfterPointerClick}
				>
					{num}
				</button>
			</PopoverTrigger>
			<PopoverContent id={labelId}>
				<Streamdown className="lh-prose text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" plugins={notePlugins}>
					{note}
				</Streamdown>
			</PopoverContent>
		</Popover>
	);
}
