const path = require("path");
const express = require("express");

const { AnalyticsStore } = require("./lib/analyticsStore");
const { parseDomains, validateDomainSelection } = require("./lib/domainUtils");
const { RunManager } = require("./lib/runManager");

const app = express();
const port = Number(process.env.PORT || 3000);

const analyticsPath = path.join(__dirname, "..", "data", "analytics.ndjson");
const analyticsStore = new AnalyticsStore(analyticsPath);
const runManager = new RunManager(analyticsStore);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));

function sanitizeUserId(value) {
  const userId = String(value || "").trim();
  if (!userId) return null;
  if (userId.length > 128) return null;
  const allowed = /^[A-Za-z0-9._:@-]+$/;
  if (!allowed.test(userId)) return null;
  return userId;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "pricing-page-pdf", timestamp: new Date().toISOString() });
});

app.post("/api/runs", (req, res) => {
  const userId = sanitizeUserId(req.body.user_id);
  if (!userId) {
    return res.status(400).json({
      error: "Поле user_id обязательно. Разрешены символы: буквы, цифры, ., _, :, @, -",
    });
  }

  const { uniqueDomains, invalidTokens, inputCount } = parseDomains(req.body.domains);
  const validation = validateDomainSelection(uniqueDomains);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message, invalid_tokens: invalidTokens });
  }

  const run = runManager.createRun({
    userId,
    domains: uniqueDomains,
    inputCount,
    invalidTokens,
    timeZone: req.body.time_zone,
  });

  return res.status(202).json({
    run_id: run.id,
    status: run.status,
    status_url: `/api/runs/${run.id}/status`,
    download_url: `/api/runs/${run.id}/download`,
    domains_count: run.domains_count,
    invalid_tokens: run.invalid_tokens,
  });
});

app.get("/api/runs/:runId/status", (req, res) => {
  const run = runManager.getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found or expired" });

  return res.json({
    run_id: run.id,
    user_id: run.user_id,
    status: run.status,
    created_at: run.created_at,
    started_at: run.started_at,
    completed_at: run.completed_at,
    progress: run.progress,
    input_count: run.input_count,
    domains_count: run.domains_count,
    domains: run.domains,
    invalid_tokens: run.invalid_tokens,
    summary: run.summary,
    domain_results: run.domain_results,
    error_message: run.error_message,
    download_ready: Boolean(run.pdf_buffer),
  });
});

app.get("/api/runs/:runId/download", (req, res) => {
  const run = runManager.getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found or expired" });
  if (run.status !== "DONE" || !run.pdf_buffer) {
    return res.status(409).json({ error: "PDF is not ready yet" });
  }

  const fileNameSafeDate = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `pricing-report-${run.id.slice(0, 8)}-${fileNameSafeDate}.pdf`;
  runManager.markDownloaded(run.id);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  return res.send(run.pdf_buffer);
});

app.get("/api/analytics/summary", (req, res) => {
  const userId = req.query.user_id ? sanitizeUserId(req.query.user_id) : undefined;
  if (req.query.user_id && !userId) {
    return res.status(400).json({ error: "Invalid user_id" });
  }

  return res.json(analyticsStore.getSummary({ userId }));
});

app.get("/api/analytics/runs", (req, res) => {
  const userId = req.query.user_id ? sanitizeUserId(req.query.user_id) : undefined;
  if (req.query.user_id && !userId) {
    return res.status(400).json({ error: "Invalid user_id" });
  }

  const limitRaw = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

  return res.json({ runs: analyticsStore.listRuns({ userId, limit }) });
});

app.listen(port, () => {
  console.log(`pricing-page-pdf service is running on http://localhost:${port}`);
});
