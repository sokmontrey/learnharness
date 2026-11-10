/**
 * POST-less BYOK mint: the renderer never holds the real Gladia key.
 *
 * The key lives server-side only. A dictation run starts here: initiate a
 * Gladia live session and return its WebSocket URL; the renderer opens its
 * WebSocket to Gladia directly, and audio flows renderer → Gladia, never
 * through this server.
 */
import { keyValue } from "@/src/server";

export async function GET() {
	const key = keyValue("GLADIA_API_KEY");
	if (!key) {
		return Response.json(
			{ message: "Dictation needs a Gladia key" },
			{ status: 503 },
		);
	}

	try {
		const res = await fetch("https://api.gladia.io/v2/live", {
			method: "POST",
			headers: { "x-gladia-key": key, "Content-Type": "application/json" },
			body: JSON.stringify({
				encoding: "wav/pcm",
				bit_depth: 16,
				sample_rate: 16000,
				channels: 1,
				endpointing: 0.3,
				maximum_duration_without_endpointing: 5,
				language_config: { languages: ["en", "fr"], code_switching: true },
				messages_config: {
					receive_partial_transcripts: false,
					receive_final_transcripts: true,
					receive_speech_events: false,
				},
			}),
		});
		const data = (await res.json()) as { url?: string; id?: string; message?: string };
		if (!res.ok || !data.url) {
			return Response.json(
				{ message: data.message ?? `Gladia session init failed (${res.status})` },
				{ status: 502 },
			);
		}
		return Response.json({ url: data.url, id: data.id });
	} catch {
		return Response.json({ message: "Gladia unreachable" }, { status: 502 });
	}
}