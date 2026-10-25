/**
 * Text-to-speech provider seam (transcript read-aloud).
 *
 * The transcript's floating selection button talks ONLY to the
 * {@link TtsProvider} interface via {@link createTtsProvider} — swapping
 * engines later means adding a class here and switching the factory
 * return, with no changes in components/.
 *
 * Current engine: ElevenLabs Flash v2.5 (cheapest tier, $0.04/1K chars,
 * ~75ms) through our own POST /api/tts proxy — the key stays server-side
 * (same doctrine as the STT token route) and repeat reads hit a
 * server-side disk cache keyed by model+voice+language+text, so re-reads cost $0.
 * `language_code` follows the clicked button (FR/EN) — same voice, per-click
 * pronunciation.
 *
 * Pure module, no node/browser imports at top level: safe to import from
 * client components AND the route handler AND node tests alike.
 */

/** Cheapest ElevenLabs tier (owner choice, 2026-10-25). */
export const TTS_MODEL = "eleven_flash_v2_5";
/** Charlotte — female, conversational (ElevenLabs' official examples). One-line swap. */
export const TTS_VOICE_ID = "XB0fDUnXU5powFXDhCwa";
/** Read-aloud languages (owner choice): one floating button each. The same
 *  voice reads both — Charlotte is multilingual, `language_code` steers
 *  pronunciation per click. ISO 639-1 doubles as Web Speech's lang hint. */
export const TTS_LANGUAGES = ["fr", "en"] as const;
export type TtsLanguage = (typeof TTS_LANGUAGES)[number];

/** Pure language gate shared by the route (enforces) and the button (passes through). */
export function parseTtsLanguage(value: unknown): TtsLanguage | null {
	return value === "fr" || value === "en" ? value : null;
}
/** Cost guardrail: ~$0.0002/click max at Flash pricing. Enforced server-side; pre-checked client-side. */
export const TTS_MAX_CHARS = 5000;
/** First click: natural pace. */
export const TTS_NORMAL_RATE = 1;
/** Second click while speaking: study pace (one-line tune). */
export const TTS_SLOW_RATE = 0.85;
/** Web Speech fallback language (unused while ElevenLabs is the engine). */
export const TTS_LANG = "fr-FR";

/** Pure selection validation shared by the route (enforces) and the button (pre-checks). */
export function ttsTextError(text: unknown): string | null {
	if (typeof text !== "string" || !text.trim()) return "text must be a non-empty string";
	if (text.length > TTS_MAX_CHARS)
		return `selection is ${text.length} characters — the read-aloud cap is ${TTS_MAX_CHARS} (cost guardrail)`;
	return null;
}

export interface TtsSpeakOptions {
	lang: string;
	rate: number;
	/** Fires when the utterance ends or errors — lets the button reset its icon. */
	onEnd?: () => void;
	/** Server-side failures the button surfaces (key-needed deep-links to Settings). */
	onError?: (kind: "key-needed" | "too-long" | "failed", detail?: string) => void;
}

export interface TtsProvider {
	speak(text: string, opts: TtsSpeakOptions): void;
	cancel(): void;
	isSpeaking(): boolean;
}

/**
 * ElevenLabs engine: POSTs the text to /api/tts (key + cache live
 * server-side) and plays the returned MP3. The slower re-read is
 * `playbackRate` — ElevenLabs has no speed parameter.
 */
export class ElevenLabsTtsProvider implements TtsProvider {
	private audio: HTMLAudioElement | null = null;
	private objectUrl: string | null = null;

	speak(text: string, opts: TtsSpeakOptions): void {
		if (typeof window === "undefined") return;
		this.cancel();
		const rate = opts.rate;
		const generation = (this.generation = (this.generation ?? 0) + 1);
		void fetch("/api/tts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text, language: opts.lang }),
		}).then(
			(res) => {
				if (generation !== this.generation) return; // superseded — a newer click owns playback
				if (!res.ok) {
					// The route's JSON body carries the upstream reason —
					// surface it instead of failing silently.
					void res
						.json()
						.catch(() => null)
						.then((body) => {
							const message = (body as { message?: unknown } | null)?.message;
							const detail = typeof message === "string" ? message : undefined;
							if (res.status === 503) opts.onError?.("key-needed", detail);
							else if (res.status === 413) opts.onError?.("too-long", detail);
							else opts.onError?.("failed", detail);
							opts.onEnd?.();
						});
					return;
				}
				void res
					.blob()
					.then((blob) => {
						if (generation !== this.generation) return;
						const url = URL.createObjectURL(blob);
						this.objectUrl = url;
						const audio = new Audio(url);
						this.audio = audio;
						audio.playbackRate = rate;
						audio.onended = () => {
							this.dropAudio();
							opts.onEnd?.();
						};
						audio.onerror = () => {
							this.dropAudio();
							opts.onError?.("failed");
							opts.onEnd?.();
						};
						void audio.play().catch(() => {
							this.dropAudio();
							opts.onError?.("failed");
							opts.onEnd?.();
						});
					})
					.catch(() => {
						opts.onError?.("failed");
						opts.onEnd?.();
					});
			},
			() => {
				if (generation !== this.generation) return;
				opts.onError?.("failed");
				opts.onEnd?.();
			},
		);
	}

	cancel(): void {
		this.generation = (this.generation ?? 0) + 1;
		this.dropAudio();
	}

	isSpeaking(): boolean {
		const audio = this.audio;
		return !!audio && !audio.paused && !audio.ended;
	}

	private generation: number | undefined;

	private dropAudio(): void {
		if (this.audio) {
			this.audio.onended = null;
			this.audio.onerror = null;
			this.audio.pause();
			this.audio = null;
		}
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}
}

/** Web Speech API implementation — the free local alternate (kept for the seam, not the factory). */
export class WebSpeechTtsProvider implements TtsProvider {
	private pending: ReturnType<typeof setTimeout> | undefined;

	speak(text: string, opts: TtsSpeakOptions): void {
		if (typeof window === "undefined" || !window.speechSynthesis) return;
		const synth = window.speechSynthesis;
		if (this.pending !== undefined) clearTimeout(this.pending);
		synth.cancel();
		// Chromium quirk: a speak() issued synchronously after cancel() is
		// silently dropped — yield one task so the cancel lands first.
		// Without this, first clicks (and slow re-reads) read nothing.
		this.pending = setTimeout(() => {
			this.pending = undefined;
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.lang = opts.lang;
			utterance.rate = opts.rate;
			// Prefer a native French voice when the browser ships one; otherwise
			// the lang hint still drives pronunciation on the default voice.
			const voice = synth
				.getVoices()
				.find((v) => v.lang === opts.lang || v.lang.startsWith("fr"));
			if (voice) utterance.voice = voice;
			if (opts.onEnd) {
				utterance.onend = opts.onEnd;
				utterance.onerror = opts.onEnd;
			}
			synth.speak(utterance);
		}, 60);
	}

	cancel(): void {
		if (this.pending !== undefined) clearTimeout(this.pending);
		this.pending = undefined;
		if (typeof window === "undefined" || !window.speechSynthesis) return;
		window.speechSynthesis.cancel();
	}

	isSpeaking(): boolean {
		if (typeof window === "undefined" || !window.speechSynthesis) return false;
		return window.speechSynthesis.speaking;
	}
}

/**
 * DI factory — the single swap point. ElevenLabs today; return a
 * different {@link TtsProvider} tomorrow.
 */
export function createTtsProvider(): TtsProvider {
	return new ElevenLabsTtsProvider();
}
