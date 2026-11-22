/** Non-empty trimmed selection inside a DOM scope (transcript column). */
export function selectionTextInScope(scope: HTMLElement | null): string | null {
	if (typeof window === "undefined" || !scope) return null;
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed) return null;
	const text = sel.toString().trim();
	if (!text) return null;
	const node = sel.anchorNode;
	const el = node instanceof Element ? node : node?.parentElement;
	if (!el || !scope.contains(el)) return null;
	return text;
}