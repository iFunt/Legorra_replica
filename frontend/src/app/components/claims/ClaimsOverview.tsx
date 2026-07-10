"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Scale } from "lucide-react";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { listClaims, type Claim } from "@/app/lib/claimsApi";
import { NewClaimModal } from "./NewClaimModal";
import { STAGE_LABELS, stageBadgeClasses } from "./stageMeta";

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function formatValue(claim: Claim): string {
    if (claim.claim_value_low == null || claim.claim_value_high == null) return "—";
    const fmt = (n: number) =>
        new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: claim.claim_value_currency || "GBP",
            maximumFractionDigits: 0,
        }).format(n);
    if (claim.claim_value_low === claim.claim_value_high) return fmt(claim.claim_value_low);
    return `${fmt(claim.claim_value_low)} – ${fmt(claim.claim_value_high)}`;
}

export function ClaimsOverview() {
    const [claims, setClaims] = useState<Claim[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [search, setSearch] = useState("");
    const router = useRouter();

    useEffect(() => {
        listClaims()
            .then(setClaims)
            .catch(() => setClaims([]))
            .finally(() => setLoading(false));
    }, []);

    const q = search.toLowerCase();
    const filtered = claims.filter(
        (c) => !q || c.company_name.toLowerCase().includes(q),
    );

    return (
        <div className="flex-1 overflow-y-auto bg-white">
            <div className="flex items-center justify-between px-8 py-4">
                <h1 className="text-2xl font-medium font-serif text-gray-900">
                    GDPR Claims
                </h1>
                <div className="flex items-center gap-2">
                    <HeaderSearchBtn
                        value={search}
                        onChange={setSearch}
                        placeholder="Search claims…"
                    />
                    <button
                        onClick={() => setModalOpen(true)}
                        className="flex items-center justify-center p-1.5 text-gray-500 hover:text-gray-900 transition-colors"
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="w-full overflow-x-auto">
                <div className="min-w-max">
                    <div className="flex items-center h-8 px-8 border-b border-gray-200 text-xs text-gray-500 font-medium select-none">
                        <div className="w-[280px] shrink-0 text-left">Company</div>
                        <div className="w-40 shrink-0 text-left">Stage</div>
                        <div className="w-44 shrink-0 text-left">Estimated value</div>
                        <div className="w-28 shrink-0 text-left">Confidence</div>
                        <div className="w-32 shrink-0 text-left">Created</div>
                    </div>

                    {loading ? (
                        <div>
                            {[1, 2, 3].map((i) => (
                                <div
                                    key={i}
                                    className="flex items-center h-10 px-8 border-b border-gray-50"
                                >
                                    <div className="w-[280px] shrink-0">
                                        <div className="h-3.5 w-40 rounded bg-gray-100 animate-pulse" />
                                    </div>
                                    <div className="w-40 shrink-0">
                                        <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-start py-24 w-full max-w-xs mx-auto">
                            <Scale className="h-8 w-8 text-gray-300 mb-4" />
                            <p className="text-2xl font-medium font-serif text-gray-900">
                                GDPR Claims
                            </p>
                            <p className="mt-1 text-xs text-gray-400 max-w-xs">
                                Start a claim with a company name and a short description of
                                what happened — the system researches the company and drafts
                                your correspondence automatically.
                            </p>
                            <button
                                onClick={() => setModalOpen(true)}
                                className="mt-4 inline-flex items-center gap-1 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 transition-colors shadow-md"
                            >
                                + New claim
                            </button>
                        </div>
                    ) : (
                        <div>
                            {filtered.map((claim) => (
                                <div
                                    key={claim.id}
                                    onClick={() => router.push(`/claims/${claim.id}`)}
                                    className="group flex items-center h-10 px-8 border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                                >
                                    <div className="w-[280px] shrink-0 pr-4">
                                        <span className="text-sm text-gray-800 truncate block">
                                            {claim.company_name}
                                        </span>
                                    </div>
                                    <div className="w-40 shrink-0">
                                        <span
                                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${stageBadgeClasses(claim.stage)}`}
                                        >
                                            {STAGE_LABELS[claim.stage]}
                                        </span>
                                    </div>
                                    <div className="w-44 shrink-0 text-sm text-gray-500">
                                        {formatValue(claim)}
                                    </div>
                                    <div className="w-28 shrink-0 text-sm text-gray-500">
                                        {claim.confidence_score != null
                                            ? `${Math.round(claim.confidence_score)}%`
                                            : "—"}
                                    </div>
                                    <div className="w-32 shrink-0 text-sm text-gray-500">
                                        {formatDate(claim.created_at)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <NewClaimModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onCreated={(c) => {
                    setClaims((prev) => [c, ...prev]);
                    router.push(`/claims/${c.id}`);
                }}
            />
        </div>
    );
}
