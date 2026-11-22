/** Types + helpers for user-defined OpenAI-compatible providers
 *  (Radium, and any other service exposing an OpenAI-style /v1 API). */

export interface OpenAICompatibleEndpoint {
	/** Stable slug used as the pi-ai provider id and in model stamps. */
	id: string;
	/** Human label shown in the picker. */
	label: string;
	/** Base URL, e.g. https://api.radium.cloud/v1 */
	baseUrl: string;
	/** The env var the API key rides in (stored in auth.json). */
	envVar: string;
	/** Optional manually specified model ids (used when /models is unavailable). */
	models?: string[];
}

/** Turn a free-form label into a safe slug id. */
export function slugifyEndpoint(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40) || "openai-compatible";
}

export function envVarForSlug(slug: string): string {
	return `OPENAI_COMPATIBLE_${slug.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}