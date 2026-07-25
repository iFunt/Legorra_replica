/**
 * Phase 1 (Policy Ingestion Engine) — the "stated" half of a scan.
 *
 * 1. discoverPolicyUrls: fetch the homepage, follow footer/nav links that
 *    look like a privacy policy or terms page, falling back to common paths.
 * 2. fetchPolicyText: pull the readable text out of whatever we found.
 * 3. extractCommitments: ask the LLM to convert that text into the
 *    machine-readable Policy Commitment schema, constrained to the fixed
 *    rule_key vocabulary in rules.ts so Phase 3 can compare deterministically.
 */

import { completeText } from "../llm";
import type { UserApiKeys } from "../llm";
import { extractLinks, htmlToText } from "./htmlText";
import { RULE_DEFINITIONS, type ClauseType } from "./rules";

const UA =
    "Mozilla/5.0 (compatible; PrivacyDriftAnalyzer/1.0; +https://github.com/) — automated compliance scan";

const PRIVACY_KEYWORDS = ["privacy", "data protection", "your data", "gdpr"];
const TERMS_KEYWORDS = ["terms of service", "terms of use", "terms & conditions", "terms and conditions"];

const COMMON_PRIVACY_PATHS = [
    "/privacy",
    "/privacy-policy",
    "/privacy-notice",
    "/legal/privacy",
    "/legal/privacy-policy",
    "/en/privacy",
    "/about/privacy",
    "/policies/privacy",
];
const COMMON_TERMS_PATHS = ["/terms", "/terms-of-service", "/terms-of-use", "/legal/terms", "/tos"];

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
            redirect: "follow",
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("html") && !contentType.includes("text")) return null;
        return await res.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function urlResolves(url: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, {
            method: "GET",
            headers: { "User-Agent": UA },
            redirect: "follow",
            signal: controller.signal,
        });
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}

function scoreLink(link: { href: string; text: string }, keywords: string[]): number {
    const hay = `${link.href.toLowerCase()} ${link.text.toLowerCase()}`;
    let score = 0;
    for (const kw of keywords) if (hay.includes(kw)) score += kw.length > 6 ? 2 : 1;
    return score;
}

export interface DiscoveredPolicy {
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    cookieBannerDetected: boolean;
}

/** Auto-discover the privacy policy + terms URLs for a root domain. */
export async function discoverPolicyUrls(domain: string): Promise<DiscoveredPolicy> {
    const rootUrl = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
    const html = await fetchText(rootUrl);

    let privacyPolicyUrl: string | null = null;
    let termsUrl: string | null = null;
    let cookieBannerDetected = false;

    if (html) {
        cookieBannerDetected = /cookiebot|onetrust|cookielaw\.org|trustarc|cookie[- ]?consent|cookie[- ]?banner|accept.{0,20}cookies/i.test(
            html,
        );
        const links = extractLinks(html, rootUrl);
        const privacyCandidates = links
            .map((l) => ({ link: l, score: scoreLink(l, PRIVACY_KEYWORDS) }))
            .filter((c) => c.score > 0)
            .sort((a, b) => b.score - a.score);
        const termsCandidates = links
            .map((l) => ({ link: l, score: scoreLink(l, TERMS_KEYWORDS) }))
            .filter((c) => c.score > 0)
            .sort((a, b) => b.score - a.score);
        privacyPolicyUrl = privacyCandidates[0]?.link.href ?? null;
        termsUrl = termsCandidates[0]?.link.href ?? null;
    }

    if (!privacyPolicyUrl) {
        for (const path of COMMON_PRIVACY_PATHS) {
            const candidate = new URL(path, rootUrl).toString();
            if (await urlResolves(candidate)) {
                privacyPolicyUrl = candidate;
                break;
            }
        }
    }
    if (!termsUrl) {
        for (const path of COMMON_TERMS_PATHS) {
            const candidate = new URL(path, rootUrl).toString();
            if (await urlResolves(candidate)) {
                termsUrl = candidate;
                break;
            }
        }
    }

    return { privacyPolicyUrl, termsUrl, cookieBannerDetected };
}

const MAX_POLICY_CHARS = 24000;

/** Fetch a policy page and return its readable text, truncated for the LLM. */
export async function fetchPolicyText(url: string): Promise<string | null> {
    const html = await fetchText(url, 20000);
    if (!html) return null;
    const text = htmlToText(html);
    if (text.length < 200) return null; // likely a JS-rendered shell we can't read statically
    return text.slice(0, MAX_POLICY_CHARS);
}

export interface ExtractedCommitment {
    clause_type: ClauseType;
    extracted_text: string;
    rule_key: string;
    machine_rule: boolean;
}

const SYSTEM_PROMPT = `You are a privacy-law compliance analyst. You convert privacy policy text into a strict JSON array of machine-readable commitments.

For each rule below, read the policy text and decide what the company claims. Only include a rule in your output if the policy text actually addresses it (silence is not a commitment — omit rules the policy doesn't mention).

Rules (rule_key — description):
${RULE_DEFINITIONS.map((r) => `- ${r.rule_key} (${r.clause_type}) — ${r.description}`).join("\n")}

For each rule you find addressed in the text, output an object:
{
  "rule_key": one of the rule_key values above,
  "clause_type": the matching clause_type,
  "machine_rule": true if the policy says this practice DOES happen / IS allowed, false if the policy says it does NOT happen / is NOT allowed,
  "extracted_text": the exact quoted sentence(s) from the policy that support this (verbatim, no paraphrasing, max ~300 characters)
}

Return ONLY a JSON array of these objects, nothing else. If no rules are addressed, return [].`;

export async function extractCommitments(params: {
    policyText: string;
    model: string;
    apiKeys?: UserApiKeys;
}): Promise<ExtractedCommitment[]> {
    const raw = await completeText({
        model: params.model,
        systemPrompt: SYSTEM_PROMPT,
        user: `Privacy policy text:\n\n${params.policyText}`,
        maxTokens: 4096,
        apiKeys: params.apiKeys,
    });

    const cleaned = raw
        .replace(/^```(?:json)?\n?/i, "")
        .replace(/\n?```$/, "")
        .trim();

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (!match) return [];
        try {
            parsed = JSON.parse(match[0]);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(parsed)) return [];

    const validKeys = new Set(RULE_DEFINITIONS.map((r) => r.rule_key));
    const out: ExtractedCommitment[] = [];
    for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const rule_key = typeof obj.rule_key === "string" ? obj.rule_key : "";
        const def = RULE_DEFINITIONS.find((r) => r.rule_key === rule_key);
        if (!def || !validKeys.has(rule_key)) continue;
        if (typeof obj.machine_rule !== "boolean") continue;
        const extracted_text =
            typeof obj.extracted_text === "string" ? obj.extracted_text.slice(0, 500).trim() : "";
        if (!extracted_text) continue;
        out.push({
            rule_key,
            clause_type: def.clause_type,
            machine_rule: obj.machine_rule,
            extracted_text,
        });
    }
    return out;
}
