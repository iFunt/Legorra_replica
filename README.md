# Mike

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and migrations
- `backend/migrations/000_one_shot_schema.sql` - one-shot Supabase schema for fresh databases
- `backend/src/lib/claims/`, `backend/src/routes/claims.ts` - GDPR claims platform (see below)

## Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run `backend/migrations/000_one_shot_schema.sql` in the Supabase SQL editor for a fresh database
(this already includes the claims platform tables). Existing databases should instead run
`backend/migrations/001_gdpr_claims.sql` followed by `backend/migrations/002_gdpr_kb_seed.sql`
(the seed migration is safe to re-run).

To enable "Continue with Google" sign-in, turn on the Google provider under
Authentication → Providers in your Supabase project, add your OAuth client ID/secret there, and
set the authorized redirect URI to `<your-frontend-url>/auth/callback`.

Start the backend:

```bash
npm run dev --prefix backend
```

Start the frontend:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Required Services

- Supabase Auth and Postgres
- S3-compatible object storage, such as Cloudflare R2
- At least one supported model provider key, depending on which models you enable
- LibreOffice for DOC/DOCX to PDF conversion

## GDPR Claims Platform

A user submits a company name, a short description of the issue, and optional evidence
documents. The system then runs an automated pipeline through a fixed set of stages
(`acknowledged → researching → research_complete → valuation → pre_action_drafting →
internal_review → ready_to_send → sent → resolved`, plus `on_hold` on error):

1. **Research** (`backend/src/lib/claims/companyResearch.ts`) — looks up the company via the
   Companies House API, finds and summarizes its privacy policy, and searches for prior ICO
   enforcement action, all via configurable, gracefully-degrading external lookups.
2. **Valuation** (`claimValuation.ts`) — estimates a compensation range grounded in the
   evidence, the research, and precedents retrieved from the curated GDPR knowledge base
   (`gdpr_kb` table, seeded by `backend/migrations/002_gdpr_kb_seed.sql`).
3. **Drafting + internal auto-test** (`draftLoop.ts`) — a cheaper model drafts the claim
   letter; Claude Opus grades it against a fixed legal/factual/completeness rubric and the
   loop revises until the score reaches 95% confidence or a hard iteration cap, logging every
   round for review.

Every step is checkpointed to `claim_events` (`orchestrator.ts`), which the frontend renders as
a live stage tracker and activity timeline (`/claims`, `/claims/:id`).

Extracted document text (PDF/DOCX/image, including a vision-model pass for images) is cached
per document version (`document_extracts` table) so repeated analysis across stages doesn't
re-run extraction or re-pay for the same content — see `backend/src/lib/claims/documentExtract.ts`.
The judge step also uses Anthropic prompt caching on its large, repeated evidence/research
context across draft iterations.

Optional env vars for full functionality (research degrades gracefully without them — see
`backend/.env.example`): `COMPANIES_HOUSE_API_KEY`, `SEARCH_API_PROVIDER` + `SEARCH_API_KEY`
(+ `SEARCH_API_CX` for Google), and `OPENAI_API_KEY` / `KIMI_API_KEY` if you want to route
cheaper drafting steps to OpenAI or Kimi instead of Gemini.

The seeded GDPR knowledge base contains original reference summaries of UK GDPR/DPA 2018
articles, landmark case law, and ICO enforcement precedents — figures and citations are
best-effort and should be verified against the primary source before relying on them in an
actual claim; the app surfaces this caveat wherever the research/valuation output is shown.

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
