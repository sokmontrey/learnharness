"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MicIcon, SparklesIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { useExplain } from "@/components/explain-panel";
import { PronouncePanel } from "@/components/pronounce-panel";
import {
	TTS_LANGUAGES,
	TTS_MAX_CHARS,
	TTS_NORMAL_RATE,
	TTS_SLOW_RATE,
	createTtsProvider,
	type TtsLanguage,
} from "@/lib/tts";

/** The keys-section row the keyless button deep-links (the dictation precedent). */
export const ELEVENLABS_KEY_ID = "ELEVENLABS_API_KEY";

type TtsStatus = "ok" | "key-needed" | "too-long" | "failed";

const LANGUAGE_LABEL: Record<TtsLanguage, string> = { fr: "French", en: "English" };

/**
 * The floating selection toolbar for the transcript: Explain + read-aloud +
 * pronunciation practice in ONE row, above the selection. They used to be
 * two independently-positioned popups, so the Explain and read-aloud buttons
 * landed on top of each other (owner report) — one toolbar means one anchor
 * and no overlap.
 *
 * Shows whenever the selection is non-empty and anchored inside `scopeRef`
 * (the transcript column — sidebar/composer selections never trigger it).
 * Explain appears only when the selection sits inside a text block carrying
 * `data-source-message-id` — that attribute is the target message the
 * explainer's last-two-turns window anchors to. First read-aloud click reads
 * at natural pace; clicking the SAME language again while it speaks cancels
 * and re-reads slower (study pace via playbackRate — ElevenLabs has no
 * speed param). Clicking the other language switches to it at natural pace.
 * `onMouseDown` preventDefault keeps the click from collapsing the
 * selection before the handler runs.
 *
 * No key → the buttons say so and deep-link Settings → Providers →
 * Read-aloud on click (never a silent failure). Over-cap selections get a
 * hint instead of a bill.
 */
