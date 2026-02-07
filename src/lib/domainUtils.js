const MAX_UNIQUE_DOMAINS = 10;

function normalizeDomainToken(token) {
  if (!token) return "";
  let value = token.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/\/.*$/, "");
  value = value.replace(/:\d+$/, "");
  return value;
}

function isValidDomain(domain) {
  if (!domain || domain.length > 253) return false;
  const domainRegex = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
  return domainRegex.test(domain);
}

function parseDomains(rawDomains) {
  const raw = String(rawDomains || "");
  const parts = raw.split(",");
  const seen = new Set();
  const uniqueDomains = [];
  const invalidTokens = [];

  for (const part of parts) {
    const normalized = normalizeDomainToken(part);
    if (!normalized) continue;
    if (!isValidDomain(normalized)) {
      invalidTokens.push(part.trim());
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueDomains.push(normalized);
  }

  return {
    uniqueDomains,
    invalidTokens,
    inputCount: parts.filter((token) => token.trim().length > 0).length,
  };
}

function validateDomainSelection(uniqueDomains) {
  if (uniqueDomains.length === 0) {
    return { ok: false, message: "Не найдено валидных доменов. Введите домены через запятую, например: stripe.com, notion.so" };
  }
  if (uniqueDomains.length > MAX_UNIQUE_DOMAINS) {
    return {
      ok: false,
      message: `Слишком много уникальных доменов: ${uniqueDomains.length}. Максимум ${MAX_UNIQUE_DOMAINS}.`,
    };
  }
  return { ok: true };
}

module.exports = {
  MAX_UNIQUE_DOMAINS,
  parseDomains,
  validateDomainSelection,
};
