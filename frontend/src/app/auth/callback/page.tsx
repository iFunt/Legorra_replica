"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { SiteLogo } from "@/components/site-logo";

// Landing point for the Google OAuth redirect (see google-auth-button.tsx).
// supabase-js defaults to the PKCE flow for OAuth, which lands here with a
// `?code=` query param that must be exchanged for a session client-side —
// there is no server-side cookie session in this app (API calls carry a
// Bearer token instead), so this stays a plain client component rather
// than a route handler.
export default function AuthCallbackPage() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const run = async () => {
            const url = new URL(window.location.href);
            const code = url.searchParams.get("code");

            try {
                if (code) {
                    const { error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) throw error;
                } else {
                    // Implicit flow (tokens in the URL hash) — the client
                    // already parsed this on load via detectSessionInUrl.
                    const { data } = await supabase.auth.getSession();
                    if (!data.session) throw new Error("No session found after redirect.");
                }
                router.replace("/assistant");
            } catch (err) {
                setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
            }
        };
        run();
    }, [router]);

    return (
        <div className="min-h-dvh bg-white flex flex-col items-center justify-center gap-4 px-6">
            <SiteLogo size="md" asLink={false} />
            {error ? (
                <div className="text-center">
                    <p className="text-red-600 text-sm mb-3">{error}</p>
                    <a href="/login" className="text-sm text-blue-600 hover:underline">
                        Back to login
                    </a>
                </div>
            ) : (
                <p className="text-gray-500 text-sm">Signing you in...</p>
            )}
        </div>
    );
}
