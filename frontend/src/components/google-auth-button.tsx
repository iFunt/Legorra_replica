"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

function GoogleIcon() {
    return (
        <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
            <path
                fill="#FFC107"
                d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.7-.4-3.5z"
            />
            <path
                fill="#FF3D00"
                d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3c-7.7 0-14.4 4.4-17.7 11.7z"
            />
            <path
                fill="#4CAF50"
                d="M24 45c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 36 26.9 37 24 37c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 40.6 16.2 45 24 45z"
            />
            <path
                fill="#1976D2"
                d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.6l6.6 5.6C41.6 36.4 44 30.7 44 24c0-1.4-.1-2.7-.4-3.5z"
            />
        </svg>
    );
}

export function GoogleAuthButton({ label = "Continue with Google" }: { label?: string }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClick = async () => {
        setLoading(true);
        setError(null);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                },
            });
            if (error) throw error;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to start Google sign-in");
            setLoading(false);
        }
    };

    return (
        <div>
            <Button
                type="button"
                variant="outline"
                onClick={handleClick}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2"
            >
                <GoogleIcon />
                {loading ? "Redirecting..." : label}
            </Button>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
    );
}
