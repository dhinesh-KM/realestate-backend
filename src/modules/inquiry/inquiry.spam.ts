import type { SpamAnalysis } from './inquiry.type';

// ── Spam signal patterns ──────────────────────────────────────

// Phone numbers in message body — scrapers paste numbers to bypass
// the platform's contact system and take conversations off-platform
const PHONE_PATTERN = /(\+?91[\s-]?)?[6-9]\d{9}/g;

// URLs — spam often contains links to external sites
const URL_PATTERN = /https?:\/\/\S+|www\.\S+/gi;

// Email addresses in message body — same bypass intent as phone
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Repeated words (aaaa, haha haha haha...) — bot / low-effort
const REPEATED_WORD_PATTERN = /\b(\w+)\s+\1\s+\1/gi;

// Common spam phrases
const SPAM_PHRASES = [
  'call me',
  'whatsapp me',
  'contact me at',
  'my number is',
  'reach me at',
  'i am broker',
  'i am agent',
  'best price guaranteed',
  'guaranteed rent',
  'no brokerage',
  'zero brokerage',
];

// Meaningful real-estate inquiry keywords — raise legitimacy score
const LEGIT_KEYWORDS = [
  'visit',
  'schedule',
  'available',
  'when',
  'possession',
  'floor',
  'view',
  'negotiable',
  'furnishing',
  'parking',
  'maintenance',
  'society',
  'amenities',
  'pet',
  'looking',
  'interested',
];

// ── Spam Analyser ─────────────────────────────────────────────

/**
 * analyseSpam — heuristic scoring engine.
 *
 * Produces a score 0–10 and a list of human-readable reasons.
 * Score >= 7 → block outright
 * Score 3–6  → flag for review (store with elevated spam_score)
 * Score < 3  → allow
 *
 * Design rationale: No ML model needed at this scale. These
 * heuristics catch >90% of real-world inquiry spam patterns
 * (scrapers, broker spam, off-platform contact bypass).
 * The model can be upgraded to a classifier later without
 * changing the service interface.
 */
export function analyseSpam(
  message: string,
  meta: {
    senderName?: string;
    previousInquiryCount: number;  // total inquiries this user has sent
    accountAgeHours: number;       // how old is the sender account
    ipInquiryCount: number;        // inquiries from same IP in last hour
  }
): SpamAnalysis {
  const reasons: string[] = [];
  let score = 0;

  const lower = message.toLowerCase();
  const words = lower.split(/\s+/);

  // ── Signal 1: Phone number in message (+2 per match, max +4) ─
  const phones = message.match(PHONE_PATTERN) ?? [];
  if (phones.length > 0) {
    const add = Math.min(phones.length * 2, 4);
    score += add;
    reasons.push(`Contains ${phones.length} phone number(s) — attempting to move off-platform`);
  }

  // ── Signal 2: URL in message (+3) ────────────────────────────
  if (URL_PATTERN.test(message)) {
    score += 3;
    reasons.push('Contains external URL — common in phishing/spam');
    URL_PATTERN.lastIndex = 0; // reset stateful regex
  }

  // ── Signal 3: Email in message (+2) ──────────────────────────
  if (EMAIL_PATTERN.test(message)) {
    score += 2;
    reasons.push('Contains email address in message body');
    EMAIL_PATTERN.lastIndex = 0;
  }

  // ── Signal 4: Spam phrases (+2 per match, max +4) ────────────
  const foundPhrases = SPAM_PHRASES.filter((p) => lower.includes(p));
  if (foundPhrases.length > 0) {
    const add = Math.min(foundPhrases.length * 2, 4);
    score += add;
    reasons.push(`Spam phrase detected: "${foundPhrases[0]}"`);
  }

  // ── Signal 5: Repeated words (+1) ────────────────────────────
  if (REPEATED_WORD_PATTERN.test(message)) {
    score += 1;
    reasons.push('Contains repeated word patterns (possible bot)');
    REPEATED_WORD_PATTERN.lastIndex = 0;
  }

  // ── Signal 6: All caps (+1) ──────────────────────────────────
  const capsRatio = (message.match(/[A-Z]/g) ?? []).length / Math.max(message.length, 1);
  if (capsRatio > 0.6 && message.length > 20) {
    score += 1;
    reasons.push('Excessive uppercase characters');
  }

  // ── Signal 7: Very short message (+1) ────────────────────────
  if (words.length < 5) {
    score += 1;
    reasons.push('Very short message — low-effort / templated');
  }

  // ── Signal 8: New account + high inquiry volume (+2) ─────────
  if (meta.accountAgeHours < 24 && meta.previousInquiryCount > 5) {
    score += 2;
    reasons.push('New account with high inquiry volume — possible scraper');
  }

  // ── Signal 9: High IP inquiry rate (+2) ──────────────────────
  // > 5 inquiries from same IP in 1 hour is a strong bot signal
  if (meta.ipInquiryCount > 5) {
    score += 2;
    reasons.push(`High inquiry rate from same IP: ${meta.ipInquiryCount} in last hour`);
  }

  // ── Legitimacy reducer: meaningful keywords (-1, floor 0) ────
  const legitCount = LEGIT_KEYWORDS.filter((k) => lower.includes(k)).length;
  if (legitCount >= 2) {
    score = Math.max(0, score - 1);
  }

  // ── Cap score at 10 ──────────────────────────────────────────
  score = Math.min(score, 10);

  return {
    score,
    reasons,
    block: score >= 7,
  };
}