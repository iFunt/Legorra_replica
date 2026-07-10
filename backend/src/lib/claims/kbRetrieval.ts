// Keyword retrieval over the curated GDPR knowledge base (public.gdpr_kb,
// seeded by backend/migrations/002_gdpr_kb_seed.sql). Uses Postgres
// full-text search (the generated `search_vector` tsvector column) rather
// than embeddings — sufficient for a few dozen curated entries; swapping in
// pgvector similarity search later is a drop-in replacement for this module.
import type { createServerSupabase } from "../supabase";

type Db = ReturnType<typeof createServerSupabase>;

export type KbCategory =
    | "statute"
    | "case_law"
    | "ico_case"
    | "distress_wording"
    | "guidance";

export type KbEntry = {
    id: string;
    category: KbCategory;
    title: string;
    citation: string | null;
    summary: string;
    full_text: string | null;
    tags: string[];
};

export async function searchKb(
    db: Db,
    query: string,
    opts?: { limit?: number; categories?: KbCategory[] },
): Promise<KbEntry[]> {
    const limit = opts?.limit ?? 8;
    let q = db
        .from("gdpr_kb")
        .select("id, category, title, citation, summary, full_text, tags")
        .textSearch("search_vector", query, { type: "websearch", config: "english" })
        .limit(limit);
    if (opts?.categories?.length) q = q.in("category", opts.categories);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as KbEntry[];
}

/** Renders retrieved entries as a compact bullet list for prompt context. */
export function formatKbForPrompt(entries: KbEntry[]): string {
    if (!entries.length) return "No matching knowledge-base entries found.";
    return entries
        .map(
            (e) =>
                `- [${e.category}] ${e.title}${e.citation ? ` (${e.citation})` : ""}: ${e.summary}`,
        )
        .join("\n");
}
