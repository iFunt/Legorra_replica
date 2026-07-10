// Estimates a claim's compensation value by combining the customer's own
// account, any evidence documents (already-cached extracts — see
// documentExtract.ts), the company research report, and retrieved GDPR
// knowledge-base precedents (kbRetrieval.ts) into one structured LLM call.
import { completeText } from "../llm";
import { CLAIM_DRAFTER_MODEL } from "../llm/models";
import type { KbEntry } from "./kbRetrieval";
import { formatKbForPrompt } from "./kbRetrieval";
import type { ClaimValuation } from "./types";
import type { CompanyResearchResult } from "./companyResearch";

// Caps how much raw document text enters the prompt per document, keeping
// the valuation call cheap even for large DSAR bundles — the full text
// remains available (cached) for the drafting/judge stages that need it.
const MAX_CHARS_PER_DOC = 8000;

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n[...truncated, ${text.length - max} more characters...]`;
}

function parseJsonLoose<T>(raw: string): T | null {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : raw;
    try {
        return JSON.parse(candidate.trim()) as T;
    } catch {
        return null;
    }
}

export async function valuateClaim(params: {
    companyName: string;
    issueSummary: string;
    research: CompanyResearchResult | null;
    documentExtracts: { filename: string; text: string }[];
    kbEntries: KbEntry[];
}): Promise<ClaimValuation> {
    const { companyName, issueSummary, research, documentExtracts, kbEntries } = params;

    const evidenceBlock = documentExtracts.length
        ? documentExtracts
              .map((d) => `### ${d.filename}\n${truncate(d.text, MAX_CHARS_PER_DOC)}`)
              .join("\n\n")
        : "No evidence documents were provided.";

    const researchBlock = research
        ? [
              research.privacy_policy_summary
                  ? `Privacy policy summary: ${research.privacy_policy_summary}`
                  : null,
              research.ico_fines.length
                  ? `Prior ICO fines against this company: ${JSON.stringify(research.ico_fines)}`
                  : "No prior ICO fines found for this company.",
              research.ico_enforcement_notices.length
                  ? `Prior ICO enforcement notices: ${JSON.stringify(research.ico_enforcement_notices)}`
                  : null,
          ]
              .filter(Boolean)
              .join("\n")
        : "No company research available.";

    const prompt = [
        `Company: ${companyName}`,
        `Customer's account of the issue:\n${issueSummary}`,
        `Company research:\n${researchBlock}`,
        `Evidence documents:\n${evidenceBlock}`,
        `Relevant GDPR knowledge-base precedents (for calibrating a realistic range — cite the ones you actually rely on):\n${formatKbForPrompt(kbEntries)}`,
        "",
        "Estimate a realistic compensation range for this UK GDPR/Data Protection Act 2018 " +
            "Art. 82 non-material-damage (distress) claim, calibrated against the precedents " +
            "above. Be conservative where the evidence is thin or the incident is low-severity " +
            "(see the de-minimis guidance precedent) — do not inflate the estimate. " +
            "Return ONLY a JSON object of this exact shape:\n" +
            "{\n" +
            '  "low": number,       // lower bound, GBP\n' +
            '  "high": number,      // upper bound, GBP\n' +
            '  "currency": "GBP",\n' +
            '  "basis": string,     // 3-6 sentences explaining the reasoning, referencing specific evidence and precedents\n' +
            '  "comparable_cases": [{ "title": string, "citation": string | null, "relevance": string }]\n' +
            "}",
    ].join("\n\n");

    const raw = await completeText({
        model: CLAIM_DRAFTER_MODEL,
        systemPrompt:
            "You are a UK GDPR claims valuation assistant. Ground every figure in the " +
            "evidence and precedents provided; never invent facts about the customer's " +
            "situation. Output strict JSON only.",
        user: prompt,
        maxTokens: 1200,
    });

    const parsed = parseJsonLoose<ClaimValuation>(raw);
    if (parsed && typeof parsed.low === "number" && typeof parsed.high === "number") {
        return {
            low: parsed.low,
            high: parsed.high,
            currency: parsed.currency || "GBP",
            basis: parsed.basis || "",
            comparable_cases: Array.isArray(parsed.comparable_cases) ? parsed.comparable_cases : [],
        };
    }

    // Fall back to a clearly-flagged conservative placeholder rather than
    // blocking the pipeline on a malformed model response.
    return {
        low: 0,
        high: 0,
        currency: "GBP",
        basis:
            "Automatic valuation could not be computed from the model's response. " +
            "Manual review required.",
        comparable_cases: [],
    };
}
