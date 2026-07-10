import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { singleFileUpload } from "../lib/upload";
import { storageKey, uploadFile, deleteFile } from "../lib/storage";
import { ensureClaimAccess, listAccessibleProjectIds } from "../lib/access";
import { runClaimPipeline } from "../lib/claims/orchestrator";
import { STAGE_LABELS } from "../lib/claims/stageMachine";
import { logClaimEvent, setClaimStage } from "../lib/claims/stageMachine";
import type { ClaimRow, ClaimStage } from "../lib/claims/types";

export const claimsRouter = Router();

const CLAIM_DOC_ALLOWED_TYPES = new Set([
    "pdf",
    "docx",
    "doc",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "txt",
]);

function extensionOf(filename: string): string {
    return filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
}

// GET /claims — own claims + claims shared directly or via project access.
claimsRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();

    const projectIds = await listAccessibleProjectIds(userId, userEmail, db);
    const sharedProjectIds = projectIds.filter((id) => id); // own+shared, own filtered below by neq

    const [{ data: own, error: ownErr }, { data: shared }, { data: sharedDirect }] =
        await Promise.all([
            db
                .from("claims")
                .select("*")
                .eq("user_id", userId)
                .order("created_at", { ascending: false }),
            sharedProjectIds.length
                ? db
                      .from("claims")
                      .select("*")
                      .in("project_id", sharedProjectIds)
                      .neq("user_id", userId)
                : Promise.resolve({ data: [] as Record<string, unknown>[] }),
            userEmail
                ? db
                      .from("claims")
                      .select("*")
                      .contains("shared_with", [userEmail])
                      .neq("user_id", userId)
                : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        ]);
    if (ownErr) return void res.status(500).json({ detail: ownErr.message });

    const seen = new Set<string>();
    const claims: Record<string, unknown>[] = [];
    for (const c of [...(own ?? []), ...(shared ?? []), ...(sharedDirect ?? [])]) {
        const id = (c as { id: string }).id;
        if (seen.has(id)) continue;
        seen.add(id);
        claims.push(c);
    }
    claims.sort(
        (a, b) =>
            new Date((b as { created_at: string }).created_at).getTime() -
            new Date((a as { created_at: string }).created_at).getTime(),
    );
    res.json(claims);
});

// POST /claims — create a new claim (company name + issue description).
claimsRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const { company_name, issue_summary, project_id } = req.body ?? {};
    if (!company_name || typeof company_name !== "string") {
        return void res.status(400).json({ detail: "company_name is required" });
    }
    if (!issue_summary || typeof issue_summary !== "string") {
        return void res.status(400).json({ detail: "issue_summary is required" });
    }

    const { data: claim, error } = await db
        .from("claims")
        .insert({
            user_id: userId,
            company_name,
            issue_summary,
            project_id: typeof project_id === "string" ? project_id : null,
        })
        .select("*")
        .single();
    if (error || !claim)
        return void res.status(500).json({ detail: "Failed to create claim" });

    await logClaimEvent(db, claim.id as string, "user_action", { action: "claim_created" });
    res.status(201).json(claim);
});

// GET /claims/:claimId — full detail: claim, research, drafts, timeline, documents.
claimsRouter.get("/:claimId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { claimId } = req.params;
    const db = createServerSupabase();

    const { data: claim } = await db.from("claims").select("*").eq("id", claimId).single();
    if (!claim) return void res.status(404).json({ detail: "Claim not found" });
    const access = await ensureClaimAccess(claim as ClaimRow, userId, userEmail, db);
    if (!access.ok) return void res.status(404).json({ detail: "Claim not found" });

    const [{ data: research }, { data: drafts }, { data: events }, { data: documents }] =
        await Promise.all([
            db
                .from("claim_research")
                .select("*")
                .eq("claim_id", claimId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
            db
                .from("claim_drafts")
                .select("*")
                .eq("claim_id", claimId)
                .order("version", { ascending: true }),
            db
                .from("claim_events")
                .select("*")
                .eq("claim_id", claimId)
                .order("created_at", { ascending: true }),
            db
                .from("documents")
                .select("id, filename, file_type, size_bytes, status, created_at")
                .eq("claim_id", claimId)
                .order("created_at", { ascending: false }),
        ]);

    res.json({
        claim,
        research: research ?? null,
        drafts: drafts ?? [],
        events: events ?? [],
        documents: documents ?? [],
        isOwner: access.isOwner,
        stageLabels: STAGE_LABELS,
    });
});

// DELETE /claims/:claimId — owner only.
claimsRouter.delete("/:claimId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { claimId } = req.params;
    const db = createServerSupabase();
    const { data: claim } = await db
        .from("claims")
        .select("id, user_id")
        .eq("id", claimId)
        .single();
    if (!claim || claim.user_id !== userId)
        return void res.status(404).json({ detail: "Claim not found" });
    await db.from("claims").delete().eq("id", claimId);
    res.status(204).send();
});

