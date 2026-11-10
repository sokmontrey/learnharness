/**
 * GET /api/tts/align?text=&language= — model audio WITH word timings for
 * the practice panel's "hear the model" (slowed + realtime highlighting).
 *
 * Calls ElevenLabs' with-timestamps endpoint and returns
 * { audioBase64, alignment } — the panel decodes the audio and maps the
 * character alignment onto reference words. Same key/cap/cache doctrine
 * as POST /api/tts (separate cache entries: alignment responses are JSON,
 * not MP3). A null alignment (model gave none) is NOT an error — the
 * panel falls back to proportional timing.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	TTS_MAX_CHARS,
	TTS_MODEL,
	TTS_VOICE_ID,
	parseTtsLanguage,
	ttsTextError,
} from "@/lib/tts";
import { keyValue } from "@/src/server";

export const dynamic = "force-dynamic";

const CACHE_DIR = join(tmpdir(), "learnharness-tts");

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const rawText = params.get("text") ?? undefined;
	const language = parseTtsLanguage(params.get("language"));
	const invalid = ttsTextError(rawText);
	if (invalid) {
		const overCap = typeof rawText === "string" && rawText.length > TTS_MAX_CHARS;
		return Response.json({ error: invalid }, { status: overCap ? 413 : 400 });
	}
	if (!language) {
		return Response.json({ error: "language must be fr or en" }, { status: 400 });
	}

	const key = keyValue("ELEVENLABS_API_KEY");
	if (!key) {
		return Response.json(
			{ message: "No ELEVENLABS_API_KEY — add it in Settings → Providers → Read-aloud." },
			{ status: 503 },
		);
	}

	const digest = createHash("sha256")
		.update(`${TTS_MODEL}|${TTS_VOICE_ID}|${language}|${rawText as string}|align`)
		.digest("hex");
	const cached = join(CACHE_DIR, `${digest}.json`);
	try {
		const hit = await fs.readFile(cached, "utf-8");
		return Response.json(JSON.parse(hit), {
			headers: { "X-LH-TTS-Cache": "HIT" },
		});
	} catch {
		// Cache miss — synthesize below.
	}

	try {
		const res = await fetch(
			`https://api.elevenlabs.io/v1/text-to-speech/${TTS_VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
			{
				method: "POST",
				headers: { "xi-api-key": key, "content-type": "application/json" },
				body: JSON.stringify({
					text: rawText,
					model_id: TTS_MODEL,
					language_code: language,
				}),
			},
		);
		if (!res.ok) {
			const detail = await res.text();
			console.error(`[tts-align] ElevenLabs ${res.status}`);
			return Response.json(
				{ message: `ElevenLabs synthesis failed (${res.status}): ${detail.slice(0, 200)}` },
				{ status: 502 },
			);
		}
		const data = (await res.json()) as {
			audio_base64?: unknown;
			alignment?: unknown;
		};
		const payload = {
			audioBase64: typeof data.audio_base64 === "string" ? data.audio_base64 : null,
			alignment: data.alignment ?? null,
		};
		if (!payload.audioBase64) {
			return Response.json(
				{ message: "ElevenLabs returned no audio" },
				{ status: 502 },
			);
		}
		try {
			await fs.mkdir(CACHE_DIR, { recursive: true });
			await fs.writeFile(cached, JSON.stringify(payload));
		} catch {
			// Uncached this time; the audio still plays.
		}
		return Response.json(payload, {
			headers: { "X-LH-TTS-Cache": "MISS" },
		});
	} catch {
		console.error("[tts-align] ElevenLabs unreachable");
		return Response.json({ message: "ElevenLabs unreachable" }, { status: 502 });
	}
}
