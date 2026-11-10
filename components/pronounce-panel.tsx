"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MicIcon, PlayIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import {
	PRONOUNCE_MAX_SECONDS,
	alignWordsToAudio,
	countWords,
	pronounceTextError,
	scoreBand,
	soundFixes,
	wordVerdict,
	type AssessmentResult,
	type AssessmentWord,
	type CharAlignment,
} from "@/lib/pronounce";

/** The keys-section row the keyless panel deep-links (the dictation precedent). */
export const TONEPERFECT_KEY_ID = "TONEPERFECT_API_KEY";

type Phase = "idle" | "recording" | "scoring" | "done";

const VERDICT_CHIP: Record<string, string> = {
	review: "border-red-500/60 bg-red-500/10 text-foreground",
	uncertain: "border-amber-500/60 bg-amber-500/10 text-foreground",
	ok: "border-transparent text-muted-foreground",
};

const BAND_RING: Record<string, string> = {
	great: "stroke-emerald-500",
	good: "stroke-amber-500",
	work: "stroke-red-500",
};

/**
 * Floating pronunciation-practice card (TonePerfect engine, French-only).
 *
 * Anchored near the selection that spawned it: record an attempt at the
 * reference text, get a 0–100 + per-word verdicts + an expected→heard fix
 * list, replay the attempt, and hear the ElevenLabs model (slowed +
 * word-synced highlighting). Over-40-word selections render the refuse
 * hint instead of record controls; a missing key deep-links Settings.
 */
