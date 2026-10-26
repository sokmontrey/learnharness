/**
 * Pronunciation-practice pure tests — the gates and mappings the panel
 * and the /api/pronounce route share: the 40-word refuse rule, the
 * decision-first verdicts (TonePerfect doctrine), the fix list order,
 * and the alignment→word mapping with its proportional fallback.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	PRONOUNCE_MAX_WORDS,
	alignWordsToAudio,
	countWords,
	pronounceTextError,
	scoreBand,
	soundFixes,
	wordSpans,
	wordVerdict,
	type AssessmentWord,
} from "../lib/pronounce.ts";

const phone = (decision: string, expected = "u", heard = "y", score: number | null = 60) => ({
	dimension: "final",
	expected,
	heard,
	score,
	decision,
});
const word = (w: string, decisions: string[]): AssessmentWord => ({
	word: w,
	score: 80,
	start_ms: 0,
	end_ms: 100,
	phones: decisions.map((d) => phone(d)),
});

describe("pronounceTextError (the 40-word refuse gate)", () => {
	it("accepts ordinary selections", () => {
		assert.equal(pronounceTextError("Bonjour le monde"), null);
		assert.equal(countWords("  Bonjour   le monde\n"), 3);
	});

	it("rejects empty and non-string bodies", () => {
		assert.ok(pronounceTextError("   ") !== null);
		assert.ok(pronounceTextError(undefined) !== null);
		assert.ok(pronounceTextError(42) !== null);
	});

	it("refuses over-40 words with a hint naming the cap", () => {
		const over = Array(PRONOUNCE_MAX_WORDS + 1).fill("mot").join(" ");
		const err = pronounceTextError(over);
		assert.ok(err !== null && err.includes(String(PRONOUNCE_MAX_WORDS)));
		assert.equal(pronounceTextError(Array(PRONOUNCE_MAX_WORDS).fill("mot").join(" ")), null);
	});
});

describe("wordVerdict (decisions first, never raw grades)", () => {
	it("review wins over everything", () => {
		assert.equal(wordVerdict(word("tu", ["no_correction", "review", "uncertain"])), "review");
	});

	it("uncertain (and unassessable/partial) without review reads uncertain", () => {
		assert.equal(wordVerdict(word("tu", ["no_correction", "uncertain"])), "uncertain");
		assert.equal(wordVerdict(word("tu", ["unassessable"])), "uncertain");
		assert.equal(wordVerdict(word("tu", ["partial"])), "uncertain");
	});

	it("clean phones read ok; phoneless words read uncertain, not ok", () => {
		assert.equal(wordVerdict(word("tu", ["no_correction", "no_correction"])), "ok");
		assert.equal(wordVerdict({ ...word("tu", []), score: 90 }), "uncertain");
	});
});

describe("soundFixes (the fix-these list)", () => {
	it("keeps review phones only, worst score first", () => {
		const words = [
			{ ...word("bon", ["no_correction"]), score: 95 },
			{ ...word("jour", ["review", "uncertain"]), score: 50 },
		];
		const fixes = soundFixes(words);
		assert.equal(fixes.length, 1);
		assert.equal(fixes[0]!.word, "jour");
		assert.equal(fixes[0]!.expected, "u");
		assert.equal(fixes[0]!.heard, "y");
	});
});

describe("scoreBand", () => {
	it("bands 85+/70+; null reads work, never great", () => {
		assert.equal(scoreBand(92), "great");
		assert.equal(scoreBand(85), "great");
		assert.equal(scoreBand(70), "good");
		assert.equal(scoreBand(69.9), "work");
		assert.equal(scoreBand(null), "work");
	});
});

describe("alignWordsToAudio (model highlighting)", () => {
	const text = "Bonjour le monde";

	it("maps words onto character windows", () => {
		const chars = [...text];
		const alignment = {
			characters: chars,
			character_start_times_seconds: chars.map((_, i) => i * 0.1),
			character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
		};
		const windows = alignWordsToAudio(text, alignment, 10);
		assert.equal(windows.length, wordSpans(text).length);
		assert.ok(windows[0]!.start < windows[1]!.start, "monotonic");
		assert.ok(windows[0]!.end <= windows[1]!.start + 0.11, "adjacent");
	});

	it("falls back to proportional slices without alignment", () => {
		const windows = alignWordsToAudio(text, null, 8);
		assert.equal(windows.length, 3);
		assert.ok(windows[0]!.start < windows[1]!.start);
		assert.ok(windows[2]!.end <= 8.001);
	});

	it("falls back on length mismatch instead of mis-highlighting", () => {
		const windows = alignWordsToAudio(
			text,
			{
				characters: ["x"],
				character_start_times_seconds: [0],
				character_end_times_seconds: [1],
			},
			4,
		);
		assert.equal(windows.length, 3);
	});
});
