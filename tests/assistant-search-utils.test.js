import test from "node:test";
import assert from "node:assert/strict";
import { extractSearchTerms, questionIdentifiers, phoneRegex } from "../src/utils/assistant-search-utils.js";

test("recognizes a phone number even when it contains formatting", () => {
  const parsed = questionIdentifiers("Find the deal for phone +852 1234-5678");
  assert.deepEqual(parsed.phoneDigits, ["85212345678"]);
  assert.deepEqual(parsed.dealNumbers, []);
  const matcher = new RegExp(phoneRegex("85212345678"), "i");
  assert.equal(matcher.test("+852 1234-5678"), true);
  assert.equal(matcher.test("85212345679"), false);
});

test("recognizes numeric Deal IDs without mistaking a phone number for an ID", () => {
  assert.deepEqual(questionIdentifiers("Show deal ID 3333").dealNumbers, [3333]);
  const parsedPhone = questionIdentifiers("Find a contact: 9876543210");
  assert.deepEqual(parsedPhone.dealNumbers, []);
  assert.deepEqual(parsedPhone.phoneDigits, ["9876543210"]);
});

test("recognizes email addresses and Mongo record IDs", () => {
  const parsed = questionIdentifiers("Find jane.doe@example.com and record 65f012345678901234567890");
  assert.deepEqual(parsed.emails, ["jane.doe@example.com"]);
  assert.deepEqual(parsed.objectIds, ["65f012345678901234567890"]);
});

test("natural language stop words do not override the useful search term", () => {
  assert.deepEqual(extractSearchTerms("Can you find the deal for Jane Smith by phone number 85212345678"), ["jane", "smith"]);
});

test("does not interpret ISO dates as phone numbers or Deal IDs", () => {
  const parsed = questionIdentifiers("Show renewals ending on 2026-10-24");
  assert.deepEqual(parsed.phoneDigits, []);
  assert.deepEqual(parsed.dealNumbers, []);
});
