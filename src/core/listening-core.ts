/**
 * Listening exercise contract — dictation grading, normalization, and
 * realtime diff helpers. Browser-safe (no framework imports).
 */

import { Type, type Static } from "typebox";

/** Agent-authored listening clip (tool input). */
export const listeningInputObject = Type.Object({
	targetText: Type.String({
		description:
			"The exact French sentence the learner hears and must type — one short sentence (roughly 4–14 words), Unicode and accents exact.",
	}),
	contextText: Type.Optional(
		Type.String({
			description: "Short English setup shown in the dock (never the French target).",
		}),
	),
	slowDefault: Type.Optional(
		Type.Boolean({
			description: "When true, the dock opens with slow TTS selected.",
		}),
	),
});

export type ListeningToolInput = Static<typeof listeningInputObject>;

export const LISTENING_MAX_WORDS = 20;
export const LISTENING_MIN_WORDS = 2;

/** Words (incl. elisions/compounds), digits, or single punctuation — `,?!.` etc. are not glued to words. */
const LISTENING_TOKEN_RE = /[\p{L}][\p{L}\p{M}'\-]*|\d+|[^\p{L}\p{N}\s]/gu;

const LISTENING_TYPED_CHUNK_RE = /(\s+)|([\p{L}][\p{L}\p{M}'\-]*|\d+|[^\p{L}\p{N}\s])/gu;

/** Heuristic: a token is mostly Latin letters + French punctuation. */
function looksFrench(text: string): boolean {
	const stripped = text.replace(/[\s\d.,!?;:'"\-—…«»()]/gu, "");
	if (stripped.length === 0) return false;
	const latin = stripped.replace(/[^\p{Script=Latin}]/gu, "");
	return latin.length >= stripped.length * 0.7;
}

function isWordToken(tok: string): boolean {
	return /^[\p{L}]/u.test(tok);
}

function countWordTokens(tokens: readonly string[]): number {
	return tokens.filter(isWordToken).length;
}

export function listeningInputProblems(input: ListeningToolInput): string[] {
	const problems: string[] = [];
	const target = input.targetText?.trim() ?? "";
	if (target.length === 0) {
		problems.push("targetText is empty — provide one French sentence.");
		return problems;
	}
	if (!looksFrench(target)) {
		problems.push("targetText should be French — use ASCII/Latin letters with French accents.");
	}
	const tokens = tokenizeListening(target);
	const words = countWordTokens(tokens);
	if (words < LISTENING_MIN_WORDS) {
		problems.push(`targetText is too short — at least ${LISTENING_MIN_WORDS} words.`);
	}
	if (words > LISTENING_MAX_WORDS) {
		problems.push(`targetText is ${words} words — cap is ${LISTENING_MAX_WORDS}.`);
	}
	if (input.contextText !== undefined && input.contextText.trim().length === 0) {
		problems.push("contextText, when provided, must be non-empty.");
	}
	return problems;
}

export function parseListeningInput(input: unknown): ListeningToolInput | null {
	if (typeof input !== "object" || input === null) return null;
	const o = input as Record<string, unknown>;
	if (typeof o.targetText !== "string") return null;
	return {
		targetText: o.targetText,
		contextText: typeof o.contextText === "string" ? o.contextText : undefined,
		slowDefault: o.slowDefault === true,
	};
}

/** Unicode NFC + collapsed whitespace — accents stay strict. */
export function normalizeListeningText(text: string): string {
	return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Split into words (with elisions), digits, and standalone punctuation. */
export function tokenizeListening(text: string): string[] {
	const norm = normalizeListeningText(text);
	if (!norm) return [];
	const tokens: string[] = [];
	const re = new RegExp(LISTENING_TOKEN_RE.source, LISTENING_TOKEN_RE.flags);
	let m: RegExpExecArray | null;
	while ((m = re.exec(norm)) !== null) tokens.push(m[0]!);
	return tokens;
}

export function isPunctuationToken(tok: string): boolean {
	return !/^[\p{L}\d]/u.test(tok);
}

function scanTypedChunks(typedText: string): { text: string; tokenIndex: number | null }[] {
	const chunks: { text: string; tokenIndex: number | null }[] = [];
	let tokenIdx = 0;
	const re = new RegExp(LISTENING_TYPED_CHUNK_RE.source, LISTENING_TYPED_CHUNK_RE.flags);
	let m: RegExpExecArray | null;
	while ((m = re.exec(typedText)) !== null) {
		if (m[1]) chunks.push({ text: m[1], tokenIndex: null });
		else chunks.push({ text: m[2]!, tokenIndex: tokenIdx++ });
	}
	return chunks;
}

export type ListeningTokenStatus = "correct" | "wrong" | "pending" | "extra";

/** Per-character highlight in the typing field. */
export type TypedHighlightStatus = "exact" | "accent" | "partial" | "wrong" | "extra" | "neutral";

/** Strip combining marks — accents optional for loose match, not for perfection. */
export function stripListeningAccents(text: string): string {
	return text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** Case- and accent-insensitive fold for loose token match. */
export function foldListening(text: string): string {
	return stripListeningAccents(text).toLocaleLowerCase("fr-FR");
}

function mergeHighlightSegments(
	segments: { text: string; status: Exclude<TypedHighlightStatus, "neutral"> }[],
): { text: string; status: TypedHighlightStatus }[] {
	if (segments.length === 0) return [];
	const out: { text: string; status: Exclude<TypedHighlightStatus, "neutral"> }[] = [{ ...segments[0]! }];
	for (let i = 1; i < segments.length; i++) {
		const s = segments[i]!;
		const last = out[out.length - 1]!;
		if (last.status === s.status) last.text += s.text;
		else out.push({ ...s });
	}
	return out;
}

function tokensMatchLoose(typed: string, target: string): boolean {
	return foldListening(typed) === foldListening(target);
}

function charMatchStatus(tc: string, gc: string): "exact" | "accent" | "wrong" {
	if (tc === gc) return "exact";
	const stripT = stripListeningAccents(tc);
	const stripG = stripListeningAccents(gc);
	if (stripT === stripG) {
		if (tc !== gc) return "accent";
		return "exact";
	}
	if (foldListening(tc) === foldListening(gc)) return "exact";
	return "wrong";
}

function highlightTokenChars(typed: string, target: string): { text: string; status: TypedHighlightStatus }[] {
	const building =
		typed.length < target.length &&
		foldListening(target).startsWith(foldListening(typed)) &&
		typed.length > 0 &&
		!tokensMatchLoose(typed, target);
	const raw: { text: string; status: Exclude<TypedHighlightStatus, "neutral" | "extra"> }[] = [];
	for (let i = 0; i < typed.length; i++) {
		const tc = typed[i]!;
		const gc = target[i];
		if (gc === undefined) {
			raw.push({ text: typed.slice(i), status: "wrong" });
			break;
		}
		const status = charMatchStatus(tc, gc);
		if (status === "exact" && building && i === typed.length - 1) raw.push({ text: tc, status: "partial" });
		else if (status === "wrong" && building && i === typed.length - 1) raw.push({ text: tc, status: "partial" });
		else raw.push({ text: tc, status: status === "exact" ? "exact" : status });
	}
	return mergeHighlightSegments(raw);
}

export interface ListeningTokenDiff {
	token: string;
	status: ListeningTokenStatus;
}

/**
 * Progressive token match: each target token is correct when the typed token
 * matches loosely (case + accent fold); pending when missing; extra when over.
 */
export function diffListeningTokens(targetText: string, typedText: string): ListeningTokenDiff[] {
	const target = tokenizeListening(targetText);
	const typed = tokenizeListening(typedText);
	const out: ListeningTokenDiff[] = [];
	for (let i = 0; i < target.length; i++) {
		const t = typed[i];
		if (t === undefined) out.push({ token: target[i]!, status: "pending" });
		else if (tokensMatchLoose(t, target[i]!)) out.push({ token: t, status: "correct" });
		else out.push({ token: t, status: "wrong" });
	}
	for (let i = target.length; i < typed.length; i++) {
		out.push({ token: typed[i]!, status: "extra" });
	}
	return out;
}

/**
 * Highlight segments for the learner's input only — char-level inside words,
 * one status per punctuation token; case-insensitive loose match.
 */
export function highlightTypedSegments(
	targetText: string,
	typedText: string,
): { text: string; status: TypedHighlightStatus }[] {
	if (!typedText) return [];
	const target = tokenizeListening(targetText);
	const chunks = scanTypedChunks(typedText);
	const out: { text: string; status: TypedHighlightStatus }[] = [];
	for (const chunk of chunks) {
		if (chunk.tokenIndex === null) {
			out.push({ text: chunk.text, status: "neutral" });
			continue;
		}
		const typed = chunk.text;
		const tgt = target[chunk.tokenIndex];
		if (!tgt) {
			out.push({ text: typed, status: "extra" });
			continue;
		}
		if (isPunctuationToken(typed) || isPunctuationToken(tgt)) {
			out.push({ text: typed, status: typed === tgt ? "exact" : "wrong" });
			continue;
		}
		out.push(...highlightTokenChars(typed, tgt));
	}
	return out;
}

export function scoreListening(targetText: string, typedText: string): { tokenScore: number; perfect: boolean } {
	const target = tokenizeListening(targetText);
	if (target.length === 0) return { tokenScore: 0, perfect: false };
	const diffs = diffListeningTokens(targetText, typedText);
	let correct = 0;
	for (let i = 0; i < target.length; i++) {
		if (diffs[i]?.status === "correct") correct++;
	}
	const typed = tokenizeListening(typedText);
	let perfect = typed.length === target.length && diffs.filter((d) => d.status === "extra").length === 0;
	if (perfect) {
		for (let i = 0; i < target.length; i++) {
			const t = typed[i];
			const g = target[i];
			if (!t || !g || t !== g) {
				perfect = false;
				break;
			}
		}
	}
	return { tokenScore: correct / target.length, perfect };
}