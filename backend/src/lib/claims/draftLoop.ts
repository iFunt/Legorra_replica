// Iterative drafter → judge loop: this is the "internal auto-test with a
// more advanced reasoning model" the pipeline runs before a draft is shown
// to the user. A cheaper model (CLAIM_DRAFTER_MODEL, configurable) writes/
// revises the claim letter; Claude Opus (CLAIM_JUDGE_MODEL — the strongest
// available reasoning model) grades it against a fixed rubric and returns
// itemized required fixes. The loop revises until the judge's score
// reaches the confidence threshold or a hard iteration cap is hit, logging
// every round to `claim_drafts` + `claim_events` for the frontend timeline.
//
// Token optimization: the judge is called every iteration with the same
// large static context (evidence, research, valuation, KB precedents).
// That block is sent with Anthropic prompt caching (`cache_control:
// ephemeral`) so iterations 2+ read it at a fraction of the token cost
// instead of re-billing the full context every round.
import Anthropic from "@anthropic-ai/sdk";
import { completeText } from "../llm";
import { CLAIM_DRAFTER_MODEL, CLAIM_JUDGE_MODEL } from "../llm/models";
import type { createServerSupabase } from "../supabase";
import { logClaimEvent } from "./stageMachine";
import { formatKbForPrompt, type KbEntry } from "./kbRetrieval";
import type { ClaimValuation, DraftKind, JudgeFeedback } from "./types";
import type { CompanyResearchResult } from "./companyResearch";

type Db = ReturnType<typeof createServerSupabase>;

export const MAX_DRAFT_ITERATIONS = 6;
export const CONFIDENCE_THRESHOLD = 95;

const DRAFT_KIND_LABEL: Record<DraftKind, string> = {
    dsar_followup: "DSAR follow-up / chase letter",
    letter_before_action: "Letter Before Action (pre-action data protection claim)",
    particulars_of_claim: "Particulars of Claim (small claims track)",
};

export type DraftLoopContext = {
    companyName: string;
    issueSummary: string;
    research: CompanyResearchResult | null;
    valuation: ClaimValuation | null;
    documentExtracts: { filename: string; text: string }[];
    kbEntries: KbEntry[];
};

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n[...truncated, ${text.length - max} more characters...]`;
}

function buildStaticContextBlock(kind: DraftKind, ctx: DraftLoopContext): string {
    const evidence = ctx.documentExtracts.length
        ? ctx.documentExtracts
              .map((d) => `### ${d.filename}\n${truncate(d.text, 8000)}`)
              .join("\n\n")
        : "No evidence documents were provided.";
    const research = ctx.research
        ? [
              ctx.research.privacy_policy_summary
                  ? `Privacy policy summary: ${ctx.research.privacy_policy_summary}`
                  : null,
              ctx.research.ico_fines.length
                  ? `Prior ICO fines: ${JSON.stringify(ctx.research.ico_fines)}`
                  : null,
              ctx.research.ico_enforcement_notices.length
                  ? `Prior ICO enforcement notices: ${JSON.stringify(ctx.research.ico_enforcement_notices)}`
                  : null,
          ]
              .filter(Boolean)
              .join("\n")
        : "No company research available.";
    const valuation = ctx.valuation
        ? `Estimated claim value: ${ctx.valuation.currency} ${ctx.valuation.low}-${ctx.valuation.high}. Basis: ${ctx.valuation.basis}`
        : "No claim valuation available yet.";

    return [
        `Document type to produce: ${DRAFT_KIND_LABEL[kind]}`,
        `Company: ${ctx.companyName}`,
        `Customer's account of the issue:\n${ctx.issueSummary}`,
        `Company research:\n${research}`,
        `Claim valuation:\n${valuation}`,
        `Evidence documents:\n${evidence}`,
        `Relevant GDPR knowledge-base precedents (cite the ones you rely on by name/citation):\n${formatKbForPrompt(ctx.kbEntries)}`,
    ].join("\n\n");
}

function parseJsonLoose<T>(raw: string): T | null {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : raw;
    try {
        return JSON.parse(candidate.trim()) as T;
    } catch {
        return null;
    }
}

async function draftOrRevise(
    kind: DraftKind,
    staticContext: string,
    previous: { content: string; feedback: JudgeFeedback } | null,
): Promise<string> {
    const instructions = previous
        ? [
              "You previously drafted the letter below. A reviewer scored it " +
                  `${previous.feedback.score}/100 and required the following fixes:\n` +
                  previous.feedback.required_fixes.map((f) => `- ${f}`).join("\n"),
              `Previous draft:\n${previous.content}`,
              "Revise the letter to address every required fix while preserving what already worked. " +
                  "Output ONLY the revised letter text (markdown), no commentary.",
          ].join("\n\n")
        : "Draft the letter now. Output ONLY the letter text (markdown), no commentary.";

    const prompt = `${staticContext}\n\n${instructions}`;

    return completeText({
        model: CLAIM_DRAFTER_MODEL,
        systemPrompt:
            "You are a UK GDPR claims caseworker drafting formal correspondence on behalf " +
            "of a data subject. Ground every factual claim in the evidence and research " +
            "provided — never invent dates, amounts, or events. Write in a firm, " +
            "professional tone that accurately conveys the customer's evidenced distress " +
            "without exaggeration. Cite specific UK GDPR articles / DPA 2018 sections and " +
            "the knowledge-base precedents where relevant.",
        user: prompt,
        maxTokens: 3000,
    });
}

