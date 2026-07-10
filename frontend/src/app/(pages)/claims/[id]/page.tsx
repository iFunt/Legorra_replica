"use client";

import { use } from "react";
import { ClaimPage } from "@/app/components/claims/ClaimPage";

export default function ClaimDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    return <ClaimPage claimId={id} />;
}
