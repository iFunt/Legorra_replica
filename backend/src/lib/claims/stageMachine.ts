// Stage machine for the GDPR claims pipeline. A "claim" moves through a
// fixed sequence of stages as the orchestrator (orchestrator.ts) runs; each
// transition is logged as a `claim_events` row so the frontend can render a
// live activity timeline and the pipeline can resume after an interruption
// (see orchestrator.ts for the checkpoint-and-resume logic).
import type { createServerSupabase } from "../supabase";
import type { ClaimEventType, ClaimStage } from "./types";

type Db = ReturnType<typeof createServerSupabase>;

// Linear "happy path" order. `on_hold` is reachable from any stage (user
// pauses a claim) and is not part of the forward sequence.
export const STAGE_ORDER: ClaimStage[] = [
    "acknowledged",
    "researching",
    "research_complete",
    "valuation",
    "pre_action_drafting",
    "internal_review",
    "ready_to_send",
    "sent",
    "resolved",
];

export const STAGE_LABELS: Record<ClaimStage, string> = {
    acknowledged: "Acknowledged",
    researching: "Researching company",
    research_complete: "Research complete",
    valuation: "Estimating claim value",
    pre_action_drafting: "Drafting pre-action letter",
    internal_review: "Internal review (auto-tested)",
    ready_to_send: "Ready to send",
    sent: "Sent — awaiting response",
    resolved: "Resolved",
    on_hold: "On hold",
};

export function nextStage(stage: ClaimStage): ClaimStage | null {
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
    return STAGE_ORDER[idx + 1];
}

/** Append a timeline/checkpoint event for a claim. */
export async function logClaimEvent(
    db: Db,
    claimId: string,
    type: ClaimEventType,
    payload: Record<string, unknown> = {},
): Promise<void> {
    await db.from("claim_events").insert({ claim_id: claimId, type, payload });
}

/** Move a claim to a new stage and log the transition. */
export async function setClaimStage(
    db: Db,
    claimId: string,
    stage: ClaimStage,
    note?: string,
): Promise<void> {
    await db
        .from("claims")
        .update({ stage, updated_at: new Date().toISOString() })
        .eq("id", claimId);
    await logClaimEvent(db, claimId, "stage_change", { stage, note });
}
