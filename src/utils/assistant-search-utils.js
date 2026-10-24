const DOMAIN_STOP_WORDS = new Set((
  "a an the and or but if then than with about for from into onto over under of to in on at by as is are was were be been being do does did can could would should will what when where who why how much many show tell list find search get give me please current latest data " +
  "banyan workspace crm deal deals pipeline pipelines stage stages open won lost value values contact contacts customer customers person persons name names company companies task tasks followup followups overdue due today week invoice invoices payment payments revenue booking bookings calendar renewal renewals member members membership memberships quiet inactive activity activities source sources lead leads enquiry enquiries quote quotes report summary status stats count numbers assistant email emails address phone mobile number numbers id identifier identifiers dealid deal-id dealnumber lookup record records match matching result results details information you your me my i we our us they them theire help this that these those next previous last recent all any tell explain please can could would should do does did is are was were what when where who why how much many show list find search get give tell need want know "
).split(/\s+/));

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSearchTerms(question) {
  const raw = String(question || "").toLowerCase().match(/[a-z0-9@._'-]{3,}/g) || [];
  const terms = [];
  for (const rawTerm of raw) {
    const term = rawTerm.replace(/^['._-]+|['._-]+$/g, "");
    if (term.length < 3 || /^\d+$/.test(term) || DOMAIN_STOP_WORDS.has(term)) continue;
    if (!terms.includes(term)) terms.push(term);
    if (terms.length >= 8) break;
  }
  return terms;
}

export function questionIdentifiers(question) {
  const text = String(question || "");
  const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((value) => value.toLowerCase()))];
  const phoneCandidates = [];
  const phoneRanges = [];
  const dateRanges = [];
  const datePattern = /\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2}\b/g;
  let dateMatch;
  while ((dateMatch = datePattern.exec(text)) !== null) dateRanges.push([dateMatch.index, dateMatch.index + dateMatch[0].length]);
  const overlapsDate = (start, end) => dateRanges.some(([from, to]) => start < to && end > from);
  const phonePattern = /\+?\d[\d\s().-]{5,}\d/g;
  let phoneMatch;
  while ((phoneMatch = phonePattern.exec(text)) !== null) {
    if (overlapsDate(phoneMatch.index, phoneMatch.index + phoneMatch[0].length)) continue;
    const digits = phoneMatch[0].replace(/\D/g, "");
    if (digits.length >= 7) {
      phoneCandidates.push(digits);
      phoneRanges.push([phoneMatch.index, phoneMatch.index + phoneMatch[0].length]);
    }
  }
  const phoneDigits = [...new Set(phoneCandidates.sort((a, b) => b.length - a.length))].slice(0, 3);
  const numericIds = [];
  for (const match of text.matchAll(/\b\d{3,12}\b/g)) {
    const start = match.index;
    if (phoneRanges.some(([from, to]) => start >= from && start < to) || overlapsDate(start, start + match[0].length)) continue;
    const value = Number(match[0]);
    if (Number.isSafeInteger(value) && value >= 1000) numericIds.push(value);
  }
  const objectIds = [...new Set((text.match(/\b[a-f0-9]{24}\b/gi) || []).map((value) => value.toLowerCase()))];
  return { emails, phoneDigits, dealNumbers: [...new Set(numericIds)].slice(0, 5), objectIds };
}

export function phoneRegex(digits) {
  // Separator-tolerant matching: +852 1234-5678 also matches 85212345678.
  return String(digits).split("").map(escapeRegex).join("[\\s().+\\-]*");
}
