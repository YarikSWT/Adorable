// Email canonicalisation used for unique-by-account lookups.
//
// Goals:
//   - Gmail/Googlemail: dots in local part are ignored, plus-aliases stripped,
//     googlemail.com folded into gmail.com.
//   - Other domains: only the universal rules — trim and lowercase, plus
//     drop plus-aliases (RFC 5233 sub-addressing is widely respected).
//
// Anything that does not look like an email (no `@`) is just trimmed +
// lowercased so callers can pass through opaque identifiers without the
// function exploding.

const GMAIL_HOSTS = new Set(["gmail.com", "googlemail.com"]);

export const normaliseEmail = (raw: string): string => {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;

  let local = trimmed.slice(0, at);
  const host = trimmed.slice(at + 1);

  const plusAt = local.indexOf("+");
  if (plusAt >= 0) local = local.slice(0, plusAt);

  if (GMAIL_HOSTS.has(host)) {
    local = local.replace(/\./g, "");
  }

  return `${local}@${host}`;
};
