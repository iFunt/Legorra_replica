/**
 * Phase 1 (Technical Scanner) — the "actual" half of a scan.
 *
 * Drives a headless browser through a normal visit to the target site under
 * three consent states (PRD requirement): a user who ignores the cookie
 * banner (NONE), one who explicitly rejects it (REJECTED), and one who
 * accepts it (ACCEPTED). Every request the page makes is checked against
 * the tracker database; matches become Technical Evidence rows.
 *
 * This only observes what the site sends to a normal visitor's browser —
 * the same requests any visitor's browser would make. It does not bypass
 * authentication, rate limits, or any access control.
 */

import { chromium, type Page, type Request } from "playwright";
import { lookupTracker, type TrackerCategory } from "./trackerDatabase";

export type ConsentState = "ACCEPTED" | "REJECTED" | "NONE";
export type PayloadType = "COOKIE" | "PIXEL" | "API_POST" | "LOCAL_STORAGE" | "WEBSOCKET";

export interface ScanEvidenceItem {
    consent_state: ConsentState;
    tracker_domain: string;
    tracker_owner: string;
    tracker_category: TrackerCategory;
    payload_type: PayloadType;
    data_transmitted: string;
    request_url: string;
}

const NAV_TIMEOUT_MS = 30000;
const SETTLE_MS = 4000;

const ACCEPT_SELECTORS = [
    "#onetrust-accept-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    ".qc-cmp2-summary-buttons button[mode='primary']",
    "#truste-consent-button",
    "button#accept-recommended-btn-handler",
    "[data-testid='accept-all']",
    "[data-cookiebanner='accept_button']",
    "#hs-eu-confirmation-button",
];
const REJECT_SELECTORS = [
    "#onetrust-reject-all-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
    "#CybotCookiebotDialogBodyButtonDecline",
    ".qc-cmp2-summary-buttons button[mode='secondary']",
    "#truste-consent-required",
    "[data-testid='reject-all']",
    "[data-cookiebanner='decline_button']",
    "#hs-eu-decline-button",
];
const ACCEPT_TEXT =
    /^(accept all( cookies)?|allow all( cookies)?|i accept|agree|accept cookies|allow cookies|allow all)$/i;
const REJECT_TEXT =
    /^(reject all|decline all|necessary only|reject|decline|only necessary|use necessary cookies only|reject non-essential)$/i;

async function clickFirstMatch(page: Page, selectors: string[], textRe: RegExp): Promise<boolean> {
    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
                await el.click({ timeout: 2000 });
                return true;
            }
        } catch {
            // try the next selector
        }
    }
    try {
        const buttons = page.locator("button, a[role='button'], [role='button'], input[type='button']");
        const count = await buttons.count();
        for (let i = 0; i < Math.min(count, 80); i++) {
            const el = buttons.nth(i);
            const text = ((await el.innerText().catch(() => "")) || "").trim();
            if (textRe.test(text) && (await el.isVisible().catch(() => false))) {
                await el.click({ timeout: 2000 }).catch(() => {});
                return true;
            }
        }
    } catch {
        // give up silently — evidence will just reflect "banner not resolved"
    }
    return false;
}

/** Best-effort, non-invasive categorization of what a tracking request's
 * query params look like they're carrying — by parameter *name*, never by
 * reading/storing the actual values, so we don't persist raw PII. */
function categorizeParams(url: URL): string {
    const keys = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    const has = (...names: string[]) => names.some((n) => keys.some((k) => k.includes(n)));
    const bits: string[] = [];
    if (has("email", "em", "hashed_email", "hem")) bits.push("email (possibly hashed)");
    if (has("uid", "user_id", "external_id", "client_id", "cid", "visitor_id"))
        bits.push("user/client identifier");
    if (has("fbp", "fbc")) bits.push("Facebook browser/click ID");
    if (has("gclid", "_ga", "ga_")) bits.push("Google Analytics/Ads client ID");
    if (has("ip", "ip_address")) bits.push("IP address");
    if (has("referrer", "referer", "dl", "page", "url")) bits.push("page URL / referrer");
    if (has("ua", "user_agent", "screen", "sr", "vp")) bits.push("user agent / device fingerprint");
    if (bits.length === 0) bits.push("query parameters (page context / identifiers)");
    return bits.join(", ");
}

async function collectFromLoad(rootUrl: string, state: ConsentState): Promise<ScanEvidenceItem[]> {
    const evidence: ScanEvidenceItem[] = [];
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    const browser = await chromium.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
        const context = await browser.newContext({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });
        const page = await context.newPage();
        const seen = new Set<string>();

        page.on("request", (req: Request) => {
            try {
                const url = new URL(req.url());
                const tracker = lookupTracker(url.hostname);
                if (!tracker) return;
                const key = `${tracker.domain}|${req.method()}|${url.pathname}`;
                if (seen.has(key)) return;
                seen.add(key);
                evidence.push({
                    consent_state: state,
                    tracker_domain: tracker.domain,
                    tracker_owner: tracker.owner,
                    tracker_category: tracker.category,
                    payload_type: req.method() === "POST" ? "API_POST" : "PIXEL",
                    data_transmitted: categorizeParams(url),
                    request_url: `${url.origin}${url.pathname}`,
                });
            } catch {
                // malformed/opaque request URL — skip
            }
        });

        await page.goto(rootUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => {});
        await page.waitForTimeout(1500);

        if (state === "ACCEPTED") await clickFirstMatch(page, ACCEPT_SELECTORS, ACCEPT_TEXT);
        else if (state === "REJECTED") await clickFirstMatch(page, REJECT_SELECTORS, REJECT_TEXT);
        // NONE: banner (if any) is left untouched, simulating an ignoring visitor.

        await page.waitForTimeout(SETTLE_MS);

        const cookies = await context.cookies();
        for (const c of cookies) {
            const tracker = lookupTracker(c.domain);
            if (!tracker) continue;
            const key = `cookie|${tracker.domain}|${c.name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            evidence.push({
                consent_state: state,
                tracker_domain: tracker.domain,
                tracker_owner: tracker.owner,
                tracker_category: tracker.category,
                payload_type: "COOKIE",
                data_transmitted: `cookie "${c.name}" (${c.httpOnly ? "httpOnly" : "script-readable"}, expires ${
                    c.expires && c.expires > 0 ? new Date(c.expires * 1000).toISOString().slice(0, 10) : "session"
                })`,
                request_url: c.domain,
            });
        }

        await context.close();
    } finally {
        await browser.close();
    }
    return evidence;
}

/** Run the scan for all three consent states sequentially (isolated browser
 * contexts, so accepting in one run can't contaminate the "reject" run). */
export async function runFullScan(rootUrl: string): Promise<ScanEvidenceItem[]> {
    const states: ConsentState[] = ["NONE", "REJECTED", "ACCEPTED"];
    const results: ScanEvidenceItem[] = [];
    for (const state of states) {
        const items = await collectFromLoad(rootUrl, state);
        results.push(...items);
    }
    return results;
}

export { collectFromLoad as scanConsentState };
