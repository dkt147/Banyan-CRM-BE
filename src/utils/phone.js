// Phone numbers are stored as typed by people ("+852 1234-5678"). Matching and search
// use a digits-only form so formatting differences do not hide an existing contact.
const MIN_DIGITS = 6;

export function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= MIN_DIGITS ? digits : null;
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
