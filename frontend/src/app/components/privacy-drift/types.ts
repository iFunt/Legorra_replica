// PrivacyDrift Analyzer types — mirror backend/migrations/001_privacy_drift.sql

export type ScanStatus =
    | "pending"
    | "discovering"
    | "scanning"
    | "analyzing"
    | "ready"
    | "error";

export interface PrivacyScan {
    id: string;
    user_id: string;
    project_id: string | null;
    domain: string;
    status: ScanStatus;
    error_message: string | null;
    privacy_policy_url: string | null;
    terms_url: string | null;
    cookie_banner_detected: boolean | null;
    scanned_at: string | null;
    created_at: string;
    updated_at: string;
}

export type ClauseType =
    | "TRACKING"
    | "SHARING"
    | "RETENTION"
    | "BIOMETRIC"
    | "CONSENT"
    | "SECURITY"
    | "OTHER";

export interface PolicyCommitment {
    id: string;
    scan_id: string;
    domain: string;
    clause_type: ClauseType;
    extracted_text: string;
    rule_key: string;
    machine_rule: boolean;
    source_url: string | null;
    created_at: string;
}

export type ConsentState = "ACCEPTED" | "REJECTED" | "NONE";
export type PayloadType = "COOKIE" | "PIXEL" | "API_POST" | "LOCAL_STORAGE" | "WEBSOCKET";

export interface TechnicalEvidence {
    id: string;
    scan_id: string;
    domain: string;
    consent_state: ConsentState;
    tracker_domain: string;
    tracker_owner: string | null;
    tracker_category: string;
    payload_type: PayloadType;
    data_transmitted: string | null;
    request_url: string | null;
    occurred_at: string;
    created_at: string;
}

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface DiscrepancyFlag {
    id: string;
    scan_id: string;
    domain: string;
    severity: Severity;
    regulatory_flags: string[];
    violation_summary: string;
    evidence_id: string | null;
    commitment_id: string | null;
    potential_claim_value: number | null;
    created_at: string;
}

export interface PrivacyScanDetail {
    scan: PrivacyScan;
    commitments: PolicyCommitment[];
    evidence: TechnicalEvidence[];
    flags: DiscrepancyFlag[];
}
