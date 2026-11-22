"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDownIcon, HelpCircleIcon, LightbulbIcon, MessageSquareIcon, MicIcon, SparklesIcon, Volume2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { useExplain } from "@/components/explain-panel";
import { useMeaningInfer } from "@/components/meaning-infer-panel";
import { useAskCapture } from "@/components/ask-capture";
import { PronouncePanel } from "@/components/pronounce-panel";
import {
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
 * Floating selection toolbar: fr read-aloud, Audio menu (English + pronounce),
 * Help menu (Explain, Ask, Deviner). At most three chips in the row.
 */
export function SelectionToolbar({
	scopeRef,
	askSource,
}: {
	scopeRef: RefObject<HTMLElement | null>;
	askSource?: { chatId: string; title: string };
}) {
	const provider = useMemo(() => createTtsProvider(), []);
	const { open: openSettings } = useSettingsDialog();
	const { open: openExplain } = useExplain();
	const { open: openMeaningInfer } = useMeaningInfer();
	const captureAsk = useAskCapture();
	const [anchor, setAnchor] = useState<{ x: number; y: number; messageId: string | null } | null>(null);
	const [speakingLang, setSpeakingLang] = useState<TtsLanguage | null>(null);
	const [status, setStatus] = useState<TtsStatus>("ok");
	const [failDetail, setFailDetail] = useState<string | null>(null);
	const [practice, setPractice] = useState<{ text: string; x: number; y: number } | null>(null);
	const [audioOpen, setAudioOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
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
			const holder = el.closest("[data-source-message-id]") as HTMLElement | null;
			const messageId = holder?.dataset.sourceMessageId ?? null;
			if (text !== lastText.current) {
				lastText.current = text;
				setStatus("ok");
				setFailDetail(null);
			}
			const rect = sel.getRangeAt(0).getBoundingClientRect();
			const x = Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70);
			setAnchor({ x, y: rect.top, messageId });
		};

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				provider.cancel();
				setSpeakingLang(null);
				setAudioOpen(false);
				setHelpOpen(false);
			}
		};

		const onScroll = () => {
			setAnchor(null);
			setPractice(null);
			setAudioOpen(false);
			setHelpOpen(false);
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
		const rate =
			provider.isSpeaking() && speakingLang === language ? TTS_SLOW_RATE : TTS_NORMAL_RATE;
		provider.speak(text, {
			lang: language,
			rate,
			onEnd: () => setSpeakingLang(null),
			onError,
		});
		setSpeakingLang(language);
		setAudioOpen(false);
	};

	const labelFor = (language: TtsLanguage) => {
		if (status === "key-needed") return "ElevenLabs key needed — open Settings";
		if (status === "too-long") return `Selection too long (over ${TTS_MAX_CHARS} characters)`;
		if (status === "failed") return failDetail ?? "Read-aloud failed — try again";
		if (speakingLang === language) return `Re-read selection aloud in ${LANGUAGE_LABEL[language]}, slower`;
		return `Read selection aloud in ${LANGUAGE_LABEL[language]}`;
	};

	const dismissToolbar = () => {
		setAnchor(null);
		setHelpOpen(false);
		setAudioOpen(false);
	};

	if (!anchor && !practice) return null;

	const messageId = anchor?.messageId;
	const anchorY = anchor?.y ?? 0;
	const anchorX = anchor?.x ?? 0;
	const showHelp = Boolean(messageId);

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
						<Button
							type="button"
							size="xs"
							variant="secondary"
							data-testid="tts-selection-button-fr"
							aria-label={labelFor("fr")}
							title={labelFor("fr")}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => readAloud("fr")}
							className="cursor-pointer border border-border font-ui uppercase shadow-lg hover:bg-secondary"
						>
							<Volume2Icon className="size-3" />
							fr
						</Button>

						<Popover open={audioOpen} onOpenChange={setAudioOpen}>
							<PopoverTrigger asChild>
								<Button
									type="button"
									size="xs"
									variant="secondary"
									data-testid="selection-audio-menu"
									aria-label="Audio options"
									title="English read-aloud and pronunciation"
									onMouseDown={(e) => e.preventDefault()}
									className="cursor-pointer border border-border font-ui uppercase shadow-lg hover:bg-secondary"
								>
									<MicIcon className="size-3" />
									Audio
									<ChevronDownIcon className="size-3 opacity-70" />
								</Button>
							</PopoverTrigger>
							<PopoverContent side="top" align="center" className="w-44 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
								<button
									type="button"
									data-testid="tts-selection-button-en"
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => readAloud("en")}
								>
									<Volume2Icon className="size-3.5 shrink-0" />
									Read English
								</button>
								<button
									type="button"
									data-testid="tts-selection-button-practice"
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => {
										const text = lastText.current.trim();
										if (text) {
											setPractice({ text, x: anchorX, y: anchorY });
											setAudioOpen(false);
											dismissToolbar();
										}
									}}
								>
									<MicIcon className="size-3.5 shrink-0" />
									Pronounce
								</button>
							</PopoverContent>
						</Popover>

						{showHelp && (
							<Popover open={helpOpen} onOpenChange={setHelpOpen}>
								<PopoverTrigger asChild>
									<Button
										type="button"
										size="xs"
										variant="secondary"
										data-testid="selection-help-menu"
										aria-label="Help with this selection"
										title="Explain, Ask, or guess meaning in French"
										onMouseDown={(e) => e.preventDefault()}
										className="cursor-pointer border border-border font-ui uppercase shadow-lg hover:bg-secondary"
									>
										<HelpCircleIcon className="size-3" />
										Help
										<ChevronDownIcon className="size-3 opacity-70" />
									</Button>
								</PopoverTrigger>
								<PopoverContent side="top" align="center" className="w-44 p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
									<button
										type="button"
										data-testid="explain-selection-button"
										className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											const text = lastText.current.trim();
											dismissToolbar();
											if (messageId && text) openExplain({ targetMessageId: messageId, pointer: text, anchorY });
										}}
									>
										<SparklesIcon className="size-3.5 shrink-0" />
										Explain
									</button>
									{askSource && (
										<button
											type="button"
											data-testid="ask-selection-button"
											className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
											onMouseDown={(e) => e.preventDefault()}
											onClick={() => {
												const text = lastText.current.trim();
												dismissToolbar();
												if (messageId && text) {
													void captureAsk({
														sourceChatId: askSource.chatId,
														sourceTitle: askSource.title,
														messageIds: [messageId],
														text,
														label: "Selected passage",
													});
												}
											}}
										>
											<MessageSquareIcon className="size-3.5 shrink-0" />
											Ask
										</button>
									)}
									<button
										type="button"
										data-testid="meaning-infer-selection-button"
										className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
										onMouseDown={(e) => e.preventDefault()}
										onClick={() => {
											const text = lastText.current.trim();
											dismissToolbar();
											if (messageId && text) openMeaningInfer({ targetMessageId: messageId, pointer: text, anchorY });
										}}
									>
										<LightbulbIcon className="size-3.5 shrink-0" />
										Deviner
									</button>
								</PopoverContent>
							</Popover>
						)}
					</div>
				</div>
			)}
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