import { NextResponse } from "next/server";
import { openAICompatibleStore } from "@/src/store/openai-compatible";
import { syncOpenAICompatibleProviders } from "@/src/agent/models";
import { slugifyEndpoint, envVarForSlug } from "@/src/core/openai-compatible";

export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json({ endpoints: openAICompatibleStore.list() });
}

export async function POST(req: Request) {
	const body = await req.json().catch(() => ({}));
	const label = String(body.label ?? "").trim();
	const baseUrl = String(body.baseUrl ?? "").trim().replace(/\/$/, "");
	if (!label || !baseUrl) {
		return NextResponse.json({ error: "label and baseUrl required" }, { status: 400 });
	}
	const list = openAICompatibleStore.list();
	const slug = slugifyEndpoint(label);
	let id = slug;
	let i = 2;
	while (list.some((e) => e.id === id)) { id = `${slug}-${i++}`; }
	const envVar = envVarForSlug(id);
	list.push({ id, label, baseUrl, envVar });
	openAICompatibleStore.save(list);
	syncOpenAICompatibleProviders(list);
	return NextResponse.json({ endpoint: { id, label, baseUrl, envVar } });
}

export async function DELETE(req: Request) {
	const body = await req.json().catch(() => ({}));
	const id = String(body.id ?? "").trim();
	const list = openAICompatibleStore.list().filter((e) => e.id !== id);
	openAICompatibleStore.save(list);
	syncOpenAICompatibleProviders(list);
	return NextResponse.json({ ok: true });
}