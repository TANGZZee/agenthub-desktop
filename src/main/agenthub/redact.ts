// @lat: [[agenthub-workers#Secret filtering]]
const REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: "[redacted-key]" },
  { pattern: /\bghp_[A-Za-z0-9]{20,}/g, replacement: "[redacted-token]" },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    replacement: "[redacted-token]",
  },
  { pattern: /\bAKIA[0-9A-Z]{16}/g, replacement: "[redacted-aws]" },
  {
    pattern: /Bearer\s+[A-Za-z0-9._\-+=/]+/gi,
    replacement: "Bearer [redacted]",
  },
  {
    pattern:
      /(api[_-]?key|access[_-]?token|secret|password|authorization)\s*[:=]\s*["']?[^\s"'&,]+/gi,
    replacement: "$1=[redacted]",
  },
  {
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[redacted-private-key]",
  },
];

export function redactSecrets(
  text: string,
  extraSecrets: readonly string[] = [],
): string {
  if (!text) return text;
  let next = text;
  for (const secret of extraSecrets) {
    if (!secret || secret.length < 4) continue;
    next = next.split(secret).join("[redacted]");
  }
  for (const { pattern, replacement } of REPLACEMENTS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, replacement);
  }
  return next;
}

export function collectSecretValues(
  env: Record<string, string> | undefined,
): string[] {
  if (!env) return [];
  return Object.values(env).filter((value) => value.length >= 4);
}
