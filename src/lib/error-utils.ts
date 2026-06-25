export function errText(err: unknown): string {
  if (err instanceof Error) {
    return oneLine(err.message);
  }
  if (typeof err === "string") {
    return oneLine(err);
  }
  return oneLine(String(err));
}

/**
 * Collapse newlines / tabs to single spaces so externally-sourced strings
 * (holiday names, configured country/language, error text) cannot forge extra
 * log lines or smuggle line breaks into the log / Sentry breadcrumb.
 */
export function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").trim();
}