async function judgeDraftWithClaude(
    staticContext: string,
    draftContent: string,
    version: number,
): Promise<JudgeFeedback> {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    const anthropic = new Anthropic({ apiKey });

    const rubricInstructions =
        "You are the senior reviewer auto-testing a junior caseworker's draft GDPR claim " +
        "letter before it reaches a human. Score it against this rubric (each 0-20, total " +
        "out of 100):\n" +
        "1. Legal grounding — correct statute/article and case-law citations, properly applied.\n" +
        "2. Factual grounding — every factual claim traces to the evidence/research provided; no invented facts.\n" +
        "3. Completeness — includes required elements: dates, controller name, specific breach description, " +
        "statutory basis, remedy/compensation sought, and a clear deadline for response.\n" +
        "4. Distress articulation — accurately and proportionately conveys the customer's evidenced distress " +
        "(per the de-minimis and aggravating-factors guidance), without exaggeration or unsupported claims.\n" +
        "5. Tone and structure — professional, clear, appropriately firm.\n\n" +
        `Draft under review (version ${version}):\n${draftContent}\n\n` +
        "Return ONLY a JSON object of this exact shape:\n" +
        "{\n" +
        '  "score": number,  // 0-100, sum of the 5 rubric scores\n' +
        '  "rubric": [{ "criterion": string, "score": number, "note": string }],\n' +
        '  "required_fixes": string[],  // specific, actionable — empty if score >= 95\n' +
        '  "summary": string\n' +
        "}";

    const resp = await anthropic.messages.create({
        model: CLAIM_JUDGE_MODEL,
        max_tokens: 2000,
        system:
            "You are a rigorous, skeptical legal reviewer. Be strict — a score of 95+ " +
            "should be rare and only given to a letter you would let go out under your " +
            "own name with no further changes. Output strict JSON only.",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: staticContext,
                        // Reused verbatim across every iteration of this claim's
                        // draft loop — cache it so re-grading a revision doesn't
                        // re-bill the full evidence/research/KB context.
                        cache_control: { type: "ephemeral" },
                    },
                    { type: "text", text: rubricInstructions },
                ],
            },
        ],
    });

    const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    const parsed = parseJsonLoose<JudgeFeedback>(text);
    if (parsed && typeof parsed.score === "number") return parsed;

    return {
        score: 0,
        rubric: [],
        required_fixes: ["Judge response could not be parsed — retry required."],
        summary: "Automatic grading failed to return valid JSON.",
    };
}

export type DraftLoopResult = {
    draftId: string;
    finalScore: number;
    iterations: number;
    reachedThreshold: boolean;
};

export async function runDraftLoop(
    db: Db,
    claimId: string,
    kind: DraftKind,
    ctx: DraftLoopContext,
): Promise<DraftLoopResult> {
    const staticContext = buildStaticContextBlock(kind, ctx);

    let content = "";
    let feedback: JudgeFeedback | null = null;
    let draftId = "";
    let version = 0;

    for (let i = 1; i <= MAX_DRAFT_ITERATIONS; i++) {
        version = i;
        content = await draftOrRevise(
            kind,
            staticContext,
            feedback ? { content, feedback } : null,
        );

        const { data: draftRow } = await db
            .from("claim_drafts")
            .insert({ claim_id: claimId, kind, version, content, status: "drafting" })
            .select("id")
            .single();
        draftId = draftRow?.id as string;

        await logClaimEvent(db, claimId, "draft_iteration", {
            version,
            kind,
            draft_id: draftId,
        });

        feedback = await judgeDraftWithClaude(staticContext, content, version);
        const passed = feedback.score >= CONFIDENCE_THRESHOLD;

        await db
            .from("claim_drafts")
            .update({
                judge_score: feedback.score,
                judge_feedback: feedback,
                status: passed ? "reviewed" : "drafting",
            })
            .eq("id", draftId);

        await logClaimEvent(db, claimId, "judge_score", {
            version,
            draft_id: draftId,
            score: feedback.score,
            summary: feedback.summary,
        });

        if (passed) {
            return { draftId, finalScore: feedback.score, iterations: version, reachedThreshold: true };
        }
    }

    return {
        draftId,
        finalScore: feedback?.score ?? 0,
        iterations: version,
        reachedThreshold: false,
    };
}
