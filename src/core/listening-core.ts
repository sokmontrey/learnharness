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

/** Heuristic: a token is mostly Latin letters + French punctuation. */
function looksFrench(text: string): boolean {
	const stripped = text.replace(/[\s\d.,!?;:'"\-—…«»()]/gu, "");
	if (stripped.length === 0) return false;
	const latin = stripped.replace(/[^\p{Script=Latin}]/gu, "");
	return latin.length >= stripped.length * 0.7;
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
	const words = tokenizeListening(target);
	if (words.length < LISTENING_MIN_WORDS) {
		problems.push(`targetText is too short — at least ${LISTENING_MIN_WORDS} words.`);
	}
	if (words.length > LISTENING_MAX_WORDS) {
		problems.push(`targetText is ${words.length} words — cap is ${LISTENING_MAX_WORDS}.`);
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

/** Split on whitespace; keeps apostrophe-led elisions as one token (l'homme). */
export function tokenizeListening(text: string): string[] {
	const norm = normalizeListeningText(text);
	if (!norm) return [];
	return norm.split(/\s+/).filter(Boolean);
}

export type ListeningTokenStatus = "correct" | "wrong" | "pending" | "extra";

export interface ListeningTokenDiff {
	token: string;
	status: ListeningTokenStatus;
}

/**
 * Progressive token match (v1): each target token is correct when the typed
 * token at the same index matches exactly after normalization; wrong when typed
 * differs; pending when not yet typed. Extra typed tokens trail as "extra".
 */
export function diffListeningTokens(targetText: string, typedText: string): ListeningTokenDiff[] {
	const target = tokenizeListening(targetText);
	const typed = tokenizeListening(typedText);
	const out: ListeningTokenDiff[] = [];
	for (let i = 0; i < target.length; i++) {
		const t = typed[i];
		if (t === undefined) out.push({ token: target[i]!, status: "pending" });
		else if (normalizeListeningText(t) === normalizeListeningText(target[i]!)) out.push({ token: t, status: "correct" });
		else out.push({ token: t, status: "wrong" });
	}
	for (let i = target.length; i < typed.length; i++) {
		out.push({ token: typed[i]!, status: "extra" });
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
	const perfect =
		correct === target.length && diffs.filter((d) => d.status === "extra").length === 0;
	return { tokenScore: correct / target.length, perfect };
}