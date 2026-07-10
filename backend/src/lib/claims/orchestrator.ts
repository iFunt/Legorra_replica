// Drives a claim through its full automated pipeline: research → valuation
// → iterative drafting/judging → internal review. Each step is
// checkpointed to `claim_events` (via stageMachine.setClaimStage /
// logClaimEvent) as it completes, so an interrupted SSE connection
// (routes/claims.ts) doesn't lose progress — the claim's `stage` column
// always reflects the last completed step, and re-running the pipeline
// picks up cleanly because each step just overwrites/appends its own row.
import type { createServerSupabase } from "../supabase";
import { loadActiveVersion } from "../documentVersions";
import { getOrExtractDocumentText } from "./documentExtract";
import { researchCompany, type CompanyResearchResult } from "./companyResearch";
import { valuateClaim } from "./claimValuation";
import { searchKb } from "./kbRetrieval";
import { runDraftLoop, type DraftLoopResult } from "./draftLoop";
import { logClaimEvent, setClaimStage } from "./stageMachine";
import type { ClaimRow, ClaimStage, ClaimValuation } from "./types";

type Db = ReturnType<typeof createServerSupabase>;

export type OrchestratorProgress = {
    stage: ClaimStage;
    message: string;
    data?: Record<string, unknown>;
};

async function loadDocumentExtracts(
    db: Db,
    claimId: string,
): Promise<{ filename: string; text: string }[]> {
    const { data: docs } = await db
        .from("documents")
        .select("id, filename, current_version_id")
        .eq("claim_id", claimId);

    const extracts: { filename: string; text: string }[] = [];
    for (const doc of (docs ?? []) as {
        id: string;
        filename: string;
        current_version_id: string | null;
    }[]) {
        if (!doc.current_version_id) continue;
        const version = await loadActiveVersion(doc.id, db, doc.current_version_id);
        if (!version) continue;
        const { text } = await getOrExtractDocumentText(db, version.id, version.storage_path);
        if (text) extracts.push({ filename: doc.filename, text });
    }
    return extracts;
}

export async function runClaimPipeline(
    db: Db,
    claimId: string,
    onProgress: (p: OrchestratorProgress) => void,
): Promise<void> {
    const { data: claim } = await db
        .from("claims")
        .select("*")
        .eq("id", claimId)
        .single();
    if (!claim) throw new Error("Claim not found");
    const claimRow = claim as ClaimRow;

    try {
        // ---- Research -------------------------------------------------
        await setClaimStage(db, claimId, "researching");
        onProgress({ stage: "researching", message: `Researching ${claimRow.company_name}...` });

        const research: CompanyResearchResult = await researchCompany(claimRow.company_name);
        await db.from("claim_research").insert({
            claim_id: claimId,
            registered_office: research.registered_office,
            sic_codes: research.sic_codes,
            directors_summary: research.directors_summary,
            privacy_policy_url: research.privacy_policy_url,
            privacy_policy_summary: research.privacy_policy_summary,
            ico_fines: research.ico_fines,
            ico_enforcement_notices: research.ico_enforcement_notices,
            sources: research.sources,
        });
        await logClaimEvent(db, claimId, "research_run", {
            degraded_notes: research.degradedNotes,
            sources_found: research.sources.length,
        });
        await setClaimStage(db, claimId, "research_complete");
        onProgress({
            stage: "research_complete",
            message:
                research.degradedNotes.length > 0
                    ? "Research complete (some lookups were best-effort — see notes)."
                    : "Research complete.",
            data: { research },
        });

        const documentExtracts = await loadDocumentExtracts(db, claimId);

        // ---- Valuation --------------------------------------------------
        await setClaimStage(db, claimId, "valuation");
        onProgress({ stage: "valuation", message: "Estimating claim value..." });

        const kbEntries = await searchKb(
            db,
            `${claimRow.issue_summary} ${claimRow.company_name}`,
            { limit: 8 },
        );
        const valuation: ClaimValuation = await valuateClaim({
            companyName: claimRow.company_name,
            issueSummary: claimRow.issue_summary,
            research,
            documentExtracts,
            kbEntries,
        });
        await db
            .from("claims")
            .update({
                claim_value_low: valuation.low,
                claim_value_high: valuation.high,
                claim_value_currency: valuation.currency,
            })
            .eq("id", claimId);
        await logClaimEvent(db, claimId, "system_note", { type: "valuation", valuation });
        onProgress({ stage: "valuation", message: "Valuation complete.", data: { valuation } });

        // ---- Drafting + judging ------------------------------------------
        await setClaimStage(db, claimId, "pre_action_drafting");
        onProgress({
            stage: "pre_action_drafting",
            message: "Drafting the letter before action...",
        });

        const draftResult: DraftLoopResult = await runDraftLoop(
            db,
            claimId,
            "letter_before_action",
            {
                companyName: claimRow.company_name,
                issueSummary: claimRow.issue_summary,
                research,
                valuation,
                documentExtracts,
                kbEntries,
            },
        );
        await db
            .from("claims")
            .update({ confidence_score: draftResult.finalScore })
            .eq("id", claimId);

        // ---- Internal review -------------------------------------------
        await setClaimStage(db, claimId, "internal_review");
        onProgress({
            stage: "internal_review",
            message: draftResult.reachedThreshold
                ? `Draft passed internal review at ${draftResult.finalScore}/100 confidence after ${draftResult.iterations} iteration(s) — ready for your review.`
                : `Draft reached ${draftResult.finalScore}/100 after the maximum ${draftResult.iterations} iterations without hitting the 95% threshold — flagged for manual attention.`,
            data: { draftResult },
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logClaimEvent(db, claimId, "error", { message });
        await setClaimStage(db, claimId, "on_hold", `Pipeline error: ${message}`);
        onProgress({ stage: "on_hold", message: `Pipeline error: ${message}` });
        throw err;
    }
}
