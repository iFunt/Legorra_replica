"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    ArrowLeft,
    Upload,
    FileText,
    Trash2,
    Play,
    CheckCircle2,
    AlertTriangle,
    Loader2,
} from "lucide-react";
import {
    getClaim,
    deleteClaim,
    uploadClaimDocument,
    deleteClaimDocument,
    streamClaimRun,
    consumeClaimRunStream,
    approveClaim,
    sendClaim,
    resolveClaim,
    type ClaimDetail,
    type ClaimProgressEvent,
} from "@/app/lib/claimsApi";
import { STAGE_ORDER, STAGE_LABELS, stageBadgeClasses } from "./stageMeta";

type Tab = "research" | "valuation" | "draft" | "documents" | "timeline";

function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatMoney(value: number, currency: string) {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    }).format(value);
}

export function ClaimPage({ claimId }: { claimId: string }) {
    const router = useRouter();
    const [detail, setDetail] = useState<ClaimDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("research");
    const [running, setRunning] = useState(false);
    const [liveEvents, setLiveEvents] = useState<ClaimProgressEvent[]>([]);
    const [actionError, setActionError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    async function loadDetail() {
        const data = await getClaim(claimId).catch(() => null);
        setDetail(data);
        setLoading(false);
    }

    useEffect(() => {
        loadDetail();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [claimId]);

    async function handleRun() {
        setRunning(true);
        setLiveEvents([]);
        setActionError(null);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const response = await streamClaimRun(claimId, controller.signal);
            await consumeClaimRunStream(response, (event) => {
                setLiveEvents((prev) => [...prev, event]);
            });
        } catch (err: unknown) {
            setActionError((err as Error).message || "Pipeline run failed");
        } finally {
            setRunning(false);
            await loadDetail();
        }
    }

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        for (const f of files) {
            await uploadClaimDocument(claimId, f).catch(() => {});
        }
        await loadDetail();
    }

    async function handleDeleteDoc(documentId: string) {
        await deleteClaimDocument(claimId, documentId).catch(() => {});
        await loadDetail();
    }

    async function handleDeleteClaim() {
        if (!confirm("Delete this claim? This cannot be undone.")) return;
        await deleteClaim(claimId);
        router.push("/claims");
    }

    async function handleApprove() {
        setActionError(null);
        try {
            await approveClaim(claimId);
            await loadDetail();
        } catch (err: unknown) {
            setActionError((err as Error).message || "Failed to approve");
        }
    }

    async function handleSend() {
        setActionError(null);
        try {
            await sendClaim(claimId);
            await loadDetail();
        } catch (err: unknown) {
            setActionError((err as Error).message || "Failed to mark as sent");
        }
    }

    async function handleResolve() {
        const outcome = prompt("Outcome (optional) — e.g. settled, escalated to ICO, withdrawn:");
        setActionError(null);
        try {
            await resolveClaim(claimId, outcome ?? undefined);
            await loadDetail();
        } catch (err: unknown) {
            setActionError((err as Error).message || "Failed to resolve");
        }
    }

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-white">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-white gap-3">
                <p className="text-sm text-gray-500">Claim not found.</p>
                <button
                    onClick={() => router.push("/claims")}
                    className="text-sm text-blue-600 hover:underline"
                >
                    Back to claims
                </button>
            </div>
        );
    }

    const { claim, research, drafts, events, documents, isOwner } = detail;
    const stageIdx = STAGE_ORDER.indexOf(claim.stage);
    const canRun =
        isOwner &&
        !running &&
        (claim.stage === "acknowledged" || claim.stage === "on_hold");
    const latestDraft = [...drafts].sort((a, b) => b.version - a.version)[0] ?? null;
    const bestDraft =
        [...drafts].sort((a, b) => (b.judge_score ?? 0) - (a.judge_score ?? 0))[0] ?? null;

    const valuationEvent = [...events]
        .reverse()
        .find(
            (e) =>
                e.type === "system_note" &&
                (e.payload as { type?: string }).type === "valuation",
        );
    const valuation = valuationEvent
        ? ((valuationEvent.payload as { valuation?: Record<string, unknown> }).valuation as
              | {
                    low: number;
                    high: number;
                    currency: string;
                    basis: string;
                    comparable_cases: { title: string; citation?: string; relevance: string }[];
                }
              | undefined)
        : undefined;

    return (
        <div className="flex-1 overflow-y-auto bg-white">
            {/* Header */}
            <div className="px-8 py-4 border-b border-gray-100">
                <button
                    onClick={() => router.push("/claims")}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 mb-2"
                >
                    <ArrowLeft className="h-3 w-3" /> Claims
                </button>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-medium font-serif text-gray-900">
                            {claim.company_name}
                        </h1>
                        <div className="mt-1 flex items-center gap-2">
                            <span
                                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${stageBadgeClasses(claim.stage)}`}
                            >
                                {STAGE_LABELS[claim.stage]}
                            </span>
                            {claim.confidence_score != null && (
                                <span className="text-xs text-gray-400">
                                    {Math.round(claim.confidence_score)}% internal confidence
                                </span>
                            )}
                        </div>
                    </div>
                    {isOwner && (
                        <button
                            onClick={handleDeleteClaim}
                            className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* Stage tracker */}
                <div className="mt-5 flex items-center gap-0.5 overflow-x-auto pb-1">
                    {STAGE_ORDER.map((s, i) => {
                        const state =
                            claim.stage === "on_hold"
                                ? i === 0
                                    ? "current"
                                    : "upcoming"
                                : i < stageIdx
                                  ? "done"
                                  : i === stageIdx
                                    ? "current"
                                    : "upcoming";
                        return (
                            <div key={s} className="flex items-center">
                                <div
                                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${
                                        state === "done"
                                            ? "bg-gray-900 text-white"
                                            : state === "current"
                                              ? "bg-purple-100 text-purple-800 ring-1 ring-purple-300"
                                              : "bg-gray-50 text-gray-400"
                                    }`}
                                >
                                    {STAGE_LABELS[s]}
                                </div>
                                {i < STAGE_ORDER.length - 1 && (
                                    <div className="h-px w-3 bg-gray-200" />
                                )}
                            </div>
                        );
                    })}
                </div>

                {claim.stage === "on_hold" && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        The pipeline hit an error and paused. Check the timeline tab for
                        details, then try running it again.
                    </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    {canRun && (
                        <button
                            onClick={handleRun}
                            className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
                        >
                            <Play className="h-3.5 w-3.5" />
                            {claim.stage === "on_hold" ? "Run again" : "Start research & drafting"}
                        </button>
                    )}
                    {isOwner && claim.stage === "internal_review" && (
                        <button
                            onClick={handleApprove}
                            className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Approve draft
                        </button>
                    )}
                    {isOwner && claim.stage === "ready_to_send" && (
                        <button
                            onClick={handleSend}
                            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
                        >
                            Mark as sent
                        </button>
                    )}
                    {isOwner && claim.stage === "sent" && (
                        <button
                            onClick={handleResolve}
                            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                            Record outcome
                        </button>
                    )}
                </div>

                {actionError && (
                    <p className="mt-2 text-xs text-red-600">{actionError}</p>
                )}

                {(running || liveEvents.length > 0) && (
                    <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 max-h-40 overflow-y-auto space-y-1">
                        {liveEvents.map((e, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                                {running && i === liveEvents.length - 1 ? (
                                    <Loader2 className="h-3 w-3 animate-spin mt-0.5 shrink-0" />
                                ) : (
                                    <span className="h-3 w-3 shrink-0" />
                                )}
                                <span>{e.message}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-8 border-b border-gray-100 text-sm">
                {(
                    [
                        ["research", "Research"],
                        ["valuation", "Valuation"],
                        ["draft", "Draft"],
                        ["documents", `Documents (${documents.length})`],
                        ["timeline", "Timeline"],
                    ] as [Tab, string][]
                ).map(([id, label]) => (
                    <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={`px-3 py-2.5 border-b-2 transition-colors ${
                            tab === id
                                ? "border-gray-900 text-gray-900 font-medium"
                                : "border-transparent text-gray-400 hover:text-gray-700"
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="px-8 py-6 max-w-3xl">
                {tab === "research" &&
                    (research ? (
                        <div className="space-y-5">
                            <p className="text-xs text-gray-400 italic">
                                Automated research summary — figures and citations are
                                best-effort and should be verified against the primary source
                                (Companies House, ico.org.uk) before relying on them.
                            </p>
                            {research.registered_office && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-800 mb-1">
                                        Registered office
                                    </h3>
                                    <p className="text-sm text-gray-600">
                                        {Object.values(research.registered_office)
                                            .filter(Boolean)
                                            .join(", ")}
                                    </p>
                                </div>
                            )}
                            {research.privacy_policy_summary && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-800 mb-1">
                                        Privacy policy
                                    </h3>
                                    <p className="text-sm text-gray-600">
                                        {research.privacy_policy_summary}
                                    </p>
                                    {research.privacy_policy_url && (
                                        <a
                                            href={research.privacy_policy_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:underline"
                                        >
                                            {research.privacy_policy_url}
                                        </a>
                                    )}
                                </div>
                            )}
                            {research.ico_fines.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-800 mb-1">
                                        Prior ICO fines
                                    </h3>
                                    <ul className="space-y-2">
                                        {research.ico_fines.map((f, i) => (
                                            <li key={i} className="text-sm text-gray-600">
                                                <span className="font-medium">
                                                    {f.date} {f.amount}
                                                </span>{" "}
                                                — {f.summary}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {research.ico_enforcement_notices.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-800 mb-1">
                                        Prior ICO enforcement notices
                                    </h3>
                                    <ul className="space-y-2">
                                        {research.ico_enforcement_notices.map((f, i) => (
                                            <li key={i} className="text-sm text-gray-600">
                                                {f.summary}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {research.sources.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-800 mb-1">
                                        Sources
                                    </h3>
                                    <ul className="space-y-1">
                                        {research.sources.map((s, i) => (
                                            <li key={i} className="text-xs">
                                                {s.url ? (
                                                    <a
                                                        href={s.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:underline"
                                                    >
                                                        {s.label}
                                                    </a>
                                                ) : (
                                                    s.label
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400">
                            No research yet — run the pipeline to research this company.
                        </p>
                    ))}

                {tab === "valuation" &&
                    (valuation ? (
                        <div className="space-y-4">
                            <div className="text-2xl font-serif text-gray-900">
                                {valuation.low === valuation.high
                                    ? formatMoney(valuation.low, valuation.currency)
                                    : `${formatMoney(valuation.low, valuation.currency)} – ${formatMoney(valuation.high, valuation.currency)}`}
                            </div>
                            <p className="text-sm text-gray-600 leading-relaxed">
                                {valuation.basis}
                            </p>
                            {valuation.comparable_cases.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-800 mb-1">
                                        Comparable cases relied on
                                    </h3>
                                    <ul className="space-y-1.5">
                                        {valuation.comparable_cases.map((c, i) => (
                                            <li key={i} className="text-sm text-gray-600">
                                                <span className="font-medium">{c.title}</span>
                                                {c.citation ? ` (${c.citation})` : ""} —{" "}
                                                {c.relevance}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400">
                            No valuation yet — run the pipeline to estimate this claim&apos;s value.
                        </p>
                    ))}

                {tab === "draft" &&
                    (latestDraft ? (
                        <div className="space-y-5">
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-400">
                                    Version {latestDraft.version}
                                    {bestDraft && bestDraft.id !== latestDraft.id
                                        ? ` (best-scoring: v${bestDraft.version})`
                                        : ""}
                                </span>
                                {latestDraft.judge_score != null && (
                                    <span
                                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                            latestDraft.judge_score >= 95
                                                ? "bg-green-50 text-green-700"
                                                : "bg-yellow-50 text-yellow-700"
                                        }`}
                                    >
                                        {latestDraft.judge_score}/100
                                    </span>
                                )}
                            </div>
                            <div className="prose prose-sm max-w-none rounded-lg border border-gray-100 p-4">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {latestDraft.content}
                                </ReactMarkdown>
                            </div>
                            {latestDraft.judge_feedback && (
                                <div className="rounded-lg bg-gray-50 p-4">
                                    <h3 className="text-sm font-medium text-gray-800 mb-2">
                                        Internal review feedback
                                    </h3>
                                    <p className="text-sm text-gray-600 mb-2">
                                        {latestDraft.judge_feedback.summary}
                                    </p>
                                    {latestDraft.judge_feedback.required_fixes.length > 0 && (
                                        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                                            {latestDraft.judge_feedback.required_fixes.map(
                                                (f, i) => (
                                                    <li key={i}>{f}</li>
                                                ),
                                            )}
                                        </ul>
                                    )}
                                </div>
                            )}
                            {drafts.length > 1 && (
                                <details className="text-sm">
                                    <summary className="cursor-pointer text-gray-500 hover:text-gray-800">
                                        Iteration history ({drafts.length})
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                        {[...drafts]
                                            .sort((a, b) => a.version - b.version)
                                            .map((d) => (
                                                <div
                                                    key={d.id}
                                                    className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                                                >
                                                    <span className="text-xs text-gray-600">
                                                        Version {d.version} — {d.status}
                                                    </span>
                                                    <span className="text-xs text-gray-400">
                                                        {d.judge_score != null
                                                            ? `${d.judge_score}/100`
                                                            : "—"}
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                </details>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400">
                            No draft yet — run the pipeline to generate the letter before
                            action.
                        </p>
                    ))}

                {tab === "documents" && (
                    <div className="space-y-3">
                        {isOwner && (
                            <label className="flex items-center gap-1.5 w-fit rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors cursor-pointer">
                                <Upload className="h-3.5 w-3.5" />
                                Upload document
                                <input
                                    type="file"
                                    multiple
                                    accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,.txt"
                                    className="hidden"
                                    onChange={handleUpload}
                                />
                            </label>
                        )}
                        {documents.length === 0 ? (
                            <p className="text-sm text-gray-400">No documents attached yet.</p>
                        ) : (
                            <div className="space-y-1.5">
                                {documents.map((d) => (
                                    <div
                                        key={d.id}
                                        className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2"
                                    >
                                        <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                                        <span className="text-sm text-gray-700 truncate flex-1">
                                            {d.filename}
                                        </span>
                                        {isOwner && (
                                            <button
                                                onClick={() => handleDeleteDoc(d.id)}
                                                className="text-gray-400 hover:text-red-600"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === "timeline" && (
                    <div className="space-y-3">
                        {events.length === 0 ? (
                            <p className="text-sm text-gray-400">No activity yet.</p>
                        ) : (
                            [...events].reverse().map((e) => (
                                <div key={e.id} className="flex gap-3 text-sm">
                                    <span className="text-xs text-gray-400 w-32 shrink-0 pt-0.5">
                                        {formatDateTime(e.created_at)}
                                    </span>
                                    <div className="text-gray-600">
                                        <span className="font-medium text-gray-800">
                                            {e.type.replace(/_/g, " ")}
                                        </span>
                                        {e.type === "error" && (
                                            <p className="text-red-600">
                                                {(e.payload as { message?: string }).message}
                                            </p>
                                        )}
                                        {e.type === "judge_score" && (
                                            <p>
                                                Score{" "}
                                                {(e.payload as { score?: number }).score}/100 —{" "}
                                                {(e.payload as { summary?: string }).summary}
                                            </p>
                                        )}
                                        {e.type === "stage_change" && (
                                            <p>
                                                →{" "}
                                                {STAGE_LABELS[
                                                    (e.payload as { stage: keyof typeof STAGE_LABELS })
                                                        .stage
                                                ] ?? String((e.payload as { stage?: string }).stage)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
