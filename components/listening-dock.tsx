"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LightbulbIcon, PlayIcon, SquareIcon, SkipForwardIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { ListeningTypedField } from "@/components/listening-typed-field";
import { createTtsProvider, TTS_NORMAL_RATE } from "@/lib/tts";

/** Study pace for the listening dock — slower than transcript read-aloud (0.85). */
const LISTENING_SLOW_RATE = 0.62;
import {
	buildListeningAnswer,
	dismissedAnswer,
	parseListeningInput,
	scoreListening,
	tokenizeListening,
	type QuestionAnswerData,
} from "@/src/core";

const tts = createTtsProvider();

export function ListeningDock({
	toolCallId: _toolCallId,
	input,
	expanded,
	onExpand,
	onSubmit,
	onEscape,
	compactionRunning,
	mode = "agent",
	onManualDone,
	sourceMessageId,
}: {
	toolCallId?: string;
	input: unknown;
	expanded: boolean;
	onExpand: () => void;
	onSubmit?: (answer: QuestionAnswerData) => void;
	onEscape?: () => void;
	compactionRunning: boolean;
	/** Agent dock posts an answer; manual practice closes locally only. */
	mode?: "agent" | "manual";
	onManualDone?: () => void;
	/** Assistant message hosting this tool call (agent mode). */
	sourceMessageId?: string;
}) {
	const parsed = useMemo(() => parseListeningInput(input), [input]);
	const targetText = parsed?.targetText ?? "";
	const contextText = parsed?.contextText;
	const slowDefault = parsed?.slowDefault === true;

	const [typed, setTyped] = useState("");
	const [speaking, setSpeaking] = useState(false);
	const [slow, setSlow] = useState(slowDefault);
	const [keyNeeded, setKeyNeeded] = useState(false);
	const [hintWordsRevealed, setHintWordsRevealed] = useState(0);
	const lastPlayRef = useRef(0);

	const targetWords = useMemo(() => tokenizeListening(targetText), [targetText]);
	const hintsExhausted = hintWordsRevealed >= targetWords.length;

	useEffect(() => {
		setHintWordsRevealed(0);
	}, [targetText]);

	const score = useMemo(() => scoreListening(targetText, typed), [targetText, typed]);

	const revealNextHint = useCallback(() => {
		if (hintsExhausted) return;
		setHintWordsRevealed((n) => Math.min(n + 1, targetWords.length));
	}, [hintsExhausted, targetWords.length]);

	const play = useCallback(
		(useSlow: boolean) => {
			if (!targetText.trim()) return;
			setSlow(useSlow);
			setSpeaking(true);
			lastPlayRef.current = Date.now();
			tts.speak(targetText, {
				lang: "fr",
				rate: useSlow ? LISTENING_SLOW_RATE : TTS_NORMAL_RATE,
				onEnd: () => setSpeaking(false),
				onError: (kind) => {
					setSpeaking(false);
					if (kind === "key-needed") setKeyNeeded(true);
				},
			});
		},
		[targetText],
	);

	const stop = useCallback(() => {
		tts.cancel();
		setSpeaking(false);
	}, []);

	const finishManual = useCallback(() => {
		onManualDone?.();
	}, [onManualDone]);

	const submit = useCallback(() => {
		if (compactionRunning || !targetText) return;
		if (mode === "manual") {
			finishManual();
			return;
		}
		onSubmit?.(buildListeningAnswer(targetText, contextText, typed));
	}, [compactionRunning, contextText, finishManual, mode, onSubmit, targetText, typed]);

	const skip = useCallback(() => {
		if (compactionRunning) return;
		if (mode === "manual") {
			finishManual();
			return;
		}
		const label = contextText?.trim() || "Listening practice";
		onSubmit?.(dismissedAnswer("listening", label));
	}, [compactionRunning, contextText, finishManual, mode, onSubmit]);

	if (!parsed) {
		return (
			<div className="p-4 text-sm text-muted-foreground" data-testid="listening-dock-invalid">
				The listening clip could not be loaded.
			</div>
		);
	}

	if (!expanded) {
		return (
			<button
				type="button"
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
				data-testid="listening-dock-collapsed"
				onClick={onExpand}
			>
				<Volume2Icon className="size-4 shrink-0 text-muted-foreground" />
				<span className="font-medium">Listening</span>
				<span className="truncate text-muted-foreground">{contextText ?? "Type what you hear"}</span>
			</button>
		);
	}

	return (
		<div className="flex flex-col gap-0" data-testid="listening-dock">
			<div
				className="lh-source-passage border-b border-border/60 px-4 py-3"
				data-source-message-id={sourceMessageId || undefined}
			>
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{mode === "manual" ? "Listening (your pick)" : "Listening"}
				</div>
				{contextText ? (
					<div className="text-sm">
						<MessageResponse>{contextText}</MessageResponse>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">Listen to the French sentence, then type it below.</p>
				)}
				{keyNeeded && (
					<p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
						Add an ElevenLabs API key in Settings → Read-aloud to hear the clip.
					</p>
				)}
			</div>

			<div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
				{speaking ? (
					<>
						<Button type="button" variant="secondary" size="sm" onClick={stop} data-testid="listening-stop">
							<SquareIcon className="size-3.5" />
							Stop
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={compactionRunning || hintsExhausted || targetWords.length === 0}
							onClick={revealNextHint}
							data-testid="listening-hint"
						>
							<LightbulbIcon className="size-3.5" />
							Hint
						</Button>
					</>
				) : (
					<>
						<Button type="button" variant="secondary" size="sm" onClick={() => play(false)} data-testid="listening-play">
							<PlayIcon className="size-3.5" />
							Play
						</Button>
						<Button type="button" variant="ghost" size="sm" onClick={() => play(true)} data-testid="listening-play-slow">
							<Volume2Icon className="size-3.5" />
							Slow
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={compactionRunning || hintsExhausted || targetWords.length === 0}
							onClick={revealNextHint}
							data-testid="listening-hint"
						>
							<LightbulbIcon className="size-3.5" />
							Hint
						</Button>
					</>
				)}
				<span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
					{Math.round(score.tokenScore * 100)}% tokens
				</span>
			</div>

			{hintWordsRevealed > 0 && (
				<div
					className="border-b border-border/60 px-4 py-2.5 font-mono text-sm leading-relaxed"
					data-testid="listening-hints"
					aria-live="polite"
				>
					<span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Hints</span>
					<span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
						{targetWords.map((word, i) =>
							i < hintWordsRevealed ? (
								<span key={i} className="text-foreground">
									{word}
								</span>
							) : (
								<span key={i} className="select-none text-muted-foreground/50" aria-hidden>
									█
								</span>
							),
						)}
					</span>
				</div>
			)}

			<div className="px-4 py-3">
				<label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Your transcript
				</label>
				<ListeningTypedField value={typed} onChange={setTyped} targetText={targetText} disabled={compactionRunning} />
			</div>

			<div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
				<Button type="button" variant="ghost" size="sm" disabled={compactionRunning} onClick={skip} data-testid="listening-skip">
					<SkipForwardIcon className="size-3.5" />
					Skip
				</Button>
				<Button type="button" size="sm" disabled={compactionRunning || typed.trim().length === 0} onClick={submit} data-testid="listening-submit">
					Submit
				</Button>
			</div>
		</div>
	);
}