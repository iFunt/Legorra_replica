import type { StreamChatParams, StreamChatResult } from "./types";
import { streamOpenAICompatible, completeOpenAICompatible } from "./openaiCompatible";

function config(override?: string | null) {
    return {
        baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: override?.trim() || process.env.OPENAI_API_KEY || "",
    };
}

export async function streamOpenAI(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    return streamOpenAICompatible(params, config(params.apiKeys?.openai));
}

export async function completeOpenAIText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: { openai?: string | null };
}): Promise<string> {
    return completeOpenAICompatible(params, config(params.apiKeys?.openai));
}
