/**
 * Canonical vocabulary shared between the policy extractor (Phase 2) and the
 * discrepancy engine (Phase 3). Constraining the LLM to a fixed set of
 * `rule_key`s — rather than letting it invent free-text claims — is what
 * makes the Phase 3 comparison deterministic: each rule_key maps to the
 * tracker categories that would contradict it.
 */

import type { TrackerCategory } from "./trackerDatabase";

export type ClauseType =
    | "TRACKING"
    | "SHARING"
    | "RETENTION"
    | "BIOMETRIC"
    | "CONSENT"
    | "SECURITY"
    | "OTHER";

export interface RuleDefinition {
    rule_key: string;
    clause_type: ClauseType;
    /** Plain-English description shown to the LLM so it knows what to look for. */
    description: string;
    /** Tracker categories whose presence contradicts machine_rule === false. */
    contradictedByCategories: TrackerCategory[];
}

export const RULE_DEFINITIONS: RuleDefinition[] = [
    {
        rule_key: "allows_third_party_advertising",
        clause_type: "SHARING",
        description:
            "The site shares data with third-party advertising/retargeting networks (e.g. ad pixels, programmatic bidding).",
        contradictedByCategories: ["advertising"],
    },
    {
        rule_key: "sells_or_shares_personal_data",
        clause_type: "SHARING",
        description:
            "The company sells personal data, or shares it with third parties for the third party's own marketing/advertising purposes (the CCPA 'sale/share' concept).",
        contradictedByCategories: ["advertising", "data_broker"],
    },
    {
        rule_key: "allows_analytics_tracking",
        clause_type: "TRACKING",
        description:
            "The site uses third-party analytics tools that track visitor behaviour (e.g. Google Analytics, Mixpanel).",
        contradictedByCategories: ["analytics"],
    },
    {
        rule_key: "allows_session_recording",
        clause_type: "TRACKING",
        description:
            "The site records or replays user sessions (mouse movement, keystrokes, screen content) via tools like Hotjar or FullStory.",
        contradictedByCategories: ["session_replay"],
    },
    {
        rule_key: "allows_device_fingerprinting",
        clause_type: "TRACKING",
        description:
            "The site fingerprints devices/browsers for identification without cookies.",
        contradictedByCategories: ["fingerprinting"],
    },
    {
        rule_key: "allows_data_broker_transfer",
        clause_type: "SHARING",
        description:
            "Personal data is transferred to data brokers or identity-resolution vendors (e.g. LiveRamp, Acxiom).",
        contradictedByCategories: ["data_broker"],
    },
    {
        rule_key: "allows_biometric_processing",
        clause_type: "BIOMETRIC",
        description:
            "The company collects or processes biometric identifiers (face, fingerprint, voice).",
        contradictedByCategories: [],
    },
    {
        rule_key: "tracks_before_consent",
        clause_type: "CONSENT",
        description:
            "Non-essential tracking only occurs after the user has given affirmative consent via the cookie banner (i.e. the site claims it will NOT track before consent).",
        contradictedByCategories: [
            "advertising",
            "analytics",
            "session_replay",
            "fingerprinting",
            "data_broker",
            "customer_data_platform",
        ],
    },
    {
        rule_key: "retains_data_indefinitely",
        clause_type: "RETENTION",
        description:
            "The company retains personal data indefinitely / has no defined deletion period (not verifiable by network scan; extract only from policy text).",
        contradictedByCategories: [],
    },
];

export const RULE_KEYS = RULE_DEFINITIONS.map((r) => r.rule_key);

export function ruleByKey(key: string): RuleDefinition | undefined {
    return RULE_DEFINITIONS.find((r) => r.rule_key === key);
}
