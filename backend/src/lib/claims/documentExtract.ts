// Token-optimization layer for the claims pipeline: extract a document
// version's text/content exactly once and cache it in `document_extracts`,
// keyed by (document_version_id, content_hash). Every later claim stage
// (research, valuation, drafting, judging) reads the cached extract instead
// of re-downloading and re-running pdfjs/mammoth/vision extraction — unlike
// the generic assistant chat surface (chatTools.ts), which is explicitly
// instructed to re-extract full document text on every single turn.
import * as crypto from "crypto";
import * as path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { createServerSupabase } from "../supabase";
import { downloadFile } from "../storage";
import { extractPdfText } from "../chatTools";
import { extractDocxBodyText } from "../docxTrackedChanges";

type Db = ReturnType<typeof createServerSupabase>;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const IMAGE_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
};

function hashBytes(buf: ArrayBuffer): string {
    return crypto.createHash("sha256").update(Buffer.from(buf)).digest("hex");
}

// Rough, cheap heuristic (~4 chars/token for English prose) used only to
// size prompts and log estimated cost — not billed token accounting.
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

async function describeImageWithVision(
    buf: ArrayBuffer,
    mimeType: string,
): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    if (!apiKey) return "[Image content — no vision model API key configured]";
    const anthropic = new Anthropic({ apiKey });
    const base64 = Buffer.from(buf).toString("base64");
    const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: mimeType as
                                | "image/png"
                                | "image/jpeg"
                                | "image/webp"
                                | "image/gif",
                            data: base64,
                        },
                    },
                    {
                        type: "text",
                        text:
                            "Transcribe all visible text verbatim (letters, forms, screenshots of " +
                            "correspondence, etc.). Then briefly describe any non-text content " +
                            "(letterhead, stamps, signatures, photos) relevant to evidencing a GDPR " +
                            "data-protection claim. Output the transcript first, then the description.",
                    },
                ],
            },
        ],
    });
    return resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
}

async function extractRaw(buf: ArrayBuffer, storagePath: string): Promise<string> {
    const ext = path.extname(storagePath).toLowerCase();
    if (ext === ".pdf") return extractPdfText(buf);
    if (ext === ".docx") return extractDocxBodyText(Buffer.from(buf));
    if (IMAGE_EXTENSIONS.has(ext)) return describeImageWithVision(buf, IMAGE_MIME[ext]);
    // Plain text / markdown / unknown — best-effort decode.
    return Buffer.from(buf).toString("utf-8");
}

export type DocumentExtractResult = {
    text: string;
    tokenEstimate: number;
    fromCache: boolean;
};

/**
 * Resolve the cached extract for a document version, or extract, cache,
 * and return it. `storagePath` is passed in by the caller (already
 * resolved via documentVersions.loadActiveVersion) to avoid a redundant
 * lookup here.
 */
export async function getOrExtractDocumentText(
    db: Db,
    documentVersionId: string,
    storagePath: string,
): Promise<DocumentExtractResult> {
    const buf = await downloadFile(storagePath);
    if (!buf) {
        return { text: "", tokenEstimate: 0, fromCache: false };
    }
    const contentHash = hashBytes(buf);

    const { data: cached } = await db
        .from("document_extracts")
        .select("extracted_text, token_estimate")
        .eq("document_version_id", documentVersionId)
        .eq("content_hash", contentHash)
        .maybeSingle();
    if (cached?.extracted_text) {
        return {
            text: cached.extracted_text as string,
            tokenEstimate: (cached.token_estimate as number | null) ?? estimateTokens(cached.extracted_text as string),
            fromCache: true,
        };
    }

    const text = await extractRaw(buf, storagePath);
    const tokenEstimate = estimateTokens(text);
    await db
        .from("document_extracts")
        .upsert(
            {
                document_version_id: documentVersionId,
                content_hash: contentHash,
                extracted_text: text,
                token_estimate: tokenEstimate,
            },
            { onConflict: "document_version_id,content_hash" },
        );
    return { text, tokenEstimate, fromCache: false };
}
