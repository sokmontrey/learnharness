import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "../../config.ts";
import type { OpenAICompatibleEndpoint } from "../core/openai-compatible.ts";

const FILE = path.join(DATA_ROOT, "openai-compatible.json");

function readList(): OpenAICompatibleEndpoint[] {
	try {
		const raw = JSON.parse(fs.readFileSync(FILE, "utf-8"));
		if (!Array.isArray(raw)) return [];
		return raw.filter((e) => e && typeof e.id === "string" && typeof e.label === "string" && typeof e.baseUrl === "string" && typeof e.envVar === "string");
	} catch {
		return [];
	}
}

function writeList(list: OpenAICompatibleEndpoint[]): void {
	const dir = path.dirname(FILE);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = path.join(dir, `.openai-compatible.json.tmp-${process.pid}`);
	fs.writeFileSync(tmp, `${JSON.stringify(list, null, "\t")}\n`, { mode: 0o600 });
	fs.chmodSync(tmp, 0o600);
	fs.renameSync(tmp, FILE);
}

export const openAICompatibleStore = {
	list(): OpenAICompatibleEndpoint[] { return readList(); },
	save(list: OpenAICompatibleEndpoint[]): void { writeList(list); },
};