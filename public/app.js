const form = document.getElementById("run-form");
const messageBox = document.getElementById("run-message");
const progressBlock = document.getElementById("progress");
const progressStatus = document.getElementById("progress-status");
const progressCount = document.getElementById("progress-count");
const progressDomain = document.getElementById("progress-domain");
const progressFill = document.getElementById("progress-fill");
const downloadBtn = document.getElementById("download-btn");
const sampleBtn = document.getElementById("sample-btn");

const resultsTable = document.getElementById("results-table");
const resultsBody = resultsTable.querySelector("tbody");

const analyticsSummary = document.getElementById("analytics-summary");
const analyticsRunsBody = document.querySelector("#runs-table tbody");
const analyticsRefreshBtn = document.getElementById("analytics-refresh");
const analyticsUserInput = document.getElementById("analytics-user-id");

let activeRunId = null;
let pollingTimer = null;
let autoDownloadedRunId = null;

function setMessage(text, isError = false) {
  messageBox.textContent = text;
  messageBox.style.color = isError ? "#b91c1c" : "#334155";
}

function renderResults(domainResults = []) {
  resultsBody.innerHTML = "";
  if (!Array.isArray(domainResults) || domainResults.length === 0) {
    resultsTable.classList.add("hidden");
    return;
  }

  for (const item of domainResults) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.domain || "-"}</td>
      <td>${item.status || "-"}</td>
      <td>${item.error_code || "-"}</td>
      <td>${item.resolved_url || item.target_url || "-"}</td>
      <td>${item.http_fallback_used ? "yes" : "no"}</td>
    `;
    resultsBody.appendChild(tr);
  }

  resultsTable.classList.remove("hidden");
}

async function downloadPdf(runId) {
  const response = await fetch(`/api/runs/${runId}/download`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Не удалось скачать PDF");
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename=\"?([^\"]+)\"?/i);
  const filename = match ? match[1] : `pricing-report-${runId}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function pollStatus() {
  if (!activeRunId) return;

  const response = await fetch(`/api/runs/${activeRunId}/status`);
  if (!response.ok) {
    throw new Error("Run not found or expired");
  }

  const run = await response.json();

  const total = run.progress?.total || run.domains_count || 0;
  const processed = run.progress?.processed || 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  progressStatus.textContent = run.status;
  progressCount.textContent = `${processed}/${total}`;
  progressDomain.textContent = run.progress?.current_domain || "-";
  progressFill.style.width = `${percent}%`;

  renderResults(run.domain_results || []);

  if (run.status === "DONE") {
    clearInterval(pollingTimer);
    pollingTimer = null;

    const s = run.summary || {};
    setMessage(
      `Готово. Успешных доменов: ${s.domains_success ?? 0}, с ошибкой: ${s.domains_failed ?? 0}. PDF готов к скачиванию.`
    );

    downloadBtn.classList.remove("hidden");
    downloadBtn.onclick = async () => {
      try {
        await downloadPdf(activeRunId);
      } catch (error) {
        setMessage(error.message, true);
      }
    };

    if (autoDownloadedRunId !== activeRunId) {
      autoDownloadedRunId = activeRunId;
      try {
        await downloadPdf(activeRunId);
      } catch (error) {
        setMessage(error.message, true);
      }
    }

    await refreshAnalytics();
    return;
  }

  if (run.status === "FAILED") {
    clearInterval(pollingTimer);
    pollingTimer = null;
    setMessage(run.error_message || "Run завершился ошибкой", true);
    await refreshAnalytics();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  downloadBtn.classList.add("hidden");
  resultsBody.innerHTML = "";
  resultsTable.classList.add("hidden");

  const payload = {
    user_id: document.getElementById("user-id").value.trim(),
    domains: document.getElementById("domains").value,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };

  try {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Не удалось создать run");
    }

    activeRunId = data.run_id;
    progressBlock.classList.remove("hidden");
    progressStatus.textContent = "QUEUED";
    progressCount.textContent = `0/${data.domains_count}`;
    progressDomain.textContent = "-";
    progressFill.style.width = "0%";

    setMessage(`Run создан: ${activeRunId}`);

    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(() => {
      pollStatus().catch((error) => {
        clearInterval(pollingTimer);
        pollingTimer = null;
        setMessage(error.message, true);
      });
    }, 1000);

    await pollStatus();
  } catch (error) {
    setMessage(error.message || "Ошибка запуска", true);
  }
});

sampleBtn.addEventListener("click", () => {
  document.getElementById("domains").value = "stripe.com, notion.so, figma.com, stripe.com";
});

async function refreshAnalytics() {
  const userId = analyticsUserInput.value.trim();
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";

  const [summaryResp, runsResp] = await Promise.all([
    fetch(`/api/analytics/summary${query}`),
    fetch(`/api/analytics/runs${query ? `${query}&limit=20` : "?limit=20"}`),
  ]);

  const summary = await summaryResp.json();
  const runsData = await runsResp.json();

  analyticsSummary.innerHTML = "";

  const items = [
    ["Runs", summary.total_runs],
    ["PDF success", summary.pdf_success_count],
    ["PDF fail", summary.pdf_fail_count],
    ["Avg domains/run", summary.average_domains_per_run],
    ["Retention days", summary.retention_days],
  ];

  for (const [label, value] of items) {
    const div = document.createElement("div");
    div.className = "kv-item";
    div.innerHTML = `<strong>${label}</strong><div>${value ?? "-"}</div>`;
    analyticsSummary.appendChild(div);
  }

  analyticsRunsBody.innerHTML = "";
  const runs = Array.isArray(runsData.runs) ? runsData.runs : [];
  for (const run of runs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${(run.run_id || "").slice(0, 8)}</td>
      <td>${run.user_id || "-"}</td>
      <td>${run.domains_count ?? 0}</td>
      <td>${run.pdf_status || "-"}</td>
      <td>${run.completed_at || "-"}</td>
    `;
    analyticsRunsBody.appendChild(tr);
  }
}

analyticsRefreshBtn.addEventListener("click", () => {
  refreshAnalytics().catch((error) => setMessage(error.message, true));
});

refreshAnalytics().catch(() => {
  // no-op on first render
});
