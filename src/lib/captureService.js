const PDFDocument = require("pdfkit");
const { chromium } = require("playwright");

const DESKTOP_VIEWPORT = { width: 1366, height: 768 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const NAVIGATION_TIMEOUT_MS = 9000;
const PAGE_OPERATION_TIMEOUT_MS = 12000;

class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLocalTimestamp(date, timeZone) {
  const safeTimeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: safeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function classifyPlaywrightError(error) {
  const text = String(error && error.message ? error.message : error || "").toLowerCase();
  if (error instanceof CaptureError) return error.code;
  if (text.includes("timeout")) return "TIMEOUT";
  if (text.includes("err_name_not_resolved") || text.includes("dns") || text.includes("enotfound")) return "DNS_ERROR";
  if (text.includes("access denied") || text.includes("forbidden") || text.includes("captcha") || text.includes("bot")) {
    return "BLOCKED";
  }
  return "UNKNOWN";
}

async function detectBlocked(page) {
  const title = await page.title();
  const bodyPreview = await page.evaluate(() => {
    const text = document.body ? document.body.innerText || "" : "";
    return text.slice(0, 5000);
  });

  const probe = `${title}\n${bodyPreview}`.toLowerCase();
  const blockedPattern = /(captcha|verify you are human|cloudflare|access denied|bot detection|blocked request)/;
  return blockedPattern.test(probe);
}

async function captureVariant(browser, url, variant) {
  const isMobile = variant === "mobile";
  const viewport = isMobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
  const userAgent = isMobile
    ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

  const context = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  page.setDefaultTimeout(PAGE_OPERATION_TIMEOUT_MS);

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!response) throw new CaptureError("UNKNOWN", "Не удалось получить ответ страницы");

    const status = response.status();
    if (status === 404) throw new CaptureError("NOT_FOUND", `HTTP ${status}`);
    if (status >= 400 && status < 500) throw new CaptureError("NOT_FOUND", `HTTP ${status}`);
    if (status >= 500) throw new CaptureError("UNKNOWN", `HTTP ${status}`);

    const blocked = await detectBlocked(page);
    if (blocked) throw new CaptureError("BLOCKED", "Обнаружены признаки anti-bot/captcha");

    const viewportScreenshot = await page.screenshot({ type: "png", fullPage: false });
    const fullScreenshot = await page.screenshot({ type: "png", fullPage: true });

    return {
      resolvedUrl: page.url(),
      viewportScreenshot,
      fullScreenshot,
      statusCode: status,
      pageTitle: await page.title(),
    };
  } finally {
    await context.close();
  }
}

async function captureDomain(browser, domain, timeZone) {
  const attempts = [`https://${domain}/pricing`, `http://${domain}/pricing`];

  let lastError = null;
  let lastCode = "UNKNOWN";

  for (let i = 0; i < attempts.length; i += 1) {
    const url = attempts[i];

    try {
      const desktop = await captureVariant(browser, url, "desktop");
      const mobile = await captureVariant(browser, url, "mobile");

      return {
        domain,
        status: "SUCCESS",
        error_code: null,
        error_message: null,
        target_url: url,
        resolved_url: mobile.resolvedUrl || desktop.resolvedUrl || url,
        page_title: desktop.pageTitle || mobile.pageTitle || domain,
        timestamp_local: formatLocalTimestamp(new Date(), timeZone),
        http_fallback_used: i === 1,
        screenshots: {
          desktop_viewport: desktop.viewportScreenshot,
          desktop_full: desktop.fullScreenshot,
          mobile_viewport: mobile.viewportScreenshot,
          mobile_full: mobile.fullScreenshot,
        },
      };
    } catch (error) {
      lastError = error;
      lastCode = classifyPlaywrightError(error);
      if (i === attempts.length - 1) break;
      await sleep(250);
    }
  }

  return {
    domain,
    status: "ERROR",
    error_code: lastCode,
    error_message: String(lastError && lastError.message ? lastError.message : "Неизвестная ошибка"),
    target_url: attempts[0],
    resolved_url: null,
    page_title: domain,
    timestamp_local: formatLocalTimestamp(new Date(), timeZone),
    http_fallback_used: false,
    screenshots: {
      desktop_viewport: null,
      desktop_full: null,
      mobile_viewport: null,
      mobile_full: null,
    },
  };
}

