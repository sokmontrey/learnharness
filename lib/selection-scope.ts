/** Floating panels (explain, meaning-infer) sit outside the transcript
 *  scroller but should still get the selection toolbar. */
const SELECTION_SURFACE = "[data-selection-surface]";

export function elementInSelectionScope(el: Element, scope: HTMLElement | null): boolean {
	if (!scope) return false;
	if (scope.contains(el)) return true;
	return Boolean(el.closest(SELECTION_SURFACE));
}

/** Native message id for explain/infer/ask context — walks ancestors. */
export function selectionMessageIdFromElement(el: Element | null): string | null {
	if (!el) return null;
	const holder = el.closest("[data-source-message-id]") as HTMLElement | null;
	const id = holder?.dataset.sourceMessageId?.trim();
	return id || null;
}