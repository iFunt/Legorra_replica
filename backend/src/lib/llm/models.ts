import type { Provider } from "./types";

// ---------------------------------------------------------------------------
// Canonical model IDs
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
export const CLAUDE_MAIN_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"] as const;
export const GEMINI_MAIN_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = ["claude-sonnet-4-6"] as const;
export const GEMINI_MID_MODELS = ["gemini-3-flash-preview"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const CLAUDE_LOW_MODELS = ["claude-haiku-4-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-3.1-flash-lite-preview"] as const;

export const DEFAULT_MAIN_MODEL = "gemini-3-flash-preview";
export const DEFAULT_TITLE_MODEL = "gemini-3.1-flash-lite-preview";
export const DEFAULT_TABULAR_MODEL = "gemini-3-flash-preview";

// Models available to the GDPR claims pipeline (backend/src/lib/claims/*),
// which routes work by cost/reasoning tier rather than through the
// user-facing chat model picker. Any user-supplied OpenAI/Kimi API key
// (see UserApiKeys) unlocks these.
export const OPENAI_MODELS = ["gpt-5.1", "gpt-5.1-mini"] as const;
export const KIMI_MODELS = ["kimi-k2"] as const;

// The advanced-reasoning "judge" model for the claim drafting loop
// (backend/src/lib/claims/draftLoop.ts) — deliberately the strongest
// available model, since it grades legal/factual accuracy.
export const CLAIM_JUDGE_MODEL = "claude-opus-4-7";
// Cheaper default for drafting iterations and simple extraction sub-tasks.
export const CLAIM_DRAFTER_MODEL = "gemini-3-flash-preview";

const ALL_MODELS = new Set<string>([
    ...CLAUDE_MAIN_MODELS,
    ...GEMINI_MAIN_MODELS,
    ...CLAUDE_MID_MODELS,
    ...GEMINI_MID_MODELS,
    ...CLAUDE_LOW_MODELS,
    ...GEMINI_LOW_MODELS,
]);

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

export function providerForModel(model: string): Provider {
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("kimi") || model.startsWith("moonshot")) return "kimi";
    if (
        model.startsWith("gpt") ||
        model.startsWith("o1") ||
        model.startsWith("o3") ||
        model.startsWith("o4") ||
        model.startsWith("chatgpt")
    )
        return "openai";
    throw new Error(`Unknown model id: ${model}`);
}

export function resolveModel(id: string | null | undefined, fallback: string): string {
    if (id && ALL_MODELS.has(id)) return id;
    return fallback;
}
