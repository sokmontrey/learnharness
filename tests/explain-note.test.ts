/**
 * THE KEPT EXPLANATION (annotation wave, owner 2026-11): the "Keep in chat"
 * result is a UI-only marker. These pins cover the three pure seams the
 * panel/route rely on — the record shape, the model-facing filter (it must
 * never re-enter the lesson's context), and the transcript projection (a
 * standalone data card, never a text bubble).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newExplainNoteMessage, toLlmMessages } from "../src/core/native-messages.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";

const DETAILS = {
	targetMessageId: "msg_target",
	pointer: "why does the sign flip here?",
	text: "**Short answer:** the negative distributes over both terms.\n\n```mermaid\nflowchart LR\n  A[x - (y + z)] --> B[x - y - z]\n```",
};

describe("newExplainNoteMessage", () => {
	it("is a UI-only marker: no model-facing content, details carry the answer", () => {
		const m = newExplainNoteMessage(DETAILS);
		assert.equal(m.role, "custom");
		assert.equal(m.customType, "explain-note");
		assert.equal(m.content, "");
		assert.equal(m.display, true);
		assert.deepEqual(m.details, DETAILS);
		assert.ok(m.id);
	});
});

describe("toLlmMessages", () => {
	it("drops the kept explanation — inserting one never nudges the lesson", () => {
		const marker = newExplainNoteMessage(DETAILS);
		const wire = toLlmMessages([marker as unknown as LhMessage] as never);
		assert.equal(wire.length, 0);
	});
});

describe("projectView", () => {
	it("renders a standalone data-explain-note card (not a text bubble)", () => {
		const marker = newExplainNoteMessage(DETAILS);
		const view = projectView([marker as unknown as LhMessage] as never);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.role, "user");
		const part = view[0]!.parts[0] as { type: string; data: unknown };
		assert.equal(part.type, "data-explain-note");
		assert.deepEqual(part.data, DETAILS);
	});
});
