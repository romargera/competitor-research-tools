# Pricing Page Screenshot PDF Service

Web-only self-hosted service based on the `spec-pricing-screenshots-v1-ru.md` specification.

## Features

- Accepts `user_id` and a comma-separated list of domains.
- Deduplicates domains, processes up to 10 unique domains.
- Searches for pricing page via `https://<domain>/pricing` with fallback to `http://<domain>/pricing`.
- Captures 4 screenshots (desktop/mobile viewport + full-page).
- Generates PDF in memory: `1 domain = 1 page`.
- Does not store screenshots or PDFs on the server.
- Writes analytics logs (`user_id`, `domains[]`, `domains_count`, `pdf_status`, etc.) with 90-day retention.

## Quick Start

```bash
npm install
npx playwright install chromium
npm start
```

Open in browser: [http://localhost:3000](http://localhost:3000)

## API Endpoints

- `POST /api/runs` — create a run
- `GET /api/runs/:runId/status` — status and progress
- `GET /api/runs/:runId/download` — download PDF
- `GET /api/analytics/summary` — aggregated analytics
- `GET /api/analytics/runs` — list of runs

## Notes

- Logs are stored in `data/analytics.ndjson`.
- Runs and PDF storage are in-memory at runtime.
- Runs are automatically removed from memory ~20 minutes after completion.
