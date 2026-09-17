/**
 * Filename patterns that commonly hold secrets. This list, matched against
 * a workspace-relative display path, blocks direct tool access outright
 * unless `codelink.security.allowSecretFileAccess` is set. It is
 * deliberately not exhaustive — see docs/security.md: this is defense in
 * depth, not a substitute for not committing secrets to a repo in the
 * first place.
 */
const SENSITIVE_FILENAME_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..+)?$/i,
  /(^|\/)\.env\.local$/i,
  /(^|\/)id_rsa(\.pub)?$/i,
  /(^|\/)id_ed25519(\.pub)?$/i,
  /(^|\/)id_ecdsa(\.pub)?$/i,
  /(^|\/)id_dsa(\.pub)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /(^|\/)credentials(\.json)?$/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)token\.json$/i,
  /(^|\/)service-account.*\.json$/i,
  /(^|\/)\.pgpass$/i,
];

/** Regex fragments that look like a secret assignment inside file content
 * (`API_KEY=...`, `PASSWORD: "..."`, etc). Used only to annotate results
 * with a non-blocking warning, never to redact or reject content on its
 * own — see docs/security.md for why this is intentionally soft. */
const CONTENT_SECRET_PATTERN = /\b(API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY|ACCESS_KEY)\s*[:=]/i;

export function isSecretPath(relativeDisplayPath: string): boolean {
  return SENSITIVE_FILENAME_PATTERNS.some((pattern) => pattern.test(relativeDisplayPath));
}

export function containsLikelySecretContent(content: string): boolean {
  return CONTENT_SECRET_PATTERN.test(content);
}
