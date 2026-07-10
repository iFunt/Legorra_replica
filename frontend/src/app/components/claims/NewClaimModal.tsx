"use client";

import { useRef, useState } from "react";
import { X, Upload, FileText } from "lucide-react";
import { createClaim, uploadClaimDocument, type Claim } from "@/app/lib/claimsApi";

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: (claim: Claim) => void;
}

export function NewClaimModal({ open, onClose, onCreated }: Props) {
    const [companyName, setCompanyName] = useState("");
    const [issueSummary, setIssueSummary] = useState("");
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!open) return null;

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (!files.length) return;
        setPendingFiles((prev) => [
            ...prev,
            ...files.filter((f) => !prev.some((p) => p.name === f.name)),
        ]);
    }

    function removeFile(name: string) {
        setPendingFiles((prev) => prev.filter((f) => f.name !== name));
    }

    function resetForm() {
        setCompanyName("");
        setIssueSummary("");
        setPendingFiles([]);
        setError("");
    }

    function handleClose() {
        resetForm();
        onClose();
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!companyName.trim() || !issueSummary.trim()) return;
        setLoading(true);
        setError("");
        try {
            const claim = await createClaim({
                company_name: companyName.trim(),
                issue_summary: issueSummary.trim(),
            });
            await Promise.all(
                pendingFiles.map((f) => uploadClaimDocument(claim.id, f).catch(() => {})),
            );
            onCreated(claim);
            resetForm();
            onClose();
        } catch (err: unknown) {
            setError((err as Error).message || "Failed to create claim");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="fixed inset-0 z-101 flex items-center justify-center bg-black/20 backdrop-blur-xs">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[85vh]">
                <div className="flex items-center justify-between px-6 pt-5 pb-2">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span>Claims</span>
                        <span>›</span>
                        <span>New claim</span>
                    </div>
                    <button
                        onClick={handleClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                    <div className="px-6 pt-3 pb-5 flex-1 overflow-y-auto">
                        <input
                            type="text"
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            placeholder="Company name"
                            className="w-full text-2xl font-serif text-gray-800 placeholder-gray-300 focus:outline-none bg-transparent"
                            autoFocus
                        />

                        <textarea
                            value={issueSummary}
                            onChange={(e) => setIssueSummary(e.target.value)}
                            placeholder="Describe what happened — e.g. 'I submitted a subject access request and their response was incomplete, so I can't verify how they assessed my affordability. This has caused me a lot of distress...'"
                            rows={6}
                            className="mt-3 w-full resize-none text-sm text-gray-700 placeholder-gray-300 focus:outline-none bg-transparent leading-relaxed"
                        />

                        {pendingFiles.length > 0 && (
                            <div className="mt-4 space-y-1.5">
                                <p className="text-xs font-medium text-gray-700">
                                    Documents to attach
                                </p>
                                {pendingFiles.map((f) => (
                                    <div
                                        key={f.name}
                                        className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs text-gray-600"
                                    >
                                        <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                        <span className="truncate flex-1">{f.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeFile(f.name)}
                                            className="text-gray-400 hover:text-gray-700"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
                    </div>

                    <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4 shrink-0">
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,.txt"
                                className="hidden"
                                onChange={handleFileChange}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
                            >
                                <Upload className="h-3.5 w-3.5" />
                                Attach documents
                                {pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ""}
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleClose}
                                className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!companyName.trim() || !issueSummary.trim() || loading}
                                className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
                            >
                                {loading ? "Creating…" : "Create claim"}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
