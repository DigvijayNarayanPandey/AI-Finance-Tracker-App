// Pure helper functions shared by the AI chat hook and components.
// No React, no network. Keep this file side-effect free.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns today (or today ± offsetDays) as YYYY-MM-DD in the USER'S LOCAL timezone.
 *
 * WHY NOT new Date().toISOString()?
 * toISOString() returns UTC. India is UTC+5:30, so between midnight and 05:30 IST
 * the UTC date is still "yesterday". This helper reads the local clock instead.
 */
export const getLocalISODate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Returns true only for real calendar dates in YYYY-MM-DD format.
 * Rejects: "22-11-2026", "yesterday", impossible dates like 2026-02-31.
 *
 * WHY Date.UTC + compare-parts?
 * new Date("2026-02-31") is inconsistent across browsers (some overflow to March).
 * Building from UTC parts and comparing back is the reliable cross-browser approach.
 */
export const isValidISODate = (value) => {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
};

/**
 * Returns true if the ISO date string is in the future (relative to local today).
 * ISO strings compare correctly as plain strings: "2026-11-25" > "2026-11-23".
 * Only call this AFTER isValidISODate() has passed.
 */
export const isFutureISODate = (value) => value > getLocalISODate();

/**
 * Returns true when parsedData has everything needed to show a ConfirmationCard.
 * Does NOT check the date — that is done separately by finalizeParsedData.
 */
export const isRenderableTransaction = (data) => {
  if (!data || typeof data !== "object") return false;
  if (data.type !== "income" && data.type !== "expense") return false;
  if (data.needsClarification) return false;
  const amount = Number(data.amount);
  return Number.isFinite(amount) && amount > 0;
};

/**
 * Detects a whole-message confirmation ("yes", "haan", "ok", "done", etc.).
 * "ok but make it 500" does NOT match — only standalone affirmatives do.
 * Extend the regex here if users report common phrases not being detected.
 */
const CONFIRM_RE =
  /^(yes|y|yep|yeah|haan|han|ha|confirm|confirmed|ok|okay|done|looks good|bilkul|theek hai|thik hai|sahi hai)$/i;

export const isAffirmative = (text) =>
  CONFIRM_RE.test(String(text).trim().replace(/[.!\s]+$/, ""));

/**
 * Sanitizes parsedData that arrives from the AI response:
 *   - Forces confirmed: false (only the user can confirm)
 *   - Defaults missing date to local today
 *   - Validates date format and future-date constraint
 *
 * Returns:
 *   { data: sanitizedCopy | null, problem: string | null }
 *   problem is a human-readable message shown as an AI bubble if the date is bad.
 */
export const finalizeParsedData = (parsed) => {
  if (!parsed || typeof parsed !== "object") return { data: null, problem: null };

  // Always force confirmed: false — the LLM never triggers a save.
  const data = { ...parsed, confirmed: false };

  // Not a renderable transaction yet (clarification turn, etc.) — nothing to validate.
  if (!isRenderableTransaction(data)) return { data, problem: null };

  // No date provided — default to local today so the card always shows a date.
  if (data.date == null || data.date === "") {
    data.date = getLocalISODate();
    return { data, problem: null };
  }

  if (!isValidISODate(data.date)) {
    return {
      data,
      problem:
        "I couldn't understand that date. Please say it like 'yesterday' or type it as 2026-11-20.",
    };
  }

  if (isFutureISODate(data.date)) {
    return {
      data,
      problem: "Future dates aren't allowed. Which date should I use?",
    };
  }

  return { data, problem: null };
};

/**
 * Last gate before any API write.
 * Returns { ok: true } or { ok: false, reason: string }.
 * Always call this inside saveTransaction, even if finalizeParsedData already ran,
 * because the pending transaction may have been stored before the validators existed.
 */
export const validateForSave = (txn) => {
  if (!isRenderableTransaction(txn)) {
    return {
      ok: false,
      reason: "I couldn't read a valid amount or type for this entry. Please try again.",
    };
  }
  if (!isValidISODate(txn.date)) {
    return {
      ok: false,
      reason: "The date looks invalid. Please tell me the date to use.",
    };
  }
  if (isFutureISODate(txn.date)) {
    return {
      ok: false,
      reason: "Future dates aren't allowed. Which date should I use?",
    };
  }
  return { ok: true };
};
