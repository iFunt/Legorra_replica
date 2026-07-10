import type { ClaimStage } from "@/app/lib/claimsApi";

export const STAGE_ORDER: ClaimStage[] = [
    "acknowledged",
    "researching",
    "research_complete",
    "valuation",
    "pre_action_drafting",
    "internal_review",
    "ready_to_send",
    "sent",
    "resolved",
];

export const STAGE_LABELS: Record<ClaimStage, string> = {
    acknowledged: "Acknowledged",
    researching: "Researching",
    research_complete: "Research complete",
    valuation: "Valuation",
    pre_action_drafting: "Drafting",
    internal_review: "Internal review",
    ready_to_send: "Ready to send",
    sent: "Sent",
    resolved: "Resolved",
    on_hold: "On hold",
};

export function stageBadgeClasses(stage: ClaimStage): string {
    if (stage === "resolved") return "bg-green-50 text-green-700";
    if (stage === "on_hold") return "bg-red-50 text-red-700";
    if (stage === "sent" || stage === "ready_to_send") return "bg-blue-50 text-blue-700";
    if (stage === "internal_review") return "bg-purple-50 text-purple-700";
    return "bg-gray-100 text-gray-600";
}
