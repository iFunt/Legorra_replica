/**
 * Minimal HTML utilities for the policy extractor. No cheerio/jsdom
 * dependency — this only needs "get the readable text" and "find links
 * that look like a privacy policy," both of which regexes handle fine for
 * the relatively regular markup real privacy-policy pages use.
 */

const ENTITIES: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
};

function decodeEntities(s: string): string {
    return s
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (m) => ENTITIES[m] ?? m);
}

/** Strip scripts/styles/tags from an HTML document, leaving readable text. */
export function htmlToText(html: string): string {
    const withoutNoise = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ");
    return decodeEntities(withoutNoise)
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export interface DiscoveredLink {
    href: string;
    text: string;
}

/** Pull every <a href="..."> with its inner text out of a page's HTML. */
export function extractLinks(html: string, baseUrl: string): DiscoveredLink[] {
    const links: DiscoveredLink[] = [];
    const re = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
        const text = htmlToText(m[2]).trim();
        try {
            const url = new URL(m[1], baseUrl).toString();
            links.push({ href: url, text });
        } catch {
            // ignore malformed hrefs (mailto: with odd chars, javascript:, etc.)
        }
    }
    return links;
}
