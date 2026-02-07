const fs = require("fs");
const path = require("path");

const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

class AnalyticsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureFile();
    this.pruneOldEvents();
  }

  ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "", "utf8");
  }

  readEvents() {
    this.ensureFile();
    const text = fs.readFileSync(this.filePath, "utf8");
    if (!text.trim()) return [];
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);
  }

  writeEvents(events) {
    const text = events.map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(this.filePath, text ? `${text}\n` : "", "utf8");
  }

  pruneOldEvents() {
    const threshold = Date.now() - RETENTION_MS;
    const events = this.readEvents();
    const filtered = events.filter((event) => {
      const completedAt = Date.parse(event.completed_at || event.created_at || "");
      return Number.isFinite(completedAt) && completedAt >= threshold;
    });
    if (filtered.length !== events.length) {
      this.writeEvents(filtered);
    }
    return filtered;
  }

  appendEvent(event) {
    const events = this.pruneOldEvents();
    events.push(event);
    this.writeEvents(events);
  }

  listRuns({ userId, limit = 100 } = {}) {
    const events = this.pruneOldEvents();
    const filtered = userId ? events.filter((e) => e.user_id === userId) : events;
    return filtered
      .slice()
      .sort((a, b) => Date.parse(b.completed_at || b.created_at || 0) - Date.parse(a.completed_at || a.created_at || 0))
      .slice(0, Math.max(1, Math.min(limit, 500)));
  }

  getSummary({ userId } = {}) {
    const events = this.pruneOldEvents();
    const filtered = userId ? events.filter((e) => e.user_id === userId) : events;

    const totalRuns = filtered.length;
    const pdfSuccessCount = filtered.filter((e) => e.pdf_status === "success").length;
    const pdfFailCount = filtered.filter((e) => e.pdf_status === "fail").length;
    const totalUniqueDomains = filtered.reduce((sum, e) => sum + Number(e.domains_count || 0), 0);
    const averageDomainsPerRun = totalRuns === 0 ? 0 : totalUniqueDomains / totalRuns;

    const domainCounts = new Map();
    const statusCounts = { success: 0, fail: 0 };
    const userCounts = new Map();

    for (const event of filtered) {
      statusCounts[event.pdf_status] = (statusCounts[event.pdf_status] || 0) + 1;
      userCounts.set(event.user_id, (userCounts.get(event.user_id) || 0) + 1);

      const domains = Array.isArray(event.domains) ? event.domains : [];
      for (const domain of domains) {
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      }
    }

    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([domain, count]) => ({ domain, count }));

    const topUsers = [...userCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([user_id, runs]) => ({ user_id, runs }));

    return {
      retention_days: RETENTION_DAYS,
      total_runs: totalRuns,
      pdf_success_count: pdfSuccessCount,
      pdf_fail_count: pdfFailCount,
      pdf_success_rate: totalRuns === 0 ? 0 : pdfSuccessCount / totalRuns,
      total_unique_domains_processed: totalUniqueDomains,
      average_domains_per_run: Number(averageDomainsPerRun.toFixed(2)),
      pdf_status_distribution: statusCounts,
      top_domains: topDomains,
      top_users: topUsers,
    };
  }
}

module.exports = {
  AnalyticsStore,
  RETENTION_DAYS,
};
