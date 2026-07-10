// Shared types for the GDPR claims pipeline (backend/src/lib/claims/*).

export type ClaimStage =
    | "acknowledged"
    | "researching"
    | "research_complete"
    | "valuation"
    | "pre_action_drafting"
    | "internal_review"
    | "ready_to_send"
    | "sent"
    | "resolved"
    | "on_hold";

export type ClaimEventType =
    | "stage_change"
    | "research_run"
    | "draft_iteration"
    | "judge_score"
    | "system_note"
    | "user_action"
    | "error";

export type ClaimRow = {
    id: string;
    user_id: string;
    project_id: string | null;
    company_name: string;
    company_number: string | null;
    issue_summary: string;
    stage: ClaimStage;
    claim_value_low: number | null;
    claim_value_high: number | null;
    claim_value_currency: string;
    confidence_score: number | null;
    shared_with: string[] | null;
    created_at: string;
    updated_at: string;
};

export type ClaimResearch = {
    id: string;
    claim_id: string;
    registered_office: Record<string, unknown> | null;
    sic_codes: string[] | null;
    directors_summary: string | null;
    privacy_policy_url: string | null;
    privacy_policy_summary: string | null;
    ico_fines: IcoFinding[];
    ico_enforcement_notices: IcoFinding[];
    sources: SourceRef[];
    raw_model_output: Record<string, unknown> | null;
};

export type IcoFinding = {
    date?: string;
    amount?: string;
    notice_url?: string;
    summary: string;
};

export type SourceRef = {
    label: string;
    url?: string;
};

export type ClaimValuation = {
    low: number;
    high: number;
    currency: string;
    basis: string;
    comparable_cases: { title: string; citation?: string; relevance: string }[];
};

export type DraftKind =
    | "dsar_followup"
    | "letter_before_action"
    | "particulars_of_claim";

export type JudgeFeedback = {
    score: number;
    rubric: { criterion: string; score: number; note: string }[];
    required_fixes: string[];
    summary: string;
};

export type ClaimDraft = {
    id: string;
    claim_id: string;
    kind: DraftKind;
    version: number;
    content: string;
    judge_score: number | null;
    judge_feedback: JudgeFeedback | null;
    status: "drafting" | "reviewed" | "approved" | "sent";
};