function drawScreenshotCard(doc, title, imageBuffer, x, y, width, height) {
  doc.save();
  doc.rect(x, y, width, height).strokeColor("#d0d7de").lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(title, x + 8, y + 8, { width: width - 16 });

  const imageY = y + 28;
  const imageHeight = height - 36;

  if (imageBuffer) {
    doc.image(imageBuffer, x + 8, imageY, {
      fit: [width - 16, imageHeight - 8],
      align: "center",
      valign: "center",
    });
  } else {
    doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text("Скриншот недоступен", x + 8, imageY + 8, {
      width: width - 16,
      align: "center",
    });
  }
  doc.restore();
}

function createPdfBuffer(domainResults) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, size: "A4", margin: 24 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (const result of domainResults) {
      doc.addPage();

      doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text(result.domain, 24, 22);
      doc.font("Helvetica").fontSize(10).fillColor("#374151").text(`Timestamp: ${result.timestamp_local}`, 24, 48);
      doc.text(`URL: ${result.resolved_url || result.target_url}`, 24, 64, { width: 540 });
      doc.text(`Status: ${result.status}${result.error_code ? ` (${result.error_code})` : ""}`, 24, 80);

      if (result.status === "ERROR") {
        doc.font("Helvetica").fontSize(11).fillColor("#991b1b").text(
          `Pricing page не найдена или недоступна. Причина: ${result.error_code || "UNKNOWN"}`,
          24,
          118,
          { width: 540 }
        );
        if (result.error_message) {
          doc.fillColor("#4b5563").fontSize(9).text(result.error_message, 24, 140, { width: 540 });
        }
        continue;
      }

      const gridTop = 118;
      const cardW = 260;
      const cardH = 300;
      const gap = 18;

      drawScreenshotCard(doc, "Desktop viewport", result.screenshots.desktop_viewport, 24, gridTop, cardW, cardH);
      drawScreenshotCard(doc, "Mobile viewport", result.screenshots.mobile_viewport, 24 + cardW + gap, gridTop, cardW, cardH);
      drawScreenshotCard(
        doc,
        "Desktop full-page",
        result.screenshots.desktop_full,
        24,
        gridTop + cardH + 14,
        cardW,
        cardH
      );
      drawScreenshotCard(
        doc,
        "Mobile full-page",
        result.screenshots.mobile_full,
        24 + cardW + gap,
        gridTop + cardH + 14,
        cardW,
        cardH
      );

      doc.font("Helvetica").fontSize(8).fillColor("#6b7280").text(
        `HTTP fallback used: ${result.http_fallback_used ? "yes" : "no"}`,
        24,
        808
      );
    }

    doc.end();
  });
}

async function generateReport({ domains, timeZone, onProgress }) {
  const browser = await chromium.launch({ headless: true });
  const domainResults = [];

  try {
    for (let i = 0; i < domains.length; i += 1) {
      const domain = domains[i];
      if (typeof onProgress === "function") {
        onProgress({ processed: i, total: domains.length, current_domain: domain });
      }

      const result = await captureDomain(browser, domain, timeZone);
      domainResults.push(result);
      await sleep(350);
    }

    if (typeof onProgress === "function") {
      onProgress({ processed: domains.length, total: domains.length, current_domain: null });
    }

    const pdfBuffer = await createPdfBuffer(domainResults);
    const successfulDomains = domainResults.filter((item) => item.status === "SUCCESS").length;

    return {
      domainResults,
      pdfBuffer,
      summary: {
        domains_total: domains.length,
        domains_success: successfulDomains,
        domains_failed: domains.length - successfulDomains,
        pdf_status: "success",
      },
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateReport,
  isValidTimeZone,
};
