/**
 * POST /api/pronounce — pronunciation assessment proxy (TonePerfect).
 *
 * The renderer never holds the TonePerfect key (same doctrine as the TTS
 * and STT routes): the key lives server-side only (auth.json → process.env
 * in the desktop app; .env.local in dev), this route forwards the
 * recorded attempt with it and returns TonePerfect's JSON.
 *
 * Guardrails: 503 with no key (the panel deep-links Settings instead of
 * failing silently), 400 on empty/over-40-word texts (their engine caps
 * non-Mandarin texts at 40 words), 413 past their 10MB audio ceiling. One
 * fresh Idempotency-Key per attempt (their contract: reuse a key only to
 * retry the SAME attempt).
 */
import { randomUUID } from "node:crypto";
import {
	PRONOUNCE_LANGUAGE,
	PRONOUNCE_MAX_AUDIO_BYTES,
	pronounceTextError,
} from "@/lib/pronounce";
import { keyValue } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		return Response.json({ error: "body must be multipart form-data" }, { status: 400 });
	}
	const textValue = form.get("text");
	const audioValue = form.get("audio");
	const invalid = pronounceTextError(typeof textValue === "string" ? textValue : undefined);
	if (invalid) return Response.json({ error: invalid }, { status: 400 });
	if (!(audioValue instanceof File) || audioValue.size === 0) {
		return Response.json({ error: "audio file required" }, { status: 400 });
	}
	if (audioValue.size > PRONOUNCE_MAX_AUDIO_BYTES) {
		return Response.json(
			{ error: "recording is over TonePerfect's 10MB ceiling — record a shorter attempt" },
			{ status: 413 },
		);
	}

	const key = keyValue("TONEPERFECT_API_KEY");
	if (!key) {
		return Response.json(
			{ message: "No TONEPERFECT_API_KEY — add it in Settings → Providers → Pronunciation." },
			{ status: 503 },
		);
	}

	const upstream = new FormData();
	upstream.append("audio", audioValue, audioValue.name || "attempt.webm");
	upstream.append("text", textValue as string);
	upstream.append("language", PRONOUNCE_LANGUAGE);
	try {
		const res = await fetch("https://api.toneperfect.app/v1/assess", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Idempotency-Key": randomUUID(),
			},
			body: upstream,
			signal: AbortSignal.timeout(90000),
		});
		const data = (await res.json().catch(() => null)) as {
			error?: { code?: unknown; message?: unknown };
		} | null;
		if (!res.ok) {
			const detail =
				data?.error && typeof data.error.message === "string"
					? `${String(data.error.code ?? "")} ${data.error.message}`.trim()
					: `status ${res.status}`;
			console.error(`[pronounce] TonePerfect ${res.status}`);
			return Response.json(
				{ message: `Pronunciation assessment failed (${res.status}): ${detail.slice(0, 200)}` },
				{ status: 502 },
			);
		}
		return Response.json(data);
	} catch {
		console.error("[pronounce] TonePerfect unreachable");
		return Response.json({ message: "TonePerfect unreachable" }, { status: 502 });
	}
}
