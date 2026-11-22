"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { diffListeningTokens, normalizeListeningText } from "@/src/core";

/**
 * Typing field with a mirror overlay — each token is colored correct/wrong/pending.
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
	const diffs = useMemo(() => diffListeningTokens(targetText, value), [targetText, value]);
	const mirror = useMemo(() => {
		if (!value) return null;
		return (
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm leading-relaxed"
			>
				{diffs.map((d, i) => (
					<span
						key={i}
						className={cn(
							d.status === "correct" && "text-emerald-600 dark:text-emerald-400",
							d.status === "wrong" && "text-red-600 dark:text-red-400",
							d.status === "pending" && "text-muted-foreground/40",
							d.status === "extra" && "text-amber-600 dark:text-amber-400",
						)}
					>
						{d.token}
						{i < diffs.length - 1 ? " " : ""}
					</span>
				))}
			</div>
		);
	}, [diffs, value]);

	return (
		<div className="relative min-h-[6rem] rounded-lg border bg-background">
			{mirror}
			<textarea
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				data-testid="listening-type-field"
				onChange={(e) => onChange(e.target.value)}
				className={cn(
					"relative z-10 min-h-[6rem] w-full resize-y bg-transparent px-3 py-2 font-mono text-sm leading-relaxed caret-foreground",
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