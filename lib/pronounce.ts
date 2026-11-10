/**
 * Pronunciation-practice pure helpers (transcript "Practice" flow).
 *
 * TonePerfect assesses a recording against reference text and returns
 * 0–100 display scores plus an explicit per-unit `decision`. Their docs
 * are explicit: use the DECISION for feedback, never turn every low
 * display grade into a correction — the mapping below follows that.
 *
 * Pure module, no node/browser imports: safe for client, routes, tests.
 */

/** TonePerfect caps non-Mandarin texts at 40 words — refuse over, with a hint. */
export const PRONOUNCE_MAX_WORDS = 40;
/** French-only practice (owner choice). */
export const PRONOUNCE_LANGUAGE = "fr-FR";
/** TonePerfect's audio ceiling — refuse over, before uploading. */
export const PRONOUNCE_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/** Recording auto-stop — 40 French words never need longer. */
export const PRONOUNCE_MAX_SECONDS = 60;

export function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Pure reference-text gate shared by the panel (pre-checks) and the route (enforces). */
export function pronounceTextError(text: unknown): string | null {
	if (typeof text !== "string" || !text.trim()) return "text must be a non-empty string";
	const words = countWords(text);
	if (words > PRONOUNCE_MAX_WORDS)
		return `that selection is ${words} words — pronunciation practice takes ${PRONOUNCE_MAX_WORDS} or fewer. Select a shorter passage.`;
	return null;
}

/** One assessed word (the TonePerfect subset we render). */
export interface AssessmentWord {
	word: string;
	score: number | null;
	start_ms: number | null;
	end_ms: number | null;
	phones: PhoneFeedback[];
}

export interface PhoneFeedback {
	dimension: string;
	expected: string;
	heard: string;
	score: number | null;
	decision: string;
}

/** Full assessment result (the TonePerfect subset we render). */
export interface AssessmentResult {
	assessable: boolean;
	overall: number | null;
	words: AssessmentWord[];
}

export type WordVerdict = "review" | "uncertain" | "ok";

/**
 * The word's verdict from its phones' decisions (TonePerfect doctrine:
 * decisions, not display grades). review wins over uncertain; a word with
 * no measurable phones reads uncertain rather than ok.
 */
export function wordVerdict(word: AssessmentWord): WordVerdict {
	let sawUncertain = word.score === null || word.score === undefined;
	for (const phone of word.phones) {
		if (phone.decision === "review") return "review";
		if (phone.decision === "uncertain" || phone.decision === "unassessable" || phone.decision === "partial")
			sawUncertain = true;
	}
	if (word.phones.length === 0) sawUncertain = true;
	return sawUncertain ? "uncertain" : "ok";
}

export interface SoundFix {
	word: string;
	dimension: string;
	expected: string;
	heard: string;
	score: number | null;
}

/** Every strongly-evidenced error, worst first — the "fix these" list. */
export function soundFixes(words: AssessmentWord[]): SoundFix[] {
	const fixes: SoundFix[] = [];
	for (const word of words) {
		for (const phone of word.phones) {
			if (phone.decision !== "review") continue;
			fixes.push({
				word: word.word,
				dimension: phone.dimension,
				expected: phone.expected,
				heard: phone.heard,
				score: phone.score,
			});
		}
	}
	return fixes.sort((a, b) => (a.score ?? 100) - (b.score ?? 100));
}

export type ScoreBand = "great" | "good" | "work";

export function scoreBand(overall: number | null): ScoreBand {
	if (overall === null || overall === undefined) return "work";
	if (overall >= 85) return "great";
	if (overall >= 70) return "good";
	return "work";
}

/** A word's char span in the reference text (for alignment mapping). */
export interface WordSpan {
	word: string;
	start: number;
	end: number;
}

export function wordSpans(text: string): WordSpan[] {
	const spans: WordSpan[] = [];
	const re = /\S+/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		spans.push({ word: match[0], start: match.index, end: match.index + match[0].length });
	}
	return spans;
}

export interface CharAlignment {
	characters: string[];
	character_start_times_seconds: number[];
	character_end_times_seconds: number[];
}

/**
 * Map each reference word to its spoken window from ElevenLabs'
 * character alignment. Falls back to proportional slices of the audio
 * duration when alignment is absent or mismatched (short selections —
 * close enough for highlighting).
 */
export function alignWordsToAudio(
	text: string,
	alignment: CharAlignment | null,
	durationSeconds: number,
): { start: number; end: number }[] {
	const spans = wordSpans(text);
	if (
		!alignment ||
		alignment.characters.length !== text.length ||
		durationSeconds <= 0
	) {
		return spans.map((span) => ({
			start: (span.start / Math.max(text.length, 1)) * durationSeconds,
			end: (span.end / Math.max(text.length, 1)) * durationSeconds,
		}));
	}
	return spans.map((span) => {
		let start = Number.POSITIVE_INFINITY;
		let end = Number.NEGATIVE_INFINITY;
		for (let i = span.start; i < span.end; i++) {
			const s = alignment.character_start_times_seconds[i];
			const e = alignment.character_end_times_seconds[i];
			if (typeof s === "number") start = Math.min(start, s);
			if (typeof e === "number") end = Math.max(end, e);
		}
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
			return {
				start: (span.start / Math.max(text.length, 1)) * durationSeconds,
				end: (span.end / Math.max(text.length, 1)) * durationSeconds,
			};
		}
		return { start, end };
	});
}
