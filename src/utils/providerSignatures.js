import crypto from "node:crypto";

/** Verify Stripe's v1 signature against the exact unmodified request body. */
export function verifyStripeSignature(
  rawBody,
  signatureHeader,
  secret,
  toleranceSeconds = 300,
) {
  if (!Buffer.isBuffer(rawBody) || !signatureHeader || !secret) return false;

  const parts = String(signatureHeader)
    .split(",")
    .map((part) => part.trim().split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - timestampNumber) > toleranceSeconds) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();

  return signatures.some((candidate) => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    const actual = Buffer.from(candidate, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}
