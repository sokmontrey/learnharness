"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { highlightTypedSegments, normalizeListeningText } from "@/src/core";

const HIGHLIGHT: Record<string, string> = {
	exact: "text-emerald-600 dark:text-emerald-400",
	accent: "text-amber-600 dark:text-amber-400 underline decoration-amber-500/80 decoration-2 underline-offset-2",
	partial: "text-amber-600 dark:text-amber-400",
	wrong: "text-red-600 dark:text-red-400",
	extra: "text-red-600 dark:text-red-400",
	neutral: "text-foreground",
};

/**
 * Typing field — the learner's text is shown once, token-colored underneath
 * a transparent textarea (caret only). No ghost of untyped target words.
 */
export function ListeningTypedField({
	value,
	onChange,
	targetText,
	disabled,
	placeholder = "Type what you hear…",
}: {
	value: string;
	onChange: (v: string) => void;
	targetText: string;
	disabled?: boolean;
	placeholder?: string;
}) {
	const segments = useMemo(() => highlightTypedSegments(targetText, value), [targetText, value]);

	const coloredLayer = useMemo(() => {
		if (!value) return null;
		return (
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm leading-relaxed"
			>
				{segments.map((seg, i) => (
					<span key={i} className={cn(HIGHLIGHT[seg.status])}>
						{seg.text}
					</span>
				))}
			</div>
		);
	}, [segments, value]);

	return (
		<div className="relative min-h-[6rem] rounded-lg border bg-background">
			{coloredLayer}
			<textarea
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				data-testid="listening-type-field"
				onChange={(e) => onChange(e.target.value)}
				className={cn(
					"relative z-10 min-h-[6rem] w-full resize-y bg-transparent px-3 py-2 font-mono text-sm leading-relaxed caret-foreground selection:bg-primary/20",
					value ? "text-transparent" : "text-foreground",
				)}
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
			/>
			{value.length > 0 && (
				<div className="border-t border-border/60 px-3 py-1 text-[11px] text-muted-foreground">
					{normalizeListeningText(value).length} characters
				</div>
			)}
		</div>
	);
}