"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { createPrivacyScan, deletePrivacyScan, listPrivacyScans } from "@/app/lib/mikeApi";
import type { PrivacyScan, ScanStatus } from "@/app/components/privacy-drift/types";

const TERMINAL_STATUSES: ScanStatus[] = ["ready", "error"];

const STATUS_LABEL: Record<ScanStatus, string> = {
    pending: "Queued",
    discovering: "Locating policy…",
    scanning: "Scanning site…",
    analyzing: "Comparing evidence…",
    ready: "Ready",
    error: "Failed",
};

function StatusPill({ status }: { status: ScanStatus }) {
    const isDone = status === "ready";
    const isError = status === "error";
    const cls = isDone
        ? "bg-green-50 text-green-700"
        : isError
          ? "bg-red-50 text-red-700"
          : "bg-gray-100 text-gray-600";
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
            {!isDone && !isError && <Loader2 className="h-3 w-3 animate-spin" />}
            {STATUS_LABEL[status]}
        </span>
    );
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function PrivacyDriftPage() {
    const [scans, setScans] = useState<PrivacyScan[]>([]);
    const [loading, setLoading] = useState(true);
    const [domain, setDomain] = useState("");
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const router = useRouter();

    function refresh() {
        return listPrivacyScans()
            .then(setScans)
            .catch(() => {});
    }

    useEffect(() => {
        refresh().finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const hasActive = scans.some((s) => !TERMINAL_STATUSES.includes(s.status));
        if (hasActive && !pollRef.current) {
            pollRef.current = setInterval(refresh, 4000);
        } else if (!hasActive && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [scans]);

    async function handleCreate() {
        const trimmed = domain.trim();
        if (!trimmed) return;
        setCreating(true);
        setError(null);
        try {
            const scan = await createPrivacyScan(trimmed);
            setDomain("");
            setScans((prev) => [scan, ...prev]);
            router.push(`/privacy-drift/${scan.id}`);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to start scan");
        } finally {
            setCreating(false);
        }
    }

    async function handleDelete(id: string, e: React.MouseEvent) {
        e.stopPropagation();
        setScans((prev) => prev.filter((s) => s.id !== id));
        await deletePrivacyScan(id).catch(() => {});
    }

    return (
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="px-8 py-4">
                <h1 className="text-2xl font-medium font-serif text-gray-900">PrivacyDrift Analyzer</h1>
                <p className="mt-1 text-xs text-gray-500 max-w-2xl">
                    Scans a domain&apos;s live network traffic against its own stated privacy policy and flags
                    contradictions — trackers firing before consent, or data-sharing the policy says doesn&apos;t
                    happen.
                </p>
            </div>

            <div className="px-8 pb-4">
                <div className="flex items-center gap-2 max-w-xl">
                    <input
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                        placeholder="example.com"
                        className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
                    />
                    <button
                        onClick={handleCreate}
                        disabled={creating || !domain.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Scan domain
                    </button>
                </div>
                {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </div>

            <div className="w-full overflow-x-auto px-8">
                {loading ? (
                    <div className="space-y-2 py-4">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-10 rounded bg-gray-50 animate-pulse" />
                        ))}
                    </div>
                ) : scans.length === 0 ? (
                    <div className="flex flex-col items-start py-20 max-w-xs">
                        <ShieldAlert className="h-8 w-8 text-gray-300 mb-4" />
                        <p className="text-2xl font-medium font-serif text-gray-900">No scans yet</p>
                        <p className="mt-1 text-xs text-gray-400">
                            Enter a domain above to compare its privacy policy against what it actually does.
                        </p>
                    </div>
                ) : (
                    <div className="border-t border-gray-100">
                        {scans.map((scan) => (
                            <div
                                key={scan.id}
                                onClick={() => router.push(`/privacy-drift/${scan.id}`)}
                                className="group flex items-center h-14 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate">{scan.domain}</div>
                                    <div className="text-xs text-gray-400">{formatDate(scan.created_at)}</div>
                                </div>
                                <div className="w-44 shrink-0">
                                    <StatusPill status={scan.status} />
                                </div>
                                <div className="w-10 shrink-0 flex justify-end pr-2">
                                    <button
                                        onClick={(e) => handleDelete(scan.id, e)}
                                        className="p-1.5 text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
