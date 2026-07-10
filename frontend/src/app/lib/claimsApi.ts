/**
 * Claims API client — GDPR claims platform endpoints on the Mike backend.
 * Mirrors the request patterns in mikeApi.ts (Bearer token from the
 * Supabase session, raw fetch for the SSE run endpoint).
 */
import { supabase } from "@/lib/supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export type ClaimStage =
    | "acknowledged"
    | "researching"
    | "research_complete"
    | "valuation"
    | "pre_action_drafting"
    | "internal_review"
    | "ready_to_send"
    | "sent"
    | "resolved"
    | "on_hold";

export interface Claim {
    id: string;
    user_id: string;
    project_id: string | null;
    company_name: string;
    company_number: string | null;
    issue_summary: string;
    stage: ClaimStage;
    claim_value_low: number | null;
    claim_value_high: number | null;
    claim_value_currency: string;
    confidence_score: number | null;
    created_at: string;
    updated_at: string;
}

export interface ClaimResearch {
    id: string;
    claim_id: string;
    registered_office: Record<string, unknown> | null;
    sic_codes: string[] | null;
    directors_summary: string | null;
    privacy_policy_url: string | null;
    privacy_policy_summary: string | null;
    ico_fines: { date?: string; amount?: string; notice_url?: string; summary: string }[];
    ico_enforcement_notices: { date?: string; notice_url?: string; summary: string }[];
    sources: { label: string; url?: string }[];
}

export interface ClaimDraft {
    id: string;
    claim_id: string;
    kind: string;
    version: number;
    content: string;
    judge_score: number | null;
    judge_feedback: {
        score: number;
        rubric: { criterion: string; score: number; note: string }[];
        required_fixes: string[];
        summary: string;
    } | null;
    status: "drafting" | "reviewed" | "approved" | "sent";
    created_at: string;
}

export interface ClaimEvent {
    id: string;
    claim_id: string;
    type: string;
    payload: Record<string, unknown>;
    created_at: string;
}

export interface ClaimDocument {
    id: string;
    filename: string;
    file_type: string | null;
    size_bytes: number;
    status: string;
    created_at: string;
}

export interface ClaimDetail {
    claim: Claim;
    research: ClaimResearch | null;
    drafts: ClaimDraft[];
    events: ClaimEvent[];
    documents: ClaimDocument[];
    isOwner: boolean;
    stageLabels: Record<ClaimStage, string>;
}

export type ClaimProgressEvent = {
    stage: ClaimStage | "done" | "error";
    message: string;
    data?: Record<string, unknown>;
};

async function getAuthHeader(): Promise<Record<string, string>> {
    const {
        data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const authHeaders = await getAuthHeader();
    const { headers: initHeaders, ...restInit } = init ?? {};
    const response = await fetch(`${API_BASE}${path}`, {
        cache: "no-store",
        ...restInit,
        headers: {
            Accept: "application/json",
            ...authHeaders,
            ...(initHeaders as Record<string, string> | undefined),
        },
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `API error: ${response.status}`);
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") {
        return undefined as T;
    }
    return (await response.json()) as T;
}

export async function listClaims(): Promise<Claim[]> {
    return apiRequest<Claim[]>("/claims");
}

export async function createClaim(payload: {
    company_name: string;
    issue_summary: string;
    project_id?: string;
}): Promise<Claim> {
    return apiRequest<Claim>("/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function getClaim(claimId: string): Promise<ClaimDetail> {
    return apiRequest<ClaimDetail>(`/claims/${claimId}`);
}

export async function deleteClaim(claimId: string): Promise<void> {
    await apiRequest(`/claims/${claimId}`, { method: "DELETE" });
}

export async function uploadClaimDocument(
    claimId: string,
    file: File,
): Promise<ClaimDocument> {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<ClaimDocument>(`/claims/${claimId}/documents`, {
        method: "POST",
        body: form,
    });
}

export async function deleteClaimDocument(claimId: string, documentId: string): Promise<void> {
    await apiRequest(`/claims/${claimId}/documents/${documentId}`, { method: "DELETE" });
}

export async function streamClaimRun(claimId: string, signal?: AbortSignal): Promise<Response> {
    const authHeaders = await getAuthHeader();
    return fetch(`${API_BASE}/claims/${claimId}/run`, {
        method: "POST",
        headers: { Accept: "text/event-stream", ...authHeaders },
        signal,
    });
}

export async function approveClaim(claimId: string): Promise<void> {
    await apiRequest(`/claims/${claimId}/approve`, { method: "POST" });
}

export async function sendClaim(claimId: string): Promise<void> {
    await apiRequest(`/claims/${claimId}/send`, { method: "POST" });
}

export async function resolveClaim(claimId: string, outcome?: string): Promise<void> {
    await apiRequest(`/claims/${claimId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
    });
}

/** Reads the SSE stream from streamClaimRun(), invoking onEvent per parsed event. */
export async function consumeClaimRunStream(
    response: Response,
    onEvent: (event: ClaimProgressEvent) => void,
): Promise<void> {
    if (!response.body) throw new Error("No response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;
            try {
                onEvent(JSON.parse(dataStr) as ClaimProgressEvent);
            } catch {
                // ignore malformed lines
            }
        }
    }
}
