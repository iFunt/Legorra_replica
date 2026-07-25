# Mike

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and migrations
- `backend/migrations/000_one_shot_schema.sql` - one-shot Supabase schema for fresh databases

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

Run `backend/migrations/000_one_shot_schema.sql` in the Supabase SQL editor for a fresh database.

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
- Chromium (via Playwright) for the PrivacyDrift Analyzer scanner — see below

## PrivacyDrift Analyzer

Compares a target domain's stated privacy policy against the actual
third-party requests its site makes, under three cookie-consent states
(accept all / reject all / ignore), and flags contradictions with a
regulatory-risk tag and evidence PDF. Code lives under
`backend/src/lib/privacyDrift/` and `backend/src/routes/privacyDrift.ts`;
schema is `backend/migrations/001_privacy_drift.sql`.

The scanner needs a Chromium binary:

```bash
npx playwright install chromium
```

This runs automatically via the backend's `postinstall` script on `npm install`.
On Nix-based deployments (see `backend/nixpacks.toml`), set
`PLAYWRIGHT_BROWSERS_PATH` to the `playwright-driver.browsers` store path and
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` instead of downloading at build time.

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
