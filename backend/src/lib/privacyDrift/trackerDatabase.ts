/**
 * Static tracker/ad-tech domain registry, modeled on the public data sets
 * the PRD calls out (EasyList, DuckDuckGo Tracker Radar). Ships as a
 * bundled snapshot rather than a live fetch so scans stay deterministic and
 * don't depend on a third-party list server being reachable at scan time.
 *
 * Each entry maps a request host (or suffix) to the company that owns it
 * and a rough purpose category, which the discrepancy engine uses to decide
 * whether a request contradicts a "no sharing with advertisers" style
 * policy commitment.
 */

export type TrackerCategory =
    | "advertising"
    | "analytics"
    | "social"
    | "session_replay"
    | "fingerprinting"
    | "data_broker"
    | "tag_manager"
    | "customer_data_platform"
    | "essential";

export interface TrackerEntry {
    domain: string;
    owner: string;
    category: TrackerCategory;
    /** True if this vendor is a known first-party-marketing / ad-retargeting sink. */
    marketing: boolean;
}

// Bundled snapshot — not exhaustive, but covers the vendors that show up on
// the overwhelming majority of commercial sites. Matched by suffix, so
// "connect.facebook.net" also matches "sub.connect.facebook.net".
export const TRACKER_DATABASE: TrackerEntry[] = [
    // --- Advertising / retargeting ---------------------------------------
    { domain: "doubleclick.net", owner: "Google (DoubleClick)", category: "advertising", marketing: true },
    { domain: "googlesyndication.com", owner: "Google Ads", category: "advertising", marketing: true },
    { domain: "googleadservices.com", owner: "Google Ads", category: "advertising", marketing: true },
    { domain: "google-analytics.com", owner: "Google Analytics", category: "analytics", marketing: false },
    { domain: "googletagmanager.com", owner: "Google Tag Manager", category: "tag_manager", marketing: false },
    { domain: "googletagservices.com", owner: "Google Ads", category: "advertising", marketing: true },
    { domain: "connect.facebook.net", owner: "Meta (Facebook Pixel)", category: "advertising", marketing: true },
    { domain: "facebook.com/tr", owner: "Meta (Facebook Pixel)", category: "advertising", marketing: true },
    { domain: "ads.linkedin.com", owner: "LinkedIn Ads", category: "advertising", marketing: true },
    { domain: "px.ads.linkedin.com", owner: "LinkedIn Insight Tag", category: "advertising", marketing: true },
    { domain: "snap.licdn.com", owner: "LinkedIn Insight Tag", category: "advertising", marketing: true },
    { domain: "analytics.twitter.com", owner: "X / Twitter Ads", category: "advertising", marketing: true },
    { domain: "static.ads-twitter.com", owner: "X / Twitter Ads", category: "advertising", marketing: true },
    { domain: "t.co", owner: "X / Twitter", category: "advertising", marketing: true },
    { domain: "bat.bing.com", owner: "Microsoft Advertising (UET)", category: "advertising", marketing: true },
    { domain: "adnxs.com", owner: "Xandr / AppNexus", category: "advertising", marketing: true },
    { domain: "criteo.com", owner: "Criteo", category: "advertising", marketing: true },
    { domain: "criteo.net", owner: "Criteo", category: "advertising", marketing: true },
    { domain: "taboola.com", owner: "Taboola", category: "advertising", marketing: true },
    { domain: "outbrain.com", owner: "Outbrain", category: "advertising", marketing: true },
    { domain: "pubmatic.com", owner: "PubMatic", category: "advertising", marketing: true },
    { domain: "rubiconproject.com", owner: "Magnite (Rubicon Project)", category: "advertising", marketing: true },
    { domain: "openx.net", owner: "OpenX", category: "advertising", marketing: true },
    { domain: "casalemedia.com", owner: "Index Exchange", category: "advertising", marketing: true },
    { domain: "adsrvr.org", owner: "The Trade Desk", category: "advertising", marketing: true },
    { domain: "amazon-adsystem.com", owner: "Amazon Ads", category: "advertising", marketing: true },
    { domain: "tiktok.com/i18n/pixel", owner: "TikTok Pixel", category: "advertising", marketing: true },
    { domain: "analytics.tiktok.com", owner: "TikTok Pixel", category: "advertising", marketing: true },
    { domain: "pinterest.com/ct", owner: "Pinterest Tag", category: "advertising", marketing: true },
    { domain: "ct.pinterest.com", owner: "Pinterest Tag", category: "advertising", marketing: true },
    { domain: "snapchat.com/tr", owner: "Snap Pixel", category: "advertising", marketing: true },
    { domain: "tr.snapchat.com", owner: "Snap Pixel", category: "advertising", marketing: true },
    { domain: "reddit.com/rp", owner: "Reddit Pixel", category: "advertising", marketing: true },
    { domain: "alb.reddit.com", owner: "Reddit Pixel", category: "advertising", marketing: true },
    { domain: "mathtag.com", owner: "MediaMath", category: "advertising", marketing: true },
    { domain: "adform.net", owner: "Adform", category: "advertising", marketing: true },
    { domain: "yieldmo.com", owner: "Yieldmo", category: "advertising", marketing: true },
    { domain: "3lift.com", owner: "TripleLift", category: "advertising", marketing: true },
    { domain: "sharethrough.com", owner: "Sharethrough", category: "advertising", marketing: true },
    { domain: "media.net", owner: "Media.net", category: "advertising", marketing: true },
    { domain: "bidswitch.net", owner: "BidSwitch", category: "advertising", marketing: true },
    { domain: "demdex.net", owner: "Adobe Audience Manager", category: "data_broker", marketing: true },
    { domain: "everesttech.net", owner: "Adobe Advertising Cloud", category: "advertising", marketing: true },

    // --- Data brokers / identity resolution --------------------------------
    { domain: "liveramp.com", owner: "LiveRamp", category: "data_broker", marketing: true },
    { domain: "rlcdn.com", owner: "LiveRamp (Rapleaf)", category: "data_broker", marketing: true },
    { domain: "acxiom.com", owner: "Acxiom", category: "data_broker", marketing: true },
    { domain: "exelator.com", owner: "Neustar / TransUnion", category: "data_broker", marketing: true },
    { domain: "tapad.com", owner: "Tapad", category: "data_broker", marketing: true },
    { domain: "id5-sync.com", owner: "ID5", category: "data_broker", marketing: true },
    { domain: "britepool.com", owner: "BritePool", category: "data_broker", marketing: true },
    { domain: "neustar.biz", owner: "Neustar", category: "data_broker", marketing: true },
    { domain: "agkn.com", owner: "Neustar AdAdvisor", category: "data_broker", marketing: true },
    { domain: "zetaglobal.com", owner: "Zeta Global", category: "data_broker", marketing: true },

    // --- Analytics ----------------------------------------------------------
    { domain: "segment.io", owner: "Twilio Segment", category: "customer_data_platform", marketing: false },
    { domain: "segment.com", owner: "Twilio Segment", category: "customer_data_platform", marketing: false },
    { domain: "mixpanel.com", owner: "Mixpanel", category: "analytics", marketing: false },
    { domain: "amplitude.com", owner: "Amplitude", category: "analytics", marketing: false },
    { domain: "heap.io", owner: "Heap", category: "analytics", marketing: false },
    { domain: "heapanalytics.com", owner: "Heap", category: "analytics", marketing: false },
    { domain: "hotjar.com", owner: "Hotjar", category: "session_replay", marketing: false },
    { domain: "fullstory.com", owner: "FullStory", category: "session_replay", marketing: false },
    { domain: "clarity.ms", owner: "Microsoft Clarity", category: "session_replay", marketing: false },
    { domain: "logrocket.com", owner: "LogRocket", category: "session_replay", marketing: false },
    { domain: "mouseflow.com", owner: "Mouseflow", category: "session_replay", marketing: false },
    { domain: "quantserve.com", owner: "Quantcast", category: "analytics", marketing: true },
    { domain: "quantcast.com", owner: "Quantcast", category: "analytics", marketing: true },
    { domain: "scorecardresearch.com", owner: "Comscore", category: "analytics", marketing: true },
    { domain: "newrelic.com", owner: "New Relic", category: "analytics", marketing: false },
    { domain: "nr-data.net", owner: "New Relic", category: "analytics", marketing: false },
    { domain: "sentry.io", owner: "Sentry", category: "analytics", marketing: false },
    { domain: "cdn.segment.com", owner: "Twilio Segment", category: "customer_data_platform", marketing: false },
    { domain: "app.posthog.com", owner: "PostHog", category: "analytics", marketing: false },
    { domain: "clevertap.com", owner: "CleverTap", category: "customer_data_platform", marketing: true },
    { domain: "braze.com", owner: "Braze", category: "customer_data_platform", marketing: true },
    { domain: "customer.io", owner: "Customer.io", category: "customer_data_platform", marketing: true },
    { domain: "intercom.io", owner: "Intercom", category: "customer_data_platform", marketing: false },
    { domain: "intercomcdn.com", owner: "Intercom", category: "customer_data_platform", marketing: false },
    { domain: "hs-analytics.net", owner: "HubSpot", category: "customer_data_platform", marketing: true },
    { domain: "hubspot.com", owner: "HubSpot", category: "customer_data_platform", marketing: true },
    { domain: "hsforms.net", owner: "HubSpot", category: "customer_data_platform", marketing: true },
    { domain: "marketo.net", owner: "Adobe Marketo", category: "customer_data_platform", marketing: true },
    { domain: "pardot.com", owner: "Salesforce Pardot", category: "customer_data_platform", marketing: true },
    { domain: "krxd.net", owner: "Salesforce (Krux) DMP", category: "data_broker", marketing: true },

    // --- Social widgets / SDKs (also fingerprint + track cross-site) -------
    { domain: "platform.twitter.com", owner: "X / Twitter Widgets", category: "social", marketing: false },
    { domain: "platform.linkedin.com", owner: "LinkedIn Widgets", category: "social", marketing: false },
    { domain: "connect.facebook.net", owner: "Meta SDK", category: "social", marketing: true },
    { domain: "www.facebook.com/plugins", owner: "Meta Plugins", category: "social", marketing: true },
    { domain: "platform.instagram.com", owner: "Meta (Instagram) Embed", category: "social", marketing: false },
    { domain: "youtube.com/embed", owner: "Google (YouTube) Embed", category: "social", marketing: false },
    { domain: "cdn.tiktok.com", owner: "TikTok Embed", category: "social", marketing: false },

    // --- Fingerprinting / device intelligence -------------------------------
    { domain: "fingerprintjs.com", owner: "FingerprintJS", category: "fingerprinting", marketing: false },
    { domain: "fpjs.io", owner: "FingerprintJS", category: "fingerprinting", marketing: false },
    { domain: "threatmetrix.com", owner: "LexisNexis ThreatMetrix", category: "fingerprinting", marketing: false },
    { domain: "maxmind.com", owner: "MaxMind", category: "fingerprinting", marketing: false },
    { domain: "iesnare.com", owner: "iovation (TransUnion)", category: "fingerprinting", marketing: false },

    // --- Tag managers / CDPs -------------------------------------------------
    { domain: "tealium.com", owner: "Tealium", category: "tag_manager", marketing: false },
    { domain: "tags.tiqcdn.com", owner: "Tealium", category: "tag_manager", marketing: false },
    { domain: "cdn.cookielaw.org", owner: "OneTrust", category: "essential", marketing: false },
    { domain: "cookiebot.com", owner: "Cookiebot", category: "essential", marketing: false },
    { domain: "cdn.onetrust.com", owner: "OneTrust", category: "essential", marketing: false },
    { domain: "trustarc.com", owner: "TrustArc", category: "essential", marketing: false },
];

const norm = (h: string) => h.toLowerCase().replace(/^www\./, "");

/**
 * Resolve a request hostname to a known tracker entry. Matches by exact
 * host or by domain suffix (e.g. "sub.doubleclick.net" matches
 * "doubleclick.net"), which is how third-party ad-tech is actually served —
 * from ever-changing subdomains under a stable registrable domain.
 */
export function lookupTracker(hostname: string): TrackerEntry | null {
    const host = norm(hostname);
    for (const entry of TRACKER_DATABASE) {
        const d = norm(entry.domain);
        if (host === d || host.endsWith(`.${d}`)) return entry;
    }
    return null;
}
