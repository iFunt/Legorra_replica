import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { getUserModelSettings } from "../lib/userSettings";
import { discoverPolicyUrls, extractCommitments, fetchPolicyText } from "../lib/privacyDrift/policyExtractor";
import { runFullScan } from "../lib/privacyDrift/scanner";
import { buildDiscrepancyFlags, type PolicyCommitmentRow, type TechnicalEvidenceRow } from "../lib/privacyDrift/discrepancyEngine";
import { buildEvidenceReportPdf } from "../lib/privacyDrift/reportGenerator";

export const privacyDriftRouter = Router();

type Db = ReturnType<typeof createServerSupabase>;

function normalizeDomain(input: string): { hostname: string; rootUrl: string } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
        const url = new URL(withProtocol);
        return { hostname: url.hostname, rootUrl: `https://${url.hostname}` };
    } catch {
        return null;
    }
}

// Runs the full three-phase pipeline for a scan row that already exists.
// Fire-and-forget from the route handler — updates `status` as it goes so
// the frontend can poll GET /privacy-drift/scans/:id.
async function runScanPipeline(scanId: string, userId: string, hostname: string, rootUrl: string, db: Db) {
    try {
        await db.from("privacy_scans").update({ status: "discovering", updated_at: new Date().toISOString() }).eq("id", scanId);
        const discovered = await discoverPolicyUrls(hostname);
        await db
            .from("privacy_scans")
            .update({
                privacy_policy_url: discovered.privacyPolicyUrl,
                terms_url: discovered.termsUrl,
                cookie_banner_detected: discovered.cookieBannerDetected,
                updated_at: new Date().toISOString(),
            })
            .eq("id", scanId);

        const [policyText, { title_model, api_keys }] = await Promise.all([
            discovered.privacyPolicyUrl ? fetchPolicyText(discovered.privacyPolicyUrl) : Promise.resolve(null),
            getUserModelSettings(userId, db),
        ]);

        let commitmentRows: PolicyCommitmentRow[] = [];
        if (policyText) {
            const extracted = await extractCommitments({ policyText, model: title_model, apiKeys: api_keys });
            if (extracted.length > 0) {
                const { data: inserted } = await db
                    .from("policy_commitments")
                    .insert(
                        extracted.map((c) => ({
                            scan_id: scanId,
                            domain: hostname,
                            clause_type: c.clause_type,
                            extracted_text: c.extracted_text,
                            rule_key: c.rule_key,
                            machine_rule: c.machine_rule,
                            source_url: discovered.privacyPolicyUrl,
                        })),
                    )
                    .select("id, domain, clause_type, extracted_text, rule_key, machine_rule, source_url");
                commitmentRows = (inserted ?? []) as PolicyCommitmentRow[];
            }
        }

        await db.from("privacy_scans").update({ status: "scanning", updated_at: new Date().toISOString() }).eq("id", scanId);
        const scanned = await runFullScan(rootUrl);

        let evidenceRows: TechnicalEvidenceRow[] = [];
        if (scanned.length > 0) {
            const { data: inserted } = await db
                .from("technical_evidence")
                .insert(
                    scanned.map((e) => ({
                        scan_id: scanId,
                        domain: hostname,
                        consent_state: e.consent_state,
                        tracker_domain: e.tracker_domain,
                        tracker_owner: e.tracker_owner,
                        tracker_category: e.tracker_category,
                        payload_type: e.payload_type,
                        data_transmitted: e.data_transmitted,
                        request_url: e.request_url,
                    })),
                )
                .select("id, domain, consent_state, tracker_domain, tracker_owner, tracker_category, payload_type, data_transmitted, request_url");
            evidenceRows = (inserted ?? []) as TechnicalEvidenceRow[];
        }

        await db.from("privacy_scans").update({ status: "analyzing", updated_at: new Date().toISOString() }).eq("id", scanId);
        const flags = buildDiscrepancyFlags(hostname, commitmentRows, evidenceRows);
        if (flags.length > 0) {
            await db.from("discrepancy_flags").insert(flags.map((f) => ({ ...f, scan_id: scanId })));
        }

        await db
            .from("privacy_scans")
            .update({ status: "ready", scanned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", scanId);
    } catch (err) {
        console.error(`[privacy-drift] scan ${scanId} failed`, err);
        await db
            .from("privacy_scans")
            .update({
                status: "error",
                error_message: err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
                updated_at: new Date().toISOString(),
            })
            .eq("id", scanId);
    }
}

// POST /privacy-drift/scans
privacyDriftRouter.post("/scans", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { domain, project_id } = req.body as { domain?: string; project_id?: string };
    if (!domain || typeof domain !== "string")
        return void res.status(400).json({ detail: "domain is required" });

    const normalized = normalizeDomain(domain);
    if (!normalized) return void res.status(400).json({ detail: "domain is not a valid URL/hostname" });

    const db = createServerSupabase();
    const { data: scan, error } = await db
        .from("privacy_scans")
        .insert({
            user_id: userId,
            project_id: project_id ?? null,
            domain: normalized.hostname,
            status: "pending",
        })
        .select("*")
        .single();
    if (error || !scan) return void res.status(500).json({ detail: error?.message ?? "Failed to create scan" });

    void runScanPipeline(scan.id as string, userId, normalized.hostname, normalized.rootUrl, db);

    res.status(201).json(scan);
});

// GET /privacy-drift/scans
privacyDriftRouter.get("/scans", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const { data, error } = await db
        .from("privacy_scans")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
    if (error) return void res.status(500).json({ detail: error.message });
    res.json(data ?? []);
});

