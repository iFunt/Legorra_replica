// Generic client for OpenAI-compatible chat-completions APIs (OpenAI itself,
// and any provider that mirrors the same wire format — e.g. Kimi/Moonshot).
// Tool schemas are already OpenAI-style in this codebase (see types.ts), so
// no per-provider conversion is needed here, unlike claude.ts/gemini.ts.
import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
} from "./types";

export type OpenAICompatibleConfig = {
    baseURL: string;
    apiKey: string;
};

type ToolCallAccumulator = {
    id?: string;
    name?: string;
    arguments: string;
};

type NativeMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content?: string;
    tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }[];
    tool_call_id?: string;
};

function toNativeMessages(
    systemPrompt: string,
    messages: StreamChatParams["messages"],
): NativeMessage[] {
    return [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        })),
    ];
}

async function readSseStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (data: string) => void,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            onEvent(data);
        }
    }
}

export async function streamOpenAICompatible(
    params: StreamChatParams,
    config: OpenAICompatibleConfig,
): Promise<StreamChatResult> {
    const { model, systemPrompt, tools = [], callbacks = {}, runTools } = params;
    const maxIter = params.maxIterations ?? 10;

    const messages: NativeMessage[] = toNativeMessages(
        systemPrompt,
        params.messages,
    );
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const resp = await fetch(`${config.baseURL}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                tools: tools.length ? tools : undefined,
            }),
        });

        if (!resp.ok || !resp.body) {
            const errText = await resp.text().catch(() => resp.statusText);
            throw new Error(
                `OpenAI-compatible provider error (${resp.status}): ${errText}`,
            );
        }

        let turnText = "";
        const toolCallAcc = new Map<number, ToolCallAccumulator>();

        await readSseStream(resp.body, (data) => {
            let parsed: {
                choices?: {
                    delta?: {
                        content?: string;
                        tool_calls?: {
                            index: number;
                            id?: string;
                            function?: { name?: string; arguments?: string };
                        }[];
                    };
                    finish_reason?: string | null;
                }[];
            };
            try {
                parsed = JSON.parse(data);
            } catch {
                return;
            }
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) return;
            if (delta.content) {
                turnText += delta.content;
                callbacks.onContentDelta?.(delta.content);
            }
            for (const tc of delta.tool_calls ?? []) {
                const acc = toolCallAcc.get(tc.index) ?? { arguments: "" };
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                toolCallAcc.set(tc.index, acc);
            }
        });

        fullText += turnText;

        const toolCalls: NormalizedToolCall[] = [...toolCallAcc.values()]
            .filter((c) => c.name)
            .map((c, i) => {
                let input: Record<string, unknown> = {};
                try {
                    input = c.arguments ? JSON.parse(c.arguments) : {};
                } catch {
                    input = {};
                }
                const call: NormalizedToolCall = {
                    id: c.id ?? `${c.name}-${i}`,
                    name: c.name as string,
                    input,
                };
                callbacks.onToolCallStart?.(call);
                return call;
            });

        if (!toolCalls.length || !runTools) break;

        const results = await runTools(toolCalls);

        messages.push({
            role: "assistant",
            content: turnText || undefined,
            tool_calls: toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
        });
        for (const r of results) {
            messages.push({
                role: "tool",
                tool_call_id: r.tool_use_id,
                content: r.content,
            });
        }
    }

    return { fullText };
}

export async function completeOpenAICompatible(
    params: {
        model: string;
        systemPrompt?: string;
        user: string;
        maxTokens?: number;
    },
    config: OpenAICompatibleConfig,
): Promise<string> {
    const messages: NativeMessage[] = [
        ...(params.systemPrompt
            ? [{ role: "system" as const, content: params.systemPrompt }]
            : []),
        { role: "user", content: params.user },
    ];
    const resp = await fetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: params.model,
            messages,
            max_tokens: params.maxTokens ?? 512,
        }),
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(
            `OpenAI-compatible provider error (${resp.status}): ${errText}`,
        );
    }
    const json = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content ?? "";
}
