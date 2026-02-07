const { v4: uuidv4 } = require("uuid");
const { generateReport, isValidTimeZone } = require("./captureService");

const RUN_TTL_MS = 20 * 60 * 1000;

class RunManager {
  constructor(analyticsStore) {
    this.analyticsStore = analyticsStore;
    this.runs = new Map();
  }

  createRun({ userId, domains, inputCount, invalidTokens, timeZone }) {
    const runId = uuidv4();
    const createdAt = new Date().toISOString();

    const run = {
      id: runId,
      user_id: userId,
      status: "QUEUED",
      created_at: createdAt,
      started_at: null,
      completed_at: null,
      progress: {
        total: domains.length,
        processed: 0,
        current_domain: null,
      },
      input_count: inputCount,
      domains_count: domains.length,
      domains,
      invalid_tokens: invalidTokens,
      time_zone: isValidTimeZone(timeZone) ? timeZone : "UTC",
      summary: null,
      domain_results: [],
      pdf_buffer: null,
      error_message: null,
      download_count: 0,
    };

    this.runs.set(runId, run);
    this.executeRun(run).catch((error) => {
      run.status = "FAILED";
      run.completed_at = new Date().toISOString();
      run.error_message = String(error && error.message ? error.message : error || "Run failed");
      run.summary = {
        domains_total: run.domains_count,
        domains_success: 0,
        domains_failed: run.domains_count,
        pdf_status: "fail",
      };
      this.logRun(run);
      this.scheduleCleanup(runId);
    });

    return run;
  }

  getRun(runId) {
    return this.runs.get(runId);
  }

  scheduleCleanup(runId) {
    setTimeout(() => {
      const run = this.runs.get(runId);
      if (run) {
        run.pdf_buffer = null;
        this.runs.delete(runId);
      }
    }, RUN_TTL_MS).unref();
  }

  async executeRun(run) {
    run.status = "RUNNING";
    run.started_at = new Date().toISOString();

    const startedAtMs = Date.now();

    const report = await generateReport({
      domains: run.domains,
      timeZone: run.time_zone,
      onProgress: ({ processed, total, current_domain }) => {
        run.progress = { processed, total, current_domain };
      },
    });

    run.domain_results = report.domainResults.map((result) => ({
      domain: result.domain,
      status: result.status,
      error_code: result.error_code,
      target_url: result.target_url,
      resolved_url: result.resolved_url,
      http_fallback_used: result.http_fallback_used,
      timestamp_local: result.timestamp_local,
      page_title: result.page_title,
    }));

    run.summary = report.summary;
    run.pdf_buffer = report.pdfBuffer;
    run.status = "DONE";
    run.completed_at = new Date().toISOString();
    run.duration_ms = Date.now() - startedAtMs;

    this.logRun(run);
    this.scheduleCleanup(run.id);
  }

  logRun(run) {
    this.analyticsStore.appendEvent({
      run_id: run.id,
      user_id: run.user_id,
      created_at: run.created_at,
      started_at: run.started_at,
      completed_at: run.completed_at,
      time_zone: run.time_zone,
      input_count: run.input_count,
      domains_count: run.domains_count,
      domains: run.domains,
      invalid_tokens: run.invalid_tokens,
      pdf_status: run.summary ? run.summary.pdf_status : "fail",
      domains_success: run.summary ? run.summary.domains_success : 0,
      domains_failed: run.summary ? run.summary.domains_failed : run.domains_count,
      duration_ms: run.duration_ms || null,
      domain_results: run.domain_results,
      retention_days: 90,
    });
  }

  markDownloaded(runId) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.download_count += 1;
  }
}

module.exports = {
  RunManager,
};
