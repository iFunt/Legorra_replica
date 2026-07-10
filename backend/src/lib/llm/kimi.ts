import type { StreamChatParams, StreamChatResult } from "./types";
import { streamOpenAICompatible, completeOpenAICompatible } from "./openaiCompatible";

// Kimi (Moonshot AI) exposes an OpenAI-compatible chat-completions API.
function config(override?: string | null) {
    return {
        baseURL: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
        apiKey: override?.trim() || process.env.KIMI_API_KEY || "",
    };
}

export async function streamKimi(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    return streamOpenAICompatible(params, config(params.apiKeys?.kimi));
}

export async function completeKimiText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { kimi?: string | null };
}): Promise<string> {
    return completeOpenAICompatible(params, config(params.apiKeys?.kimi));
}