export function SelectionToolbar({
	scopeRef,
}: {
	scopeRef: RefObject<HTMLElement | null>;
}) {
	const provider = useMemo(() => createTtsProvider(), []);
	const { open: openSettings } = useSettingsDialog();
	const { open: openExplain } = useExplain();
	const [anchor, setAnchor] = useState<{ x: number; y: number; messageId: string | null } | null>(null);
	const [speakingLang, setSpeakingLang] = useState<TtsLanguage | null>(null);
	const [status, setStatus] = useState<TtsStatus>("ok");
	const [failDetail, setFailDetail] = useState<string | null>(null);
	const [practice, setPractice] = useState<{ text: string; x: number; y: number } | null>(null);
	const lastText = useRef("");

	const fail = (detail?: string) => {
		setFailDetail(detail?.slice(0, 200) ?? null);
		setSpeakingLang(null);
		setStatus("failed");
	};

	useEffect(() => {
		const updateFromSelection = () => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) {
				setAnchor(null);
				return;
			}
			const text = sel.toString().trim();
			if (!text) {
				setAnchor(null);
				return;
			}
			const node = sel.anchorNode;
			const el = node instanceof Element ? node : node?.parentElement;
			const scope = scopeRef.current;
			if (!el || !scope || !scope.contains(el)) {
				setAnchor(null);
				return;
			}
			// Explain needs the transcript text block's source message id;
			// read-aloud/practice work anywhere inside the scope. A selection
			// without a holder simply renders the toolbar without Explain.
			const holder = el.closest("[data-source-message-id]") as HTMLElement | null;
			const messageId = holder?.dataset.sourceMessageId ?? null;
			if (text !== lastText.current) {
				lastText.current = text;
				setStatus("ok");
				setFailDetail(null);
			}
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			// Clamp horizontally so the popup never leaves the viewport.
			const x = Math.min(
				Math.max(rect.left + rect.width / 2, 70),
				window.innerWidth - 70,
			);
			setAnchor({ x, y: rect.top, messageId });
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				provider.cancel();
				setSpeakingLang(null);
			}
		};

		// Scroll (captured — the transcript scroller isn't `document`) would
		// strand fixed-position surfaces, so hide them; the selection survives.
		const onScroll = () => {
			setAnchor(null);
			setPractice(null);
		};

		document.addEventListener("selectionchange", updateFromSelection);
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("selectionchange", updateFromSelection);
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("scroll", onScroll, true);
			provider.cancel();
		};
	}, [provider, scopeRef]);

	const readAloud = (language: TtsLanguage) => {
		if (status === "key-needed") {
			openSettings("keys", ELEVENLABS_KEY_ID);
			return;
		}
		const text = lastText.current.trim();
		if (!text) return;
		if (text.length > TTS_MAX_CHARS) {
			setStatus("too-long");
			return;
		}
		const onError = (kind: "key-needed" | "too-long" | "failed", detail?: string) => {
			if (kind === "key-needed") {
				setSpeakingLang(null);
				setStatus("key-needed");
			} else if (kind === "too-long") {
				setSpeakingLang(null);
				setStatus("too-long");
			} else fail(detail);
		};
		// Same language while it speaks → slower re-read; otherwise fresh read.
		const rate =
			provider.isSpeaking() && speakingLang === language ? TTS_SLOW_RATE : TTS_NORMAL_RATE;
		provider.speak(text, {
			lang: language,
			rate,
			onEnd: () => setSpeakingLang(null),
			onError,
		});
		setSpeakingLang(language);
	};

	if (!anchor && !practice) return null;

	const labelFor = (language: TtsLanguage) => {
		if (status === "key-needed") return "ElevenLabs key needed — open Settings";
		if (status === "too-long")
			return `Selection too long (over ${TTS_MAX_CHARS} characters)`;
		if (status === "failed") return failDetail ?? "Read-aloud failed — try again";
		if (speakingLang === language)
			return `Re-read selection aloud in ${LANGUAGE_LABEL[language]}, slower`;
		return `Read selection aloud in ${LANGUAGE_LABEL[language]}`;
	};

	return (
		<>
			{anchor && (
				<div
					className="fixed z-50"
					style={{
						left: anchor.x,
						top: anchor.y,
						transform: "translate(-50%, -100%) translateY(-8px)",
					}}
				>
					<div className="flex gap-1" role="group" aria-label="Selection actions">
						{anchor.messageId && (
							<Button
								type="button"
								size="xs"
								variant="secondary"
								data-testid="explain-selection-button"
								aria-label="Explain selection"
								title="Explain selection"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									const messageId = anchor.messageId;
									const text = lastText.current.trim();
									setAnchor(null);
									if (messageId && text) openExplain({ targetMessageId: messageId, pointer: text, anchorY: anchor.y });
								}}
								className="cursor-pointer border border-border font-ui uppercase shadow-lg hover:bg-secondary"
							>
								<SparklesIcon className="size-3" />
								Explain
							</Button>
						)}
						{TTS_LANGUAGES.map((language) => (
							<Button
								key={language}
								type="button"
								size="xs"
								variant="secondary"
								data-testid={`tts-selection-button-${language}`}
								aria-label={labelFor(language)}
								title={labelFor(language)}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => readAloud(language)}
								className="cursor-pointer border border-border font-ui uppercase shadow-lg hover:bg-secondary"
							>
								<Volume2Icon className="size-3" />
								{language}
							</Button>
						))}
						<Button
							type="button"
							size="xs"
							variant="secondary"
							data-testid="tts-selection-button-practice"
							aria-label="Practice pronunciation"
							title="Practice pronunciation"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => {
								const text = lastText.current.trim();
								if (text) setPractice({ text, x: anchor.x, y: anchor.y });
							}}
							className="cursor-pointer border border-border font-ui uppercase shadow-lg hover:bg-secondary"
						>
							<MicIcon className="size-3" />
							Practice
						</Button>
					</div>
				</div>
			)}
			{/* Sibling, not a child, of the transformed popup above — a fixed
			    element inside a transformed ancestor would mis-position. */}
			{practice && (
				<PronouncePanel
					text={practice.text}
					anchor={{ x: practice.x, y: practice.y }}
					onClose={() => setPractice(null)}
				/>
			)}
		</>
	);
}
