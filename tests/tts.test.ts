/**
 * TTS provider seam tests — the factory contract future engines must keep:
 * ElevenLabs Flash (cheapest tier) as the engine, the cost-cap validation
 * shared by the route and the button, and server-safe no-ops (no `window`
 * in the test env — every method must guard, never throw).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ElevenLabsTtsProvider,
	TTS_LANGUAGES,
	TTS_MAX_CHARS,
	TTS_MODEL,
	TTS_NORMAL_RATE,
	TTS_SLOW_RATE,
	TTS_VOICE_ID,
	WebSpeechTtsProvider,
	createTtsProvider,
	parseTtsLanguage,
	ttsTextError,
} from "../lib/tts.ts";

describe("createTtsProvider (the swap point)", () => {
	it("returns the ElevenLabs provider with the speak/cancel/isSpeaking surface", () => {
		const provider = createTtsProvider();
		assert.equal(typeof provider.speak, "function");
		assert.equal(typeof provider.cancel, "function");
		assert.equal(typeof provider.isSpeaking, "function");
		assert.ok(provider instanceof ElevenLabsTtsProvider);
	});

	it("pins the cheapest engine: Flash v2.5 + a fixed voice + FR/EN + cost cap", () => {
		assert.equal(TTS_MODEL, "eleven_flash_v2_5");
		assert.ok(TTS_VOICE_ID.length > 0, "a default voice is pinned");
		assert.deepEqual([...TTS_LANGUAGES], ["fr", "en"]);
		assert.equal(TTS_MAX_CHARS, 5000);
		assert.ok(TTS_SLOW_RATE < TTS_NORMAL_RATE, "re-read is slower than first read");
	});

	it("no-ops without a browser (server import never throws)", () => {
		const provider = createTtsProvider();
		assert.equal(provider.isSpeaking(), false);
		assert.doesNotThrow(() =>
			provider.speak("Bonjour", { lang: "fr-FR", rate: TTS_NORMAL_RATE }),
		);
		assert.doesNotThrow(() => provider.cancel());
	});

	it("keeps the Web Speech alternate constructible (the documented seam)", () => {
		const fallback = new WebSpeechTtsProvider();
		assert.equal(fallback.isSpeaking(), false);
	});
});

describe("ttsTextError (the route + button cost guard)", () => {
	it("accepts ordinary selections", () => {
		assert.equal(ttsTextError("Bonjour le monde"), null);
	});

	it("rejects empty and non-string bodies", () => {
		assert.ok(ttsTextError("   ") !== null);
		assert.ok(ttsTextError("") !== null);
		assert.ok(ttsTextError(undefined) !== null);
		assert.ok(ttsTextError({ text: "hi" }) !== null);
	});

	it("rejects over-cap selections", () => {
		assert.ok(ttsTextError("x".repeat(TTS_MAX_CHARS + 1)) !== null);
		assert.equal(ttsTextError("x".repeat(TTS_MAX_CHARS)), null);
	});

	it("parseTtsLanguage gates the route's language to fr/en", () => {
		assert.equal(parseTtsLanguage("fr"), "fr");
		assert.equal(parseTtsLanguage("en"), "en");
		assert.equal(parseTtsLanguage("de"), null);
		assert.equal(parseTtsLanguage(undefined), null);
		assert.equal(parseTtsLanguage(""), null);
	});
});