// POST /claims/:claimId/documents — attach evidence (DSAR response, etc).
claimsRouter.post(
    "/:claimId/documents",
    requireAuth,
    singleFileUpload("file"),
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { claimId } = req.params;
        const db = createServerSupabase();

        const { data: claim } = await db
            .from("claims")
            .select("id, user_id, project_id, shared_with")
            .eq("id", claimId)
            .single();
        if (!claim) return void res.status(404).json({ detail: "Claim not found" });
        const access = await ensureClaimAccess(
            claim as ClaimRow,
            userId,
            userEmail,
            db,
        );
        if (!access.ok) return void res.status(404).json({ detail: "Claim not found" });

        const file = req.file;
        if (!file) return void res.status(400).json({ detail: "file is required" });
        const ext = extensionOf(file.originalname);
        if (!CLAIM_DOC_ALLOWED_TYPES.has(ext)) {
            return void res.status(400).json({
                detail: `Unsupported file type: ${ext}. Allowed: ${[...CLAIM_DOC_ALLOWED_TYPES].join(", ")}`,
            });
        }

        const { data: doc, error: insertErr } = await db
            .from("documents")
            .insert({
                claim_id: claimId,
                user_id: userId,
                filename: file.originalname,
                file_type: ext,
                size_bytes: file.buffer.byteLength,
                status: "ready",
            })
            .select("*")
            .single();
        if (insertErr || !doc)
            return void res.status(500).json({ detail: "Failed to create document record" });

        const key = storageKey(userId, doc.id as string, file.originalname);
        await uploadFile(
            key,
            file.buffer.buffer.slice(
                file.buffer.byteOffset,
                file.buffer.byteOffset + file.buffer.byteLength,
            ) as ArrayBuffer,
            file.mimetype || "application/octet-stream",
        );

        const { data: version } = await db
            .from("document_versions")
            .insert({
                document_id: doc.id,
                storage_path: key,
                source: "upload",
                version_number: 1,
                display_name: file.originalname,
            })
            .select("id")
            .single();
        if (version?.id) {
            await db
                .from("documents")
                .update({ current_version_id: version.id })
                .eq("id", doc.id);
        }

        await logClaimEvent(db, claimId, "user_action", {
            action: "document_uploaded",
            filename: file.originalname,
        });
        res.status(201).json(doc);
    },
);

// DELETE /claims/:claimId/documents/:documentId
claimsRouter.delete("/:claimId/documents/:documentId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { claimId, documentId } = req.params;
    const db = createServerSupabase();
    const { data: doc } = await db
        .from("documents")
        .select("id, user_id, claim_id")
        .eq("id", documentId)
        .eq("claim_id", claimId)
        .single();
    if (!doc || doc.user_id !== userId)
        return void res.status(404).json({ detail: "Document not found" });

    const { data: versions } = await db
        .from("document_versions")
        .select("storage_path, pdf_storage_path")
        .eq("document_id", documentId);
    await Promise.all(
        (versions ?? []).flatMap((v) =>
            [v.storage_path, v.pdf_storage_path]
                .filter((p): p is string => typeof p === "string" && p.length > 0)
                .map((p) => deleteFile(p).catch(() => {})),
        ),
    );
    await db.from("documents").delete().eq("id", documentId);
    res.status(204).send();
});

// POST /claims/:claimId/run — SSE stream driving the research → valuation →
// draft/judge pipeline. Owner or shared user may trigger it.
claimsRouter.post("/:claimId/run", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { claimId } = req.params;
    const db = createServerSupabase();

    const { data: claim } = await db.from("claims").select("*").eq("id", claimId).single();
    if (!claim) return void res.status(404).json({ detail: "Claim not found" });
    const access = await ensureClaimAccess(claim as ClaimRow, userId, userEmail, db);
    if (!access.ok) return void res.status(404).json({ detail: "Claim not found" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const write = (event: Record<string, unknown>) =>
        res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
        await runClaimPipeline(db, claimId, (progress) => write(progress));
        write({ stage: "done", message: "Pipeline finished." });
    } catch (err) {
        write({
            stage: "error",
            message: err instanceof Error ? err.message : String(err),
        });
    } finally {
        res.end();
    }
});

// POST /claims/:claimId/approve — user approves the internally-reviewed
// draft, moving it to ready_to_send.
claimsRouter.post("/:claimId/approve", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { claimId } = req.params;
    const db = createServerSupabase();
    const { data: claim } = await db
        .from("claims")
        .select("id, user_id, stage")
        .eq("id", claimId)
        .single();
    if (!claim || claim.user_id !== userId)
        return void res.status(404).json({ detail: "Claim not found" });

    await setClaimStage(db, claimId, "ready_to_send" as ClaimStage);
    await db
        .from("claim_drafts")
        .update({ status: "approved" })
        .eq("claim_id", claimId)
        .eq("status", "reviewed");
    await logClaimEvent(db, claimId, "user_action", { action: "approved" });
    res.json({ ok: true });
});

// POST /claims/:claimId/send — user marks the approved letter as sent.
claimsRouter.post("/:claimId/send", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { claimId } = req.params;
    const db = createServerSupabase();
    const { data: claim } = await db
        .from("claims")
        .select("id, user_id")
        .eq("id", claimId)
        .single();
    if (!claim || claim.user_id !== userId)
        return void res.status(404).json({ detail: "Claim not found" });

    await setClaimStage(db, claimId, "sent" as ClaimStage);
    await db
        .from("claim_drafts")
        .update({ status: "sent" })
        .eq("claim_id", claimId)
        .eq("status", "approved");
    await logClaimEvent(db, claimId, "user_action", { action: "marked_sent" });
    res.json({ ok: true });
});

// POST /claims/:claimId/resolve — user records a final outcome.
claimsRouter.post("/:claimId/resolve", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { claimId } = req.params;
    const { outcome } = req.body ?? {};
    const db = createServerSupabase();
    const { data: claim } = await db
        .from("claims")
        .select("id, user_id")
        .eq("id", claimId)
        .single();
    if (!claim || claim.user_id !== userId)
        return void res.status(404).json({ detail: "Claim not found" });

    await setClaimStage(db, claimId, "resolved" as ClaimStage);
    await logClaimEvent(db, claimId, "user_action", {
        action: "resolved",
        outcome: typeof outcome === "string" ? outcome : undefined,
    });
    res.json({ ok: true });
});
