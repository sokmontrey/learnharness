"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { dictationPlainText, hasDictationMarkup, parseDictationMarkup } from "@/lib/dictation-markup";

/** Yellow repaired word. Hover shows what was spoken (`title`). */
export function DictationText({ text }: { text: string }) {
	const parsed = parseDictationMarkup(text);
	if (!parsed.ok || !parsed.parts.some((part) => part.kind === "correction")) return <>{text}</>;
	return (
		<>
			{parsed.parts.map((part, i) =>
				part.kind === "text" ? (
					<span key={i} className="pointer-events-none">
						{part.text}
					</span>
				) : (
					<span
						key={i}
						data-dictation-correction=""
						data-original={part.original}
						title={part.original}
						className="pointer-events-auto rounded-sm bg-yellow-200/90 dark:bg-yellow-400/30"
					>
						{part.corrected}
					</span>
				),
			)}
		</>
	);
}

/**
 * A textarea that stays the real control (typing, Enter, caret, dictation
 * append). When the value carries repair spans, the textarea shows the
 * repaired words in transparent ink and a mirror paints the yellow words
 * on top. Editing replaces the value with the typed plain text — the
 * spans drop, the field does not try to retarget them.
 */
export function DictationTextarea({
	value,
	onChange,
	onScroll,
	className,
	ref,
	...rest
}: React.ComponentProps<"textarea"> & { value: string }) {
	const mirrorRef = useRef<HTMLDivElement>(null);
	const marked = hasDictationMarkup(value);
	const shown = marked ? dictationPlainText(value) : value;
	const grow = className?.includes("flex-1");
	return (
		<div className={cn("relative min-w-0", grow ? "flex-1" : "w-full")}>
			<textarea
				{...rest}
				ref={ref}
				value={shown}
				onChange={onChange}
				onScroll={(e) => {
					if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
					onScroll?.(e);
				}}
				className={cn(className, "w-full", marked && "text-transparent caret-foreground selection:bg-foreground/25")}
			/>
			{marked && (
				<div
					ref={mirrorRef}
					aria-hidden
					className={cn("pointer-events-none absolute inset-0 overflow-auto", className, "w-full")}
				>
					<DictationText text={value} />
				</div>
			)}
		</div>
	);
}