async function loadScanDetail(scanId: string, userId: string, db: Db) {
    const { data: scan } = await db.from("privacy_scans").select("*").eq("id", scanId).eq("user_id", userId).single();
    if (!scan) return null;
    const [{ data: commitments }, { data: evidence }, { data: flags }] = await Promise.all([
        db.from("policy_commitments").select("*").eq("scan_id", scanId).order("created_at", { ascending: true }),
        db.from("technical_evidence").select("*").eq("scan_id", scanId).order("created_at", { ascending: true }),
        db
            .from("discrepancy_flags")
            .select("*")
            .eq("scan_id", scanId)
            .order("severity", { ascending: true })
            .order("created_at", { ascending: true }),
    ]);
    return { scan, commitments: commitments ?? [], evidence: evidence ?? [], flags: flags ?? [] };
}

// GET /privacy-drift/scans/:scanId
privacyDriftRouter.get("/scans/:scanId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { scanId } = req.params;
    const db = createServerSupabase();
    const detail = await loadScanDetail(scanId, userId, db);
    if (!detail) return void res.status(404).json({ detail: "Scan not found" });
    res.json(detail);
});

// DELETE /privacy-drift/scans/:scanId
privacyDriftRouter.delete("/scans/:scanId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { scanId } = req.params;
    const db = createServerSupabase();
    const { data: scan } = await db.from("privacy_scans").select("id").eq("id", scanId).eq("user_id", userId).single();
    if (!scan) return void res.status(404).json({ detail: "Scan not found" });
    await db.from("privacy_scans").delete().eq("id", scanId);
    res.status(204).send();
});

// GET /privacy-drift/scans/:scanId/report
privacyDriftRouter.get("/scans/:scanId/report", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { scanId } = req.params;
    const db = createServerSupabase();
    const detail = await loadScanDetail(scanId, userId, db);
    if (!detail) return void res.status(404).json({ detail: "Scan not found" });
    if (detail.scan.status !== "ready")
        return void res.status(409).json({ detail: `Scan is not ready yet (status: ${detail.scan.status})` });

    try {
        const pdf = await buildEvidenceReportPdf({
            domain: detail.scan.domain as string,
            scannedAt: (detail.scan.scanned_at as string) ?? (detail.scan.created_at as string),
            privacyPolicyUrl: (detail.scan.privacy_policy_url as string | null) ?? null,
            commitments: detail.commitments,
            evidence: detail.evidence,
            flags: detail.flags,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="privacydrift-${(detail.scan.domain as string).replace(/[^a-z0-9.-]/gi, "_")}.pdf"`,
        );
        res.send(pdf);
    } catch (err) {
        console.error(`[privacy-drift] report generation failed for ${scanId}`, err);
        res.status(500).json({ detail: "Failed to generate report" });
    }
});