export function PronouncePanel({
	text,
	anchor,
	onClose,
}: {
	text: string;
	anchor: { x: number; y: number };
	onClose: () => void;
}) {
	const { open: openSettings } = useSettingsDialog();
	const [phase, setPhase] = useState<Phase>("idle");
	const [keyNeeded, setKeyNeeded] = useState<boolean | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [result, setResult] = useState<AssessmentResult | null>(null);
	const [attemptUrl, setAttemptUrl] = useState<string | null>(null);
	const [seconds, setSeconds] = useState(0);
	const [level, setLevel] = useState(0);
	const [slow, setSlow] = useState(false);
	const [modelLoading, setModelLoading] = useState(false);
	const [modelReady, setModelReady] = useState(false);
	const [activeWord, setActiveWord] = useState(-1);

	const streamRef = useRef<MediaStream | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const stoppingRef = useRef(false);
	const chunksRef = useRef<Blob[]>([]);
	const meterRaf = useRef<number>(0);
	const meterCtxRef = useRef<AudioContext | null>(null);
	const timersRef = useRef<number[]>([]);
	const modelAudioRef = useRef<HTMLAudioElement | null>(null);
	const modelWindowsRef = useRef<{ start: number; end: number }[]>([]);
	const attemptAudioRef = useRef<HTMLAudioElement | null>(null);

	const textError = useMemo(() => pronounceTextError(text), [text]);
	const words = useMemo(() => text.trim().split(/\s+/).filter(Boolean), [text]);
	const fixes = useMemo(() => (result ? soundFixes(result.words).slice(0, 6) : []), [result]);

	const teardown = useCallback(() => {
		for (const id of timersRef.current) {
			window.clearInterval(id);
			window.clearTimeout(id);
		}
		timersRef.current = [];
		cancelAnimationFrame(meterRaf.current);
		if (meterCtxRef.current) {
			void meterCtxRef.current.close().catch(() => undefined);
			meterCtxRef.current = null;
		}
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		recorderRef.current = null;
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			teardown();
			modelAudioRef.current?.pause();
			attemptAudioRef.current?.pause();
		};
	}, [onClose, teardown]);

	// Key pre-check — better than failing after a recording.
	useEffect(() => {
		let live = true;
		fetch("/api/keys")
			.then((r) => r.json())
			.then((body: { keys?: { id: string; present: boolean }[] }) => {
				if (!live) return;
				setKeyNeeded(
					!(body.keys ?? []).some((k) => k.id === TONEPERFECT_KEY_ID && k.present),
				);
			})
			.catch(() => {
				if (live) setKeyNeeded(null);
			});
		return () => {
			live = false;
		};
	}, []);

	const scoreAttempt = useCallback(
		(blob: Blob) => {
			setPhase("scoring");
			setNotice(null);
			const form = new FormData();
			form.append("audio", blob, "attempt.webm");
			form.append("text", text);
			fetch("/api/pronounce", { method: "POST", body: form })
				.then(async (res) => {
					const body = (await res.json().catch(() => null)) as {
						message?: unknown;
						assessable?: unknown;
						scores?: { overall?: unknown };
						words?: AssessmentWord[];
					} | null;
					if (res.status === 503) {
						setPhase("idle");
						setKeyNeeded(true);
						return;
					}
					if (!res.ok || !body) {
						setPhase("idle");
						setNotice(
							typeof body?.message === "string"
								? body.message
								: "Assessment failed — try again",
						);
						return;
					}
					setResult({
						assessable: body.assessable === true,
						overall:
							typeof body.scores?.overall === "number" ? body.scores.overall : null,
						words: Array.isArray(body.words) ? body.words : [],
					});
					setPhase("done");
				})
				.catch(() => {
					setPhase("idle");
					setNotice("Assessment failed — try again");
				});
		},
		[text],
	);

	const stopRecording = useCallback(
		(score: boolean) => {
			// Double-stop guard (manual Stop racing the 60s auto-stop): the
			// second call must not yank a scoring run back to idle.
			if (stoppingRef.current) return;
			stoppingRef.current = true;
			// Capture BEFORE teardown — teardown nulls the ref (mic tracks
			// die) and reading it after always yields null, which used to
			// discard the take and strand the panel back at idle.
			const recorder = recorderRef.current;
			recorderRef.current = null;
			teardown();
			setLevel(0);
			const release = () => {
				stoppingRef.current = false;
			};
			if (!recorder) {
				release();
				setPhase("idle");
				return;
			}
			recorder.onstop = () => {
				release();
				const blob = new Blob(chunksRef.current, { type: "audio/webm" });
				chunksRef.current = [];
				if (!score || blob.size === 0) {
					setPhase("idle");
					if (score) setNotice("Nothing recorded — try again");
					return;
				}
				const url = URL.createObjectURL(blob);
				setAttemptUrl((prev) => {
					if (prev) URL.revokeObjectURL(prev);
					return url;
				});
				scoreAttempt(blob);
			};
			if (recorder.state !== "inactive") {
				try {
					recorder.stop();
				} catch {
					release();
					setPhase("idle");
					setNotice("Recording stopped unexpectedly — try again");
				}
			} else {
				release();
				setPhase("idle");
			}
		},
		[scoreAttempt, teardown],
	);

	const startRecording = useCallback(async () => {
		setNotice(null);
		setResult(null);
		stoppingRef.current = false;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
			streamRef.current = stream;
			// Live meter — a light AnalyserNode loop (dictation's worklet
			// would be overkill for a level bar).
			const ctx = new AudioContext();
			meterCtxRef.current = ctx;
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser);
			const data = new Uint8Array(analyser.fftSize);
			const tick = () => {
				analyser.getByteTimeDomainData(data);
				let sum = 0;
				for (let i = 0; i < data.length; i++) {
					const v = ((data[i] ?? 128) - 128) / 128;
					sum += v * v;
				}
				setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
				meterRaf.current = requestAnimationFrame(tick);
			};
			tick();

			chunksRef.current = [];
			const recorder = new MediaRecorder(
				stream,
				MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined,
			);
			recorderRef.current = recorder;
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data);
			};
			const startedAt = Date.now();
			const clock = window.setInterval(() => {
				const elapsed = Math.floor((Date.now() - startedAt) / 1000);
				setSeconds(elapsed);
				if (elapsed >= PRONOUNCE_MAX_SECONDS) stopRecording(true);
			}, 250);
			timersRef.current.push(clock);
			setSeconds(0);
			recorder.start();
			setPhase("recording");
		} catch {
			setNotice("Microphone unavailable — allow mic access and try again");
		}
	}, [stopRecording]);

	const playAttempt = useCallback(() => {
		if (!attemptUrl) return;
		const audio = attemptAudioRef.current ?? new Audio(attemptUrl);
		attemptAudioRef.current = audio;
		if (!audio.paused) {
			audio.pause();
			return;
		}
		audio.currentTime = 0;
		void audio.play().catch(() => undefined);
	}, [attemptUrl]);

	const seekWord = useCallback(
		(word: AssessmentWord) => {
			if (!attemptUrl || typeof word.start_ms !== "number") return;
			const audio = attemptAudioRef.current ?? new Audio(attemptUrl);
			attemptAudioRef.current = audio;
			audio.currentTime = Math.max(0, word.start_ms / 1000);
			void audio.play().catch(() => undefined);
		},
		[attemptUrl],
	);

	const hearModel = useCallback(async () => {
		if (modelLoading) return;
		if (modelAudioRef.current) {
			const audio = modelAudioRef.current;
			audio.playbackRate = slow ? 0.7 : 1;
			if (audio.paused) void audio.play().catch(() => undefined);
			else audio.pause();
			return;
		}
		setModelLoading(true);
		try {
			const res = await fetch(
				`/api/tts/align?${new URLSearchParams({ text, language: "fr" })}`,
			);
			const body = (await res.json().catch(() => null)) as {
				audioBase64?: unknown;
				alignment?: CharAlignment | null;
				message?: unknown;
			} | null;
			if (!res.ok || !body || typeof body.audioBase64 !== "string") {
				setNotice(
					typeof body?.message === "string" ? body.message : "Model audio failed — try again",
				);
				return;
			}
			const bytes = Uint8Array.from(atob(body.audioBase64), (c) => c.charCodeAt(0));
			const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "audio/mpeg" }));
			const audio = new Audio(url);
			audio.playbackRate = slow ? 0.7 : 1;
			audio.onloadedmetadata = () => {
				modelWindowsRef.current = alignWordsToAudio(
					text,
					body.alignment ?? null,
					audio.duration || 0,
				);
				setModelReady(true);
			};
			audio.ontimeupdate = () => {
				const t = audio.currentTime;
				const idx = modelWindowsRef.current.findIndex((w) => t >= w.start && t < w.end);
				setActiveWord(idx);
			};
			audio.onended = () => setActiveWord(-1);
			modelAudioRef.current = audio;
			void audio.play().catch(() => setNotice("Model audio failed — try again"));
		} catch {
			setNotice("Model audio failed — try again");
		} finally {
			setModelLoading(false);
		}
	}, [modelLoading, slow, text]);

	useEffect(() => {
		if (modelAudioRef.current) modelAudioRef.current.playbackRate = slow ? 0.7 : 1;
	}, [slow]);

	const above = anchor.y > 480;
	const left = Math.min(Math.max(anchor.x, 190), window.innerWidth - 190);

	return (
		<div
			className="fixed z-50 w-[340px]"
			style={{
				left,
				top: anchor.y,
				transform: above ? "translate(-50%, -100%) translateY(-12px)" : "translate(-50%, 12px)",
			}}
			role="dialog"
			aria-label="Pronunciation practice"
			data-testid="pronounce-panel"
		>
			<div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl">
				<div className="flex items-center justify-between gap-2">
					<p className="font-ui text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Practice · FR
					</p>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						aria-label="Close practice"
						onClick={onClose}
						className="cursor-pointer"
					>
						<XIcon className="size-3" />
					</Button>
				</div>

				<blockquote className="rounded-md bg-accent/50 px-3 py-2 text-sm leading-relaxed">
					{text}
				</blockquote>
				<p className="font-mono text-[11px] text-muted-foreground">
					{countWords(text)}/{40} words
				</p>

				{textError ? (
					<p role="alert" className="text-xs leading-relaxed text-amber-500">
						{textError}
					</p>
				) : keyNeeded === null ? (
					<p className="text-xs text-muted-foreground">Checking key…</p>
				) : keyNeeded ? (
					<div className="flex flex-col gap-2">
						<p className="text-xs leading-relaxed text-muted-foreground">
							Pronunciation scoring needs a TonePerfect key.
						</p>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							onClick={() => openSettings("keys", TONEPERFECT_KEY_ID)}
							className="cursor-pointer"
						>
							Open Settings
						</Button>
					</div>
				) : phase === "idle" || phase === "recording" || phase === "scoring" ? (
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							{phase === "recording" ? (
								<Button
									type="button"
									size="sm"
									variant="destructive"
									onClick={() => stopRecording(true)}
									className="cursor-pointer"
								>
									<SquareIcon className="size-3" />
									Stop · {seconds}s
								</Button>
							) : (
								<Button
									type="button"
									size="sm"
									variant="default"
									disabled={phase === "scoring"}
									onClick={() => void startRecording()}
									className="cursor-pointer"
								>
									<MicIcon className="size-3" />
									{phase === "scoring" ? "Scoring…" : result ? "Record again" : "Record"}
								</Button>
							)}
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={modelLoading}
								onClick={() => void hearModel()}
								title="Hear the model — slowed + word highlighting"
								className="cursor-pointer"
							>
								<Volume2Icon className="size-3" />
								{modelLoading ? "Loading…" : "Model"}
							</Button>
							{(modelReady || modelAudioRef.current) && (
								<Button
									type="button"
									size="sm"
									variant={slow ? "default" : "ghost"}
									onClick={() => setSlow((v) => !v)}
									title="Slow the model to 0.7×"
									aria-pressed={slow}
									className="cursor-pointer font-mono text-xs"
								>
									0.7×
								</Button>
							)}
						</div>
						{phase === "recording" && (
							<div
								className="h-1.5 overflow-hidden rounded-full bg-accent"
								role="meter"
								aria-label="Microphone level"
							>
								<div
									className="h-full rounded-full bg-foreground transition-[width]"
									style={{ width: `${Math.round(level * 100)}%` }}
								/>
							</div>
						)}
						{(modelReady || activeWord >= 0) && (
							<p className="flex flex-wrap gap-1 text-sm leading-relaxed" aria-live="polite">
								{words.map((word, i) => (
									<span
										key={`${word}-${i}`}
										className={`rounded px-0.5 ${
											i === activeWord ? "bg-foreground text-background" : ""
										}`}
									>
										{word}
									</span>
								))}
							</p>
						)}
					</div>
				) : (
					result && (
						<div className="flex flex-col gap-3">
							{result.assessable ? (
								<>
									<div className="flex items-center gap-3">
										<ScoreRing overall={result.overall} />
										<div className="flex flex-col">
											<p className="font-ui text-sm font-medium">
												{result.overall === null ? "—" : Math.round(result.overall)}
												<span className="text-muted-foreground"> / 100</span>
											</p>
											<p className="text-xs text-muted-foreground">
												{fixes.length === 0
													? "Clean run — nothing to fix"
													: `${fixes.length} sound${fixes.length === 1 ? "" : "s"} to fix`}
											</p>
										</div>
									</div>
									<p className="flex flex-wrap gap-1" aria-label="Words — click to hear your attempt">
										{result.words.map((word, i) => (
											<button
												key={`${word.word}-${i}`}
												type="button"
												onClick={() => seekWord(word)}
												title={typeof word.score === "number" ? `${Math.round(word.score)} — click to hear` : "Click to hear"}
												className={`cursor-pointer rounded border px-1 py-0.5 text-sm ${VERDICT_CHIP[wordVerdict(word)] ?? VERDICT_CHIP.ok}`}
											>
												{word.word}
											</button>
										))}
									</p>
									{fixes.length > 0 && (
										<ul className="flex flex-col gap-1">
											{fixes.map((fix, i) => (
												<li
													key={`${fix.word}-${fix.dimension}-${i}`}
													className="flex items-baseline gap-1.5 font-mono text-xs"
												>
													<span className="shrink-0 font-sans text-muted-foreground">
														{fix.word}
													</span>
													<span className="text-red-500">{fix.expected}</span>
													<span aria-hidden>→</span>
													<span className="text-amber-500">{fix.heard}</span>
													<span className="ml-auto text-muted-foreground">{fix.dimension}</span>
												</li>
											))}
										</ul>
									)}
								</>
							) : (
								<p className="text-xs leading-relaxed text-amber-500">
									Couldn&apos;t assess that take — record closer to the mic, clearly, and try again.
								</p>
							)}
							<div className="flex items-center gap-2">
								{attemptUrl && (
									<Button
										type="button"
										size="sm"
										variant="secondary"
										onClick={playAttempt}
										className="cursor-pointer"
									>
										<PlayIcon className="size-3" />
										My attempt
									</Button>
								)}
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => {
										setResult(null);
										setPhase("idle");
									}}
									className="cursor-pointer"
								>
									Retry
								</Button>
							</div>
						</div>
					)
				)}

				{notice && (
					<p role="alert" className="text-xs leading-relaxed text-red-500">
						{notice}
					</p>
				)}
			</div>
		</div>
	);
}

function ScoreRing({ overall }: { overall: number | null }) {
	const band = scoreBand(overall);
	const pct = Math.max(0, Math.min(100, overall ?? 0)) / 100;
	const r = 26;
	const c = 2 * Math.PI * r;
	return (
		<svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Score ${overall === null ? "—" : Math.round(overall)} of 100`}>
			<circle cx="32" cy="32" r={r} fill="none" className="stroke-accent" strokeWidth="6" />
			<circle
				cx="32"
				cy="32"
				r={r}
				fill="none"
				strokeWidth="6"
				strokeLinecap="round"
				strokeDasharray={`${c * pct} ${c}`}
				transform="rotate(-90 32 32)"
				className={BAND_RING[band] ?? BAND_RING.work}
			/>
			<text x="32" y="37" textAnchor="middle" className="fill-foreground font-ui text-sm font-medium">
				{overall === null ? "—" : Math.round(overall)}
			</text>
		</svg>
	);
}
