import { errText } from "./err-text";

/**
 * Collapse newlines / tabs to single spaces so externally-sourced strings
 * (holiday names, configured country/language, error text) cannot forge extra
 * log lines or smuggle line breaks into the log / Sentry breadcrumb.
 *
 * @param s the text
 * @returns the text on one line
 */
export function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").trim();
}

/**
 * The fleet's error text ({@link errText}) on one log line — the fleet helper keeps line breaks of a
 * message, and a log line here must not carry any.
 *
 * @param err the caught value
 * @returns the text on one line
 */
export function errLine(err: unknown): string {
  return oneLine(errText(err));
}
