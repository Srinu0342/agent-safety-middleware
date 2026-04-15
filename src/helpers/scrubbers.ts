// Detects and redacts secrets and PCI-sensitive data from arbitrary objects/strings.
export const REDACTED = "<sensitive_data>";

interface ScrubFinding {
  pattern: string;
  count: number;
}

export interface ScrubResult {
  data: unknown;
  findings: ScrubFinding[];
  wasModified: boolean;
}

// ---------------------------------------------------------------------------
// Pattern registry
// ---------------------------------------------------------------------------

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Anthropic / OpenAI / generic provider keys
  { name: "anthropic_api_key",  re: /sk-ant-[A-Za-z0-9\-]{20,}/g },
  { name: "openai_api_key",     re: /sk-[A-Za-z0-9]{20,}/g },

  // Cloud provider credentials
  { name: "aws_access_key",     re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws_secret_key",     re: /(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/g },
  { name: "github_token",       re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "gcp_private_key",    re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g },

  // Auth header patterns (apply before broader patterns)
  { name: "bearer_token",       re: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/g },
  { name: "basic_auth",         re: /Basic\s+[A-Za-z0-9+/=]{20,}/g },

  // JWTs
  { name: "jwt",                re: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g },

  // PCI — payment card data
  { name: "credit_card",        re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g },
  { name: "cvv",                re: /\b(?:cvv|cvc|cvv2|security[_\s-]?code)\s*[=:]\s*\d{3,4}\b/gi },
  { name: "card_expiry",        re: /\b(?:exp(?:iry|iration)?|valid\s+(?:thru|through)?)\s*[=:]\s*(?:0[1-9]|1[0-2])[\s/\-]?\d{2,4}\b/gi },

  // Database / connection strings
  { name: "connection_string",  re: /(?:mongodb|postgres|mysql|redis|amqp|smtp):\/\/[^\s"'<>]+/gi },
  { name: "db_password",        re: /\b(?:password|passwd|pwd)\s*=\s*[^\s&"']+/gi },

  // Generic high-entropy secret assignments
  {
    name: "generic_secret",
    re: /(?:secret|api[_-]?key|token|credential|private[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9\-_.~+/]{16,})["']?/gi,
  },
];

// ---------------------------------------------------------------------------
// Core scrub functions
// ---------------------------------------------------------------------------

function scrubString(value: string, findings: Map<string, number>): string {
  let result = value;
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    const before = result;
    result = result.replace(re, () => {
      findings.set(name, (findings.get(name) ?? 0) + 1);
      return REDACTED;
    });
    re.lastIndex = 0;
    void before; // suppress unused warning
  }
  return result;
}

function scrubValue(value: unknown, findings: Map<string, number>): unknown {
  if (typeof value === "string") {
    return scrubString(value, findings);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, findings));
  }
  if (value !== null && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      cleaned[k] = scrubValue(v, findings);
    }
    return cleaned;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deeply scrubs secrets from any JSON-serialisable value.
 * Returns the cleaned value, a list of what was found, and whether anything changed.
 */
export function scrub(data: unknown): ScrubResult {
  const findings = new Map<string, number>();
  const cleaned = scrubValue(data, findings);

  const findingList: ScrubFinding[] = [];
  for (const [pattern, count] of findings) {
    findingList.push({ pattern, count });
  }

  return {
    data: cleaned,
    findings: findingList,
    wasModified: findingList.length > 0,
  };
}

/**
 * Scrubs a raw string (e.g. unparsed body fallback).
 */
export function scrubRaw(text: string): ScrubResult {
  const findings = new Map<string, number>();
  const cleaned = scrubString(text, findings);
  const findingList: ScrubFinding[] = [];
  for (const [pattern, count] of findings) {
    findingList.push({ pattern, count });
  }
  return { data: cleaned, findings: findingList, wasModified: findingList.length > 0 };
}