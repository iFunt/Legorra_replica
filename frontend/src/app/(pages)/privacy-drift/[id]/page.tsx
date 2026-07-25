"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, Loader2 } from "lucide-react";
import { downloadPrivacyScanReport, getPrivacyScan } from "@/app/lib/mikeApi";
import type {
    DiscrepancyFlag,
    PrivacyScanDetail,
    ScanStatus,
    Severity,
} from "@/app/components/privacy-drift/types";

const TERMINAL_STATUSES: ScanStatus[] = ["ready", "error"];

const SEVERITY_STYLE: Record<Severity, string> = {
    HIGH: "bg-red-50 text-red-700 border-red-100",
    MEDIUM: "bg-amber-50 text-amber-700 border-amber-100",
    LOW: "bg-gray-50 text-gray-600 border-gray-100",
};

function SeverityBadge({ severity }: { severity: Severity }) {
    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLE[severity]}`}>
            {severity}
        </span>
    );
}

function FlagRow({ flag }: { flag: DiscrepancyFlag }) {
    return (
        <div className="border-b border-gray-50 py-3">
            <div className="flex items-center gap-2 mb-1">
                <SeverityBadge severity={flag.severity} />
                {flag.potential_claim_value != null && (
                    <span className="text-xs text-gray-400">est. £{flag.potential_claim_value}</span>
                )}
            </div>
            <p className="text-sm text-gray-800">{flag.violation_summary}</p>
            {flag.regulatory_flags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {flag.regulatory_flags.map((r) => (
                        <span key={r} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
                            {r}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function PrivacyScanDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [detail, setDetail] = useState<PrivacyScanDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [tab, setTab] = useState<"flags" | "commitments" | "evidence">("flags");
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    function refresh() {
        return getPrivacyScan(params.id)
            .then(setDetail)
            .catch(() => {});
    }

    useEffect(() => {
        refresh().finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id]);

    useEffect(() => {
        const status = detail?.scan.status;
        const active = status && !TERMINAL_STATUSES.includes(status);
        if (active && !pollRef.current) {
            pollRef.current = setInterval(refresh, 3000);
        } else if (!active && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail?.scan.status]);

    async function handleDownload() {
        if (!detail) return;
        setDownloading(true);
        try {
            const blob = await downloadPrivacyScanReport(detail.scan.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `privacydrift-${detail.scan.domain}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } finally {
            setDownloading(false);
        }
    }

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
        );
    }
    if (!detail) {
        return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Scan not found</div>;
    }

    const { scan, commitments, evidence, flags } = detail;
    const isReady = scan.status === "ready";
    const isError = scan.status === "error";
    const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of flags) bySeverity[f.severity]++;

    return (
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="px-8 py-4">
                <button
                    onClick={() => router.push("/privacy-drift")}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 mb-3"
                >
                    <ArrowLeft className="h-3.5 w-3.5" /> All scans
                </button>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-medium font-serif text-gray-900">{scan.domain}</h1>
                        {scan.privacy_policy_url && (
                            <a
                                href={scan.privacy_policy_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 mt-1"
                            >
                                {scan.privacy_policy_url} <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                    </div>
                    <button
                        onClick={handleDownload}
                        disabled={!isReady || downloading}
                        className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        Evidence report (PDF)
                    </button>
                </div>

                {!isReady && !isError && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Scan in progress ({scan.status}) — this page updates automatically.
                    </div>
                )}
                {isError && (
                    <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                        Scan failed: {scan.error_message ?? "Unknown error"}
                    </div>
                )}

                {isReady && (
                    <div className="mt-4 flex items-center gap-4 text-sm">
                        <span className="text-gray-500">
                            <span className="font-semibold text-red-600">{bySeverity.HIGH}</span> high
                        </span>
                        <span className="text-gray-500">
                            <span className="font-semibold text-amber-600">{bySeverity.MEDIUM}</span> medium
                        </span>
                        <span className="text-gray-500">
                            <span className="font-semibold text-gray-500">{bySeverity.LOW}</span> low
                        </span>
                    </div>
                )}
            </div>

            <div className="px-8 border-b border-gray-100 flex gap-6 text-sm">
                {(["flags", "commitments", "evidence"] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`pb-2 border-b-2 transition-colors capitalize ${
                            tab === t ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-400 hover:text-gray-600"
                        }`}
                    >
                        {t === "flags" ? `Discrepancy Flags (${flags.length})` : t === "commitments" ? `Policy Commitments (${commitments.length})` : `Technical Evidence (${evidence.length})`}
                    </button>
                ))}
            </div>

            <div className="px-8 py-4 pb-16">
                {tab === "flags" &&
                    (flags.length === 0 ? (
                        <p className="text-sm text-gray-400 py-8">
                            {isReady ? "No discrepancies detected." : "Flags will appear here once the scan finishes."}
                        </p>
                    ) : (
                        <div>{flags.map((f) => <FlagRow key={f.id} flag={f} />)}</div>
                    ))}

                {tab === "commitments" &&
                    (commitments.length === 0 ? (
                        <p className="text-sm text-gray-400 py-8">No machine-readable commitments extracted.</p>
                    ) : (
                        <div className="space-y-3">
                            {commitments.map((c) => (
                                <div key={c.id} className="border-b border-gray-50 pb-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500">
                                            {c.clause_type}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            {c.rule_key} = {c.machine_rule ? "true" : "false"}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-700 italic">&ldquo;{c.extracted_text}&rdquo;</p>
                                </div>
                            ))}
                        </div>
                    ))}

                {tab === "evidence" &&
                    (evidence.length === 0 ? (
                        <p className="text-sm text-gray-400 py-8">No third-party trackers captured.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                                        <th className="py-2 pr-4 font-medium">Consent</th>
                                        <th className="py-2 pr-4 font-medium">Tracker</th>
                                        <th className="py-2 pr-4 font-medium">Type</th>
                                        <th className="py-2 pr-4 font-medium">Data indicators</th>
                                        <th className="py-2 font-medium">Request</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {evidence.map((e) => (
                                        <tr key={e.id} className="border-b border-gray-50">
                                            <td className="py-2 pr-4 text-gray-600">{e.consent_state}</td>
                                            <td className="py-2 pr-4 text-gray-800">
                                                {e.tracker_owner ?? e.tracker_domain}
                                                <span className="text-gray-400"> ({e.tracker_category})</span>
                                            </td>
                                            <td className="py-2 pr-4 text-gray-600">{e.payload_type}</td>
                                            <td className="py-2 pr-4 text-gray-500">{e.data_transmitted}</td>
                                            <td className="py-2 text-gray-400 truncate max-w-xs">{e.request_url}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
            </div>
        </div>
    );
}
