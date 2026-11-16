/*
 * MIME building for Gmail sends (feedback 17 Nov, #6).
 * Plain text → text/plain. HTML → multipart/alternative with a text version (tags stripped)
 * plus the HTML part, so every client can show it. Content is sent as given; nothing is executed.
 */
import crypto from "node:crypto";

export const MAX_EMAIL_BODY_BYTES = 500 * 1024;

const looksLikeHtml = (value) => /<\s*(html|body|p|div|table|br|span|a|h[1-6]|img|ul|ol|li|strong|em)\b[^>]*>/i.test(String(value || ""));
export { looksLikeHtml };

const ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

/** Readable plain-text version of an HTML email. */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? (/^&#(\d+);$/.test(e) ? String.fromCodePoint(Number(e.slice(2, -1))) : e))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Throws if a header value contains a line break (header injection). */
export function headerValue(value, name) {
  const v = String(value ?? "").trim();
  if (/[\r\n]/.test(v)) {
    const error = new Error(`${name} must not contain line breaks.`);
    error.code = "INVALID_EMAIL_HEADER";
    throw error;
  }
  return v;
}

export function encodeHeaderWord(value) {
  const v = headerValue(value, "subject");
  return /[^\x20-\x7E]/.test(v) ? `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=` : v;
}

const b64Lines = (text) => Buffer.from(String(text), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");

/**
 * Build an RFC 2822 message. Returns the raw string (callers base64url it for Gmail).
 * { to, from, cc, bcc, subject, text, html, headers: ["In-Reply-To: …"] }
 */
export function buildMime({ to, from, cc, bcc, subject, text, html, headers = [] }) {
  const head = [
    `To: ${headerValue(to, "to")}`,
    ...(cc ? [`Cc: ${headerValue(cc, "cc")}`] : []),
    ...(bcc ? [`Bcc: ${headerValue(bcc, "bcc")}`] : []),
    ...(from ? [`From: ${headerValue(from, "from")}`] : []),
    ...headers.map((h) => headerValue(h, "header")),
    `Subject: ${encodeHeaderWord(subject)}`,
    "MIME-Version: 1.0",
  ];
  if (!html) {
    return [...head, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64Lines(text || "")].join("\r\n");
  }
  const boundary = `banyan_${crypto.randomBytes(12).toString("hex")}`;
  const plain = text && String(text).trim() ? text : htmlToText(html);
  return [
    ...head,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(plain),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export const toGmailRaw = (mime) => Buffer.from(mime, "utf8").toString("base64url");
