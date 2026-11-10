/**
 * POST /api/tts — read-aloud synthesis proxy (ElevenLabs Flash v2.5).
 *
 * The renderer never holds the ElevenLabs key (same doctrine as the STT
 * token route): the key lives server-side only (auth.json → process.env
 * in the desktop app; .env.local in dev), this route calls ElevenLabs
 * with it and streams the MP3 back.
 *
 * Guardrails: 503 with no key (the button deep-links Settings instead of
 * failing silently), 413 past TTS_MAX_CHARS (cost cap), and a disk cache
 * keyed by model+voice+language+text — repeat reads of the same selection cost $0.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TTS_MAX_CHARS, TTS_MODEL, TTS_VOICE_ID, parseTtsLanguage, ttsTextError } from "@/lib/tts";
import { keyValue } from "@/src/server";

export const dynamic = "force-dynamic";

const CACHE_DIR = join(tmpdir(), "learnharness-tts");

export async function POST(req: Request) {
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "body must be JSON" }, { status: 400 });
	}
	const text = (body as { text?: unknown })?.text;
	const language = parseTtsLanguage((body as { language?: unknown })?.language);
	const invalid = ttsTextError(text);
	if (invalid) {
		const overCap =
			typeof text === "string" && text.length > TTS_MAX_CHARS;
		return Response.json(
			{ error: invalid },
			{ status: overCap ? 413 : 400 },
		);
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
		.update(`${TTS_MODEL}|${TTS_VOICE_ID}|${language}|${text as string}`)
		.digest("hex");
	const cached = join(CACHE_DIR, `${digest}.mp3`);
	try {
		const hit = await fs.readFile(cached);
		return new Response(new Uint8Array(hit), {
			headers: { "content-type": "audio/mpeg", "X-LH-TTS-Cache": "HIT" },
		});
	} catch {
		// Cache miss — synthesize below.
	}

	try {
		const res = await fetch(
			`https://api.elevenlabs.io/v1/text-to-speech/${TTS_VOICE_ID}?output_format=mp3_44100_128`,
			{
				method: "POST",
				headers: { "xi-api-key": key, "content-type": "application/json" },
				// Per-button language (owner choice) — unsupported codes are
				// ignored per ElevenLabs docs, so this can never 422.
				body: JSON.stringify({ text, model_id: TTS_MODEL, language_code: language }),
			},
		);
		if (!res.ok) {
			const detail = await res.text();
			console.error(`[tts] ElevenLabs ${res.status}`);
			return Response.json(
				{ message: `ElevenLabs synthesis failed (${res.status}): ${detail.slice(0, 200)}` },
				{ status: 502 },
			);
		}
		const bytes = new Uint8Array(await res.arrayBuffer());
		// Best-effort cache write — a full disk must never fail the read.
		try {
			await fs.mkdir(CACHE_DIR, { recursive: true });
			await fs.writeFile(cached, bytes);
		} catch {
			// Uncached this time; the audio still plays.
		}
		return new Response(bytes, {
			headers: { "content-type": "audio/mpeg", "X-LH-TTS-Cache": "MISS" },
		});
	} catch {
		console.error("[tts] ElevenLabs unreachable");
		return Response.json({ message: "ElevenLabs unreachable" }, { status: 502 });
	}
}
