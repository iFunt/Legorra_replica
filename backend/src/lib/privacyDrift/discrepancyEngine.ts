/**
 * Phase 3 (Discrepancy Comparator) — deterministic logic only, no LLM calls.
 * Cross-references Technical Evidence against Policy Commitments (and,
 * independently, against consent state itself) to produce Discrepancy Flags.
 *
 * Two independent checks, matching the PRD's worked example plus the
 * consent-timing rule that is the most common real-world GDPR/PECR breach:
 *
 *  1. Pre-consent tracking: any non-essential tracker firing before the
 *     user has affirmatively accepted (i.e. during NONE or REJECTED) is a
 *     breach of the consent-first requirement in its own right, regardless
 *     of what the privacy policy says.
 *  2. Commitment contradiction: the policy explicitly claims a practice
 *     does NOT happen (machine_rule === false) but evidence of that exact
 *     category of practice was captured at any consent state.
 */

import { ruleByKey } from "./rules";
import type { TrackerCategory } from "./trackerDatabase";

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface PolicyCommitmentRow {
    id: string;
    domain: string;
    clause_type: string;
    extracted_text: string;
    rule_key: string;
    machine_rule: boolean;
    source_url: string | null;
}

export interface TechnicalEvidenceRow {
    id: string;
    domain: string;
    consent_state: "ACCEPTED" | "REJECTED" | "NONE";
    tracker_domain: string;
    tracker_owner: string | null;
    tracker_category: TrackerCategory;
    payload_type: string;
    data_transmitted: string | null;
    request_url: string | null;
}

export interface DiscrepancyFlagInsert {
    domain: string;
    severity: Severity;
    regulatory_flags: string[];
    violation_summary: string;
    evidence_id: string | null;
    commitment_id: string | null;
    potential_claim_value: number;
}

// Categories that are infrastructure for the consent mechanism itself (or
// the site's own domain) and never trigger a pre-consent flag on their own.
const NON_FLAGGABLE_CATEGORIES: TrackerCategory[] = ["essential", "tag_manager"];

const CLAIM_VALUE_BY_SEVERITY: Record<Severity, number> = {
    HIGH: 750,
    MEDIUM: 350,
    LOW: 100,
};

function summarizeTrackers(items: TechnicalEvidenceRow[]): string {
    const byTracker = new Map<string, number>();
    for (const e of items) byTracker.set(e.tracker_domain, (byTracker.get(e.tracker_domain) ?? 0) + 1);
    return [...byTracker.entries()].map(([d, n]) => (n > 1 ? `${d} (×${n})` : d)).join(", ");
}

export function buildDiscrepancyFlags(
    domain: string,
    commitments: PolicyCommitmentRow[],
    evidence: TechnicalEvidenceRow[],
): DiscrepancyFlagInsert[] {
    const flags: DiscrepancyFlagInsert[] = [];

    // --- Check 1: pre-consent tracking -------------------------------------
    const preConsent = evidence.filter(
        (e) =>
            (e.consent_state === "NONE" || e.consent_state === "REJECTED") &&
            !NON_FLAGGABLE_CATEGORIES.includes(e.tracker_category),
    );
    const preConsentGroups = new Map<string, TechnicalEvidenceRow[]>();
    for (const e of preConsent) {
        const key = `${e.consent_state}|${e.tracker_domain}`;
        const arr = preConsentGroups.get(key) ?? [];
        arr.push(e);
        preConsentGroups.set(key, arr);
    }
    for (const [, items] of preConsentGroups) {
        const rep = items[0];
        const stateLabel = rep.consent_state === "REJECTED" ? "after the user rejected cookies" : "before any consent choice was made";
        flags.push({
            domain,
            severity: "HIGH",
            regulatory_flags:
                rep.consent_state === "REJECTED"
                    ? ["PECR_REG6", "GDPR_ART6_NO_LAWFUL_BASIS", "GDPR_ART7_CONSENT_WITHDRAWN_IGNORED"]
                    : ["PECR_REG6", "GDPR_ART6_NO_LAWFUL_BASIS"],
            violation_summary: `${rep.tracker_owner ?? rep.tracker_domain} (${rep.tracker_category}) was contacted ${stateLabel}: ${summarizeTrackers(
                items,
            )}.`,
            evidence_id: rep.id,
            commitment_id: null,
            potential_claim_value: CLAIM_VALUE_BY_SEVERITY.HIGH,
        });
    }

    // --- Check 2: commitment contradiction ----------------------------------
    const falseCommitments = commitments.filter((c) => c.machine_rule === false);
    for (const commitment of falseCommitments) {
        const def = ruleByKey(commitment.rule_key);
        if (!def || def.contradictedByCategories.length === 0) continue;
        const contradicting = evidence.filter((e) => def.contradictedByCategories.includes(e.tracker_category));
        if (contradicting.length === 0) continue;

        const byTracker = new Map<string, TechnicalEvidenceRow[]>();
        for (const e of contradicting) {
            const arr = byTracker.get(e.tracker_domain) ?? [];
            arr.push(e);
            byTracker.set(e.tracker_domain, arr);
        }
        for (const [, items] of byTracker) {
            const rep = items[0];
            const states = [...new Set(items.map((i) => i.consent_state))].join("/");
            flags.push({
                domain,
                severity: "HIGH",
                regulatory_flags:
                    commitment.rule_key === "sells_or_shares_personal_data"
                        ? ["CCPA_UNAUTHORIZED_SALE", "GDPR_ART5_TRANSPARENCY", "UK_GDPR_ART82_DISTRESS"]
                        : ["GDPR_ART5_TRANSPARENCY", "UK_GDPR_ART82_DISTRESS", "UNFAIR_COMMERCIAL_PRACTICES"],
                violation_summary: `Policy states "${commitment.extracted_text}" — but ${rep.tracker_owner ?? rep.tracker_domain} (${rep.tracker_category}) was observed (consent state: ${states}), directly contradicting this commitment.`,
                evidence_id: rep.id,
                commitment_id: commitment.id,
                potential_claim_value: 900,
            });
        }
    }

    return flags;
}
