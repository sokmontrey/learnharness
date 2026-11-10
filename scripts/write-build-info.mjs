/**
 * write-build-info.mjs — stamps src/core/build-info.ts's data (versioning
 * wave, owner 2026-11): the one honest answer to "is the running app
 * actually this build." Runs as `prebuild`/`predev` (package.json npm
 * hooks) so both `npm run build` (the systemd/Electron path) and
 * `npm run dev` refresh it; the committed file is a stub fallback for a
 * fresh clone that hasn't built yet, not the source of truth.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

function git(cmd) {
	try {
		return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
	} catch {
		return null;
	}
}

const shortSha = git("git rev-parse --short HEAD") ?? "unknown";
const dirty = (git("git status --porcelain") ?? "").length > 0;
const commit = shortSha === "unknown" ? shortSha : dirty ? `${shortSha}-dirty` : shortSha;

const info = {
	version: pkg.version,
	commit,
	builtAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(ROOT, "src", "core", "build-info.json"), `${JSON.stringify(info, null, "\t")}\n`);
console.log("[write-build-info]", info);
