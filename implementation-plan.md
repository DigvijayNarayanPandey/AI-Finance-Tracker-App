# Implementation Plan: Bug Fixes 3–7

**Project:** Expense Tracker (MERN)
**Branch:** `fix/problems-3-7` (cut from `home-page`)
**Last verified against code:** 2026-11-23

> Every snippet in this plan is derived from reading the actual source files.
> Search for the **exact quoted strings** rather than relying on line numbers —
> the files will shift as edits accumulate.

---

## Ground Rules — Do Not Touch

| Area | What stays exactly as-is |
|---|---|
| Styling | `index.css`, every existing Tailwind class, `.card`, `.add-btn`, `.btn-primary`, Poppins font, all dark-mode tokens |
| Colors | `--color-primary: #0d9488`, red/orange/green values already in charts |
| Backend business logic | All controllers, models, routes, rate limiters, auth middleware |
| API shape | Request/response field names for every existing endpoint |
| AI prompt rules | Category list, icon map, parsing rules, Hindi keywords, constraints — only the two date context lines change |
| Pages | `Home.jsx`, `Income.jsx`, `Expense.jsx`, `Transactions.jsx` |
| Shared components | `Modal.jsx`, `Input.jsx`, `ConfirmationCard.jsx`, `CustomPieChart.jsx` |
| Reducer | `ACTIONS` constants and `reducer` function inside `useAiChat.js` |

---

## Overview

| Phase | Problem | Bug | Files changed |
|---|---|---|---|
| 0 | — | Create shared helper module | NEW `aiValidation.js` |
| 1 | #4 | AI dates use wrong format, server clock, no validation | `aiPromptBuilder.js`, `useAiChat.js` |
| 2 | #3 | LLM can write to DB without real user confirmation | `useAiChat.js` |
| 3 | #5 | Multiple confirmation cards shown simultaneously | `ChatMessages.jsx`, `ChatMessage.jsx` |
| 4 | #6 | Free-text categories break analytics | `aiConstants.js`, `AddExpenseForm.jsx` |
| 5 | #7 | Pie chart overlap/typos | `FinanceOverview.jsx`, `AddExpenseForm.jsx`, `CustomLineChart.jsx` |

Dependency order: Phase 0 must come first (Phases 1, 2, 3 import from it). Phases 4 and 5 are independent and can be done in any order after Phase 0.

---

## Before You Start

```bash
git checkout home-page
git pull
git checkout -b fix/problems-3-7

# Baseline check — note any pre-existing warnings
cd frontend && npm run lint
npm run build
cd ..
```

---

## Phase 0 — Shared Helper Module

**Goal:** One authoritative file for all date/transaction validation logic.
Used by Phases 1, 2, 3. Pure functions — no React, no network, easy to test.

**Create:** `frontend/src/utils/aiValidation.js`

```js
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
```

**Commit after this phase:**
```
git add frontend/src/utils/aiValidation.js
git commit -m "feat: add aiValidation shared helpers (date, affirmative, transaction checks)"
```

**Quick smoke-test in browser console (open any dashboard page):**
```js
// Paste in DevTools console after importing from the module via a test component, or
// copy-paste the functions manually and run:
getLocalISODate()         // should equal today on your local clock
isValidISODate("2026-02-31")  // false
isValidISODate("2026-11-23")  // true (adjust to any real date)
isAffirmative("haan", "han", "haa", "ha")         // true
isAffirmative("ok but 500")   // false
```

---

## Phase 1 — Fix AI Dates (#4)

**Root causes identified in source code:**

1. `useAiChat.js` L112: `currentDate: getFormattedToday()` sends `"22 Nov 2026"` (en-GB text format)
2. `aiPromptBuilder.js` L27-34: `getYesterday()` runs on the **server's UTC clock** and formats `DD-MM-YYYY`
3. The prompt response format says `YYYY-MM-DD` but the context uses two different formats — model gets confused
4. No date validation on what the model returns before it hits `saveTransaction`

### Phase 1A — Backend: `backend/utils/aiPromptBuilder.js`

**Step 1:** Delete the entire `getYesterday` function (lines 26-34):

Find this exact block and delete it:
```js
// Compute yesterday in DD-MM-YYYY format for the prompt
const getYesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};
```

**Step 2:** Add these helpers in its place (between the `CATEGORY_ICONS` block and `buildSystemPrompt`):

```js
// ─── Date helpers for the system prompt ──────────────────────────────────────

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Fallback only: used when the client sends something that is not a valid YYYY-MM-DD string.
// Server UTC is acceptable here because it is only the fallback.
const serverTodayISO = () => new Date().toISOString().split("T")[0];

// Pure date arithmetic on a YYYY-MM-DD string.
// Uses Date.UTC so the server timezone is never involved.
const shiftISODate = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split("T")[0];
};

// Returns the weekday name (e.g. "Sunday") for a YYYY-MM-DD string.
const weekdayOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
```

**Step 3:** At the **very top of `buildSystemPrompt`**, before `defaultTypeInstruction`, add:

```js
// Use the client-sent date if it's a valid ISO date; fall back to server UTC.
const today =
  ISO_RE.test(currentDate) && !Number.isNaN(Date.parse(`${currentDate}T00:00:00Z`))
    ? currentDate
    : serverTodayISO();
const yesterday = shiftISODate(today, -1);
```

**Step 4:** In the template string, replace ONLY these two lines in the `CONTEXT:` block:

Find:
```
- Today: ${currentDate}
- Yesterday: ${getYesterday()}
```

Replace with:
```
- Today: ${today} (${weekdayOf(today)})
- Yesterday: ${yesterday}
- All dates you output MUST be in YYYY-MM-DD format
```

> Nothing else in the prompt changes. The categories, icon map, parsing rules, constraints,
> and response format are byte-for-byte identical.

`aiController.js` needs **no change**. It already validates that `currentDate` is a string.

### Phase 1B — Frontend: `frontend/src/hooks/useAiChat.js`

**Step 1:** Update the import block at the top of the file.

Find:
```js
import {
  makeGreetingMessage,
  getFormattedToday,
  getIcon,
  newMsgId,
} from "../utils/aiConstants";
```

Replace with:
```js
import {
  makeGreetingMessage,
  getIcon,
  newMsgId,
} from "../utils/aiConstants";
import {
  getLocalISODate,
  isAffirmative,
  isRenderableTransaction,
  finalizeParsedData,
  validateForSave,
} from "../utils/aiValidation";
```

> `getFormattedToday` is removed from the import. The function itself stays in `aiConstants.js`
> because it may be used elsewhere. Only the import in `useAiChat.js` is removed.

**Step 2:** In `sendMessage`, find:
```js
currentDate: getFormattedToday(),
```

Replace with:
```js
currentDate: getLocalISODate(),
```

The date validation logic (via `finalizeParsedData`) is added in Phase 2 since it touches the same code block.

**Commit after Phase 1:**
```
git add backend/utils/aiPromptBuilder.js frontend/src/hooks/useAiChat.js
git commit -m "fix(ai): send client-local ISO date; compute yesterday server-side from that string"
```

**Tests for Phase 1:**
1. Temporarily add `console.log("[Prompt]", systemPrompt)` in `aiController.js` after `buildSystemPrompt` runs. Chat any message → check the terminal. Confirm:
   - `Today: 2026-11-23 (Sunday)` (or whatever today is)
   - `Yesterday: 2026-11-22`
   - `All dates you output MUST be in YYYY-MM-DD format`
   - **Remove the log immediately after confirming.**
2. Chat: "lunch 300 yesterday" → card date = yesterday's local date.
3. Chat: "salary 65000 last Monday" → model should return the correct last Monday date.

---

## Phase 2 — Stop LLM from Triggering Saves (#3)

**Root cause in source code (`useAiChat.js` L147-151):**
```js
// 7. Handle rare case where Groq confirmed directly in JSON
if (enrichedData?.confirmed && enrichedData.type && enrichedData.amount) {
  await saveTransaction(enrichedData);
}
```
If the LLM returns `"confirmed": true`, it writes directly to MongoDB. A system-prompt instruction
("NEVER set confirmed: true") is a soft rule — not a guarantee. This is the core safety bug.

**Fix design:**
1. The model's `confirmed` field is **always discarded** (forced to `false` via `finalizeParsedData`)
2. Only two code paths can trigger a save:
   - The **Confirm ✓ button** (calls `confirmTransaction` → `saveTransaction`)
   - A typed whole-message **"yes" / "haan" / "ok"** while a card is pending (detected in `sendMessage` with `isAffirmative`)
3. A `savingRef` prevents double-saves from rapid taps or Enter-key spam
4. `validateForSave` runs as the last gate before every write

### Changes to `frontend/src/hooks/useAiChat.js`

This is a continuation of Phase 1 (same file). All changes below are in the hook body — `makeInitialState`, `ACTIONS`, and `reducer` are **not touched**.

**Step 1:** Add `savingRef` next to `abortControllerRef`:

Find:
```js
// AbortController ref — cancel in-flight Groq request if modal closes
const abortControllerRef = useRef(null);
```

Add immediately after:
```js
// Prevents double-saves from rapid Confirm taps or Enter-key spam
const savingRef = useRef(false);
```

**Step 2:** Move `saveTransaction` to come BEFORE `sendMessage` in the file (it must be declared before `sendMessage` references it). Then update `saveTransaction` as follows.

Find the existing `saveTransaction` useCallback and **replace it entirely** with:

```js
// Confirm and save the pending transaction.
// Called by: confirmTransaction (button), sendMessage (affirmative "yes" detection).
const saveTransaction = useCallback(
  async (txn) => {
    if (!txn || savingRef.current) return; // double-save guard

    // Last gate before any write: validates amount, type, and date.
    const check = validateForSave(txn);
    if (!check.ok) {
      dispatch({
        type: ACTIONS.ADD_AI_MSG,
        payload: {
          id: newMsgId(),
          role: "assistant",
          content: check.reason,
          parsedData: null,
        },
      });
      dispatch({ type: ACTIONS.CLEAR_PENDING });
      return;
    }

    savingRef.current = true;
    dispatch({ type: ACTIONS.SET_SAVING, payload: true });

    const isIncome = txn.type === "income";
    const endpoint = isIncome
      ? API_PATHS.INCOME.ADD_INCOME
      : API_PATHS.EXPENSE.ADD_EXPENSE;

    // Date is already validated by validateForSave above, so no UTC fallback needed.
    const payload = isIncome
      ? {
          source: txn.source ?? "Other",
          amount: txn.amount,
          date: txn.date,
          icon: txn.icon ?? "💰",
        }
      : {
          category: txn.category ?? "Other",
          amount: txn.amount,
          date: txn.date,
          icon: txn.icon ?? "💸",
        };

    try {
      await axiosInstance.post(endpoint, payload);

      const successMsg = {
        id: newMsgId(),
        role: "assistant",
        content: `✅ Done! ₹${Number(txn.amount).toLocaleString("en-IN")} ${txn.type} added successfully. Want to add another?`,
        parsedData: null,
      };
      dispatch({ type: ACTIONS.ADD_AI_MSG, payload: successMsg });
      dispatch({ type: ACTIONS.CLEAR_PENDING });

      toast.success(`₹${Number(txn.amount).toLocaleString("en-IN")} ${txn.type} added!`);

      onTransactionAdded?.();
    } catch (error) {
      const errMsg = {
        id: newMsgId(),
        role: "assistant",
        content:
          error?.response?.data?.message ??
          "Couldn't save the transaction. Please try again.",
        parsedData: null,
      };
      dispatch({ type: ACTIONS.ADD_AI_MSG, payload: errMsg });
    } finally {
      savingRef.current = false;
      dispatch({ type: ACTIONS.SET_SAVING, payload: false });
    }
  },
  [onTransactionAdded]
);
```

> Note: The success message now uses `en-IN` (₹1,50,000) consistently — the original had
> `en-GB` in the bubble and `en-IN` in the toast. This tiny inconsistency is fixed here.

**Step 3:** Replace the entire `sendMessage` useCallback with:

```js
// Send a user message to the AI.
// If a card is pending and the message is a plain "yes/haan/ok/done",
// save the pending transaction directly without calling the model.
const sendMessage = useCallback(
  async (text) => {
    const trimmed = text.trim();
    if (!trimmed || state.isLoading || state.isSaving) return;

    // 1. Append user message immediately for responsive UX
    const userMsg = {
      id: newMsgId(),
      role: "user",
      content: trimmed,
      parsedData: null,
    };
    dispatch({ type: ACTIONS.ADD_USER_MSG, payload: userMsg });

    // 2. Short-circuit: a plain affirmative while a card is pending saves that card.
    //    The model is NOT called — faster UX and no tokens spent.
    if (state.pendingTransaction && isAffirmative(trimmed)) {
      await saveTransaction(state.pendingTransaction);
      return;
    }

    dispatch({ type: ACTIONS.SET_LOADING, payload: true });

    // 3. Build conversation history to send
    const history = [
      ...state.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: trimmed },
    ];

    // 4. Set up AbortController
    abortControllerRef.current = new AbortController();

    try {
      const response = await axiosInstance.post(
        API_PATHS.AI.CHAT,
        {
          messages: history,
          pageContext,
          currentDate: getLocalISODate(), // local ISO, not en-GB text
        },
        { signal: abortControllerRef.current.signal }
      );

      const { message, parsedData } = response.data;

      // 5. If the model thinks it already confirmed while a card is on screen,
      //    keep the card and show a nudge. The model never writes to the DB.
      if (parsedData?.confirmed === true && state.pendingTransaction) {
        dispatch({
          type: ACTIONS.ADD_AI_MSG,
          payload: {
            id: newMsgId(),
            role: "assistant",
            content: "Please tap Confirm ✓ on the card above to save it.",
            parsedData: null,
          },
        });
        return;
      }

      // 6. Sanitize: force confirmed=false, validate/default the date.
      const { data: cleanData, problem } = finalizeParsedData(parsedData);
      const enriched = cleanData
        ? { ...cleanData, icon: cleanData.icon ?? getIcon(cleanData) }
        : null;

      // 7. Append AI reply (use problem as the visible text if date was bad)
      dispatch({
        type: ACTIONS.ADD_AI_MSG,
        payload: {
          id: newMsgId(),
          role: "assistant",
          content: problem ?? message,
          parsedData: problem ? null : enriched,
        },
      });

      // 8. Set or clear pending transaction
      if (!problem && isRenderableTransaction(enriched)) {
        dispatch({ type: ACTIONS.SET_PENDING, payload: enriched });
      } else {
        dispatch({ type: ACTIONS.CLEAR_PENDING });
      }

      // Step 7 (old auto-save on model confirmed) is intentionally removed.
      // The model NEVER triggers a write.

    } catch (error) {
      if (error?.code === "ERR_CANCELED") return; // modal closed

      const errorMsg = {
        id: newMsgId(),
        role: "assistant",
        content:
          error?.response?.data?.message ??
          "Something went wrong. Please try again.",
        parsedData: null,
      };
      dispatch({ type: ACTIONS.ADD_AI_MSG, payload: errorMsg });
    }
  },
  // All values read inside the callback must appear here.
  // updateUser/clearUser are stable (useCallback in UserContext) so they won't
  // cause extra re-renders. saveTransaction is stable (useCallback).
  [
    state.messages,
    state.isLoading,
    state.isSaving,
    state.pendingTransaction,
    pageContext,
    saveTransaction,
  ]
);
```

> The `// eslint-disable-next-line react-hooks/exhaustive-deps` comment that existed above
> the dependency array can now be **deleted** — the array is complete.

`confirmTransaction`, `cancelTransaction`, `reset`, and the returned object stay exactly as they are.

**Commit after Phase 2:**
```
git add frontend/src/hooks/useAiChat.js
git commit -m "fix(ai): model can no longer trigger saves; affirmative yes detected in code"
```

**Tests for Phase 2:**

| Test | Expected result |
|---|---|
| "lunch 300" → Confirm ✓ button | One new expense. Network tab: one `POST /expense/add`. |
| "lunch 300" → type "yes" | One save. Network tab: **no** `/ai/chat` call for the "yes". |
| "lunch 300" → type "Haan!", "OK", "done." | Saves. |
| "lunch 300" → type "ok but make it 500" | No save; card updates to 500. |
| First message is "yes" (nothing pending) | Goes to model; no save. |
| "lunch 300 and confirm it" in one message | Card appears; **check MongoDB**: no document created. |
| Double-click Confirm rapidly | Exactly one document in DB. |
| Airplane mode → press Confirm | Error bubble; card remains; retry works after reconnecting. |

---

## Phase 3 — Fix Duplicate Confirmation Cards (#5)

**Root cause in `ChatMessage.jsx` (L10-18):**
```js
const showCard =
  isAi &&
  message.parsedData?.type &&
  message.parsedData?.amount &&
  !message.parsedData?.confirmed &&
  !message.parsedData?.needsClarification &&
  pendingTransaction;
```
Every AI message whose `parsedData` passes this check shows a card, as long as `pendingTransaction` is set.
So two messages in a row with valid `parsedData` = two cards with two sets of buttons.

**Fix: derive which bubble owns the card in the parent (`ChatMessages.jsx`), pass a boolean `showCard` prop down.**

### Changes to `frontend/src/components/AiChat/ChatMessages.jsx`

Find:
```js
import { useEffect, useRef } from "react";
import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";
```

Replace with:
```js
import { useEffect, useMemo, useRef } from "react";
import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";
import { isRenderableTransaction } from "../../utils/aiValidation";
```

After the `const bottomRef = useRef(null);` line, add:

```js
// Derive which message bubble owns the confirmation card.
// Only the most recent assistant message with a valid transaction gets the card.
// This prevents showing multiple cards when the conversation has several parsedData bubbles.
const cardMessageId = useMemo(() => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && isRenderableTransaction(m.parsedData)) {
      return m.id;
    }
  }
  return null;
}, [messages]);
```

In the JSX, add the `showCard` prop to `<ChatMessage>`:

Find:
```jsx
<ChatMessage
  key={msg.id}
  message={msg}
  pendingTransaction={pendingTransaction}
  onConfirm={onConfirm}
  onCancel={onCancel}
  isSaving={isSaving}
/>
```

Replace with:
```jsx
<ChatMessage
  key={msg.id}
  message={msg}
  showCard={msg.id === cardMessageId}
  pendingTransaction={pendingTransaction}
  onConfirm={onConfirm}
  onCancel={onCancel}
  isSaving={isSaving}
/>
```

### Changes to `frontend/src/components/AiChat/ChatMessage.jsx`

The component receives `showCard` from the parent now instead of computing it internally.

Find the props destructuring:
```js
const ChatMessage = ({ message, pendingTransaction, onConfirm, onCancel, isSaving }) => {
```

Replace with:
```js
const ChatMessage = ({ message, showCard, pendingTransaction, onConfirm, onCancel, isSaving }) => {
```

Find the internal `showCard` calculation:
```js
// Only show ConfirmationCard on the LAST AI message that has parsedData.
// This avoids showing stale cards from earlier turns.
const showCard =
  isAi &&
  message.parsedData?.type &&
  message.parsedData?.amount &&
  !message.parsedData?.confirmed &&
  !message.parsedData?.needsClarification &&
  pendingTransaction;
```

Replace the whole block with this single line:
```js
// Parent (ChatMessages) decides which bubble owns the card via the showCard prop.
const renderCard = isAi && showCard && pendingTransaction;
```

Find in the JSX:
```jsx
{showCard && (
  <ConfirmationCard
```

Replace `showCard` with `renderCard`:
```jsx
{renderCard && (
  <ConfirmationCard
```

Everything else in `ChatMessage.jsx` — the bubble layout, all `className` values, the `<p>` and `<ConfirmationCard>` props — stays exactly as-is.

**Commit after Phase 3:**
```
git add frontend/src/components/AiChat/ChatMessages.jsx frontend/src/components/AiChat/ChatMessage.jsx
git commit -m "fix(ai-chat): show confirmation card on latest transaction message only"
```

**Tests for Phase 3:**

| Test | Expected result |
|---|---|
| "lunch 300" then "change date to yesterday" | Card appears only on the second (newer) bubble. First bubble shows text only. |
| After nudge message ("tap Confirm on the card above") | Nudge has no parsedData → card stays on the previous bubble. |
| After Confirm or Cancel | No cards visible anywhere. |
| "doctor visit" (needs amount) → reply "750" | No card on first bubble, one card on second bubble. |
| Scroll up in a long chat | Only the latest transaction bubble ever has Confirm/Cancel buttons. |

---

## Phase 4 — Category Quick-Pick Chips (#6)

**Root cause:** `AddExpenseForm.jsx` only has a free-text field. Users type "food", "Food", "Lunch", "Food & Dining" — all stored as different categories, breaking any future analytics grouping.

**Fix:** Add quick-pick chip buttons above the text field. Keep the text field so custom values remain possible. Normalize on submit (trim + canonical case matching).

### Changes to `frontend/src/utils/aiConstants.js`

Append these exports at the end of the file (after `newMsgId`). Do not modify any existing code:

```js
// ─── Expense category list ─────────────────────────────────────────────────
// MUST match EXPENSE_CATEGORIES in backend/utils/aiPromptBuilder.js.
// Both are intentionally separate (different packages). If you change one, change the other.
export const EXPENSE_CATEGORIES = [
  "Food & Dining",
  "Transport",
  "Rent & Housing",
  "Utilities",
  "Entertainment",
  "Health & Fitness",
  "Shopping",
  "Education",
  "Subscriptions",
  "Petrol",
  "Groceries",
  "Other",
];

/**
 * Normalizes a raw category string before saving:
 * - Trims whitespace and collapses internal spaces
 * - Case-insensitive match to the canonical list → returns canonical name
 * - No list match → capitalizes first letter, returns as-is (custom categories preserved)
 * - Empty string → returns "" so Expense.jsx still shows "Category is required"
 */
export const normalizeCategory = (raw) => {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const match = EXPENSE_CATEGORIES.find(
    (c) => c.toLowerCase() === text.toLowerCase()
  );
  return match ?? (text.charAt(0).toUpperCase() + text.slice(1));
};
```

### Changes to `frontend/src/components/Expense/AddExpenseForm.jsx`

**Step 1:** Add imports at the top of the file:

Find:
```js
import React, { useState } from 'react'
import Input from "../Inputs/Input";
import EmojiPickerPopup from "../EmojiPickerPopup";
```

Replace with:
```js
import React, { useState } from 'react';
import Input from "../Inputs/Input";
import EmojiPickerPopup from "../EmojiPickerPopup";
import { EXPENSE_CATEGORIES, normalizeCategory } from "../../utils/aiConstants";
```

**Step 2:** Insert the category chips block **between `<EmojiPickerPopup />` and the Category `<Input />`**.

Find:
```jsx
<EmojiPickerPopup
    icon={income.icon}
    onSelect={(selectedIcon) => handleChange("icon", selectedIcon)}
/>

<Input
    value={income.category}
    onChange={({ target }) => handleChange("category", target.value)}
    label="Category"
    palceholder="Rent, Groceries, etc"
    type="text"
/>
```

Replace with:
```jsx
<EmojiPickerPopup
    icon={income.icon}
    onSelect={(selectedIcon) => handleChange("icon", selectedIcon)}
/>

{/* Quick-pick chips — tap to fill the Category field with a canonical name */}
<div className="mb-2">
    <label className="text-[13px] text-slate-800 dark:text-slate-300 mb-2 block">
        Quick pick
    </label>
    <div className="flex flex-wrap gap-2">
        {EXPENSE_CATEGORIES.map((cat) => {
            const isSelected =
                income.category.trim().toLowerCase() === cat.toLowerCase();
            return (
                <button
                    key={cat}
                    type="button"
                    onClick={() => handleChange("category", cat)}
                    className={`text-xs font-medium rounded-lg px-3 py-1.5 border cursor-pointer transition-colors ${
                        isSelected
                            ? "text-white bg-primary border-primary"
                            : "text-primary bg-teal-50 dark:bg-primary/10 border-teal-100 dark:border-primary/20 hover:bg-teal-100 dark:hover:bg-primary/20"
                    }`}
                >
                    {cat}
                </button>
            );
        })}
    </div>
</div>

<Input
    value={income.category}
    onChange={({ target }) => handleChange("category", target.value)}
    label="Category"
    placeholder="Rent, Groceries, etc"
    type="text"
/>
```

> `palceholder` is corrected to `placeholder` here (this is one of the Phase 5 typo fixes,
> applied in this same file to avoid a second edit).

**Step 3:** Update the submit button to normalize the category before passing it up.

Find:
```jsx
<button className="add-btn add-btn-fill" type="button" onClick={() => onAddExpense(income)}>
    Add Expense
</button>
```

Replace with:
```jsx
<button
    className="add-btn add-btn-fill"
    type="button"
    onClick={() => onAddExpense({ ...income, category: normalizeCategory(income.category) })}
>
    Add Expense
</button>
```

> The `onAddExpense` callback signature in `Expense.jsx` is unchanged.
> The normalization is transparent to the parent.

**Commit after Phase 4:**
```
git add frontend/src/utils/aiConstants.js frontend/src/components/Expense/AddExpenseForm.jsx
git commit -m "feat(expense): category quick-pick chips and normalization in AddExpenseForm"
```

**Tests for Phase 4:**

| Test | Expected result |
|---|---|
| Click "Transport" chip | Category field shows "Transport"; chip has teal background |
| Click "Food & Dining" then click "Groceries" | Only "Groceries" chip is selected |
| Type "food" in the text field | No chip is highlighted; after Add, payload has `"category":"Food"` |
| Type "TRANSPORT" | Stored as `"Transport"` |
| Type "  groceries  " (with spaces) | Stored as `"Groceries"` |
| Leave category blank → click Add | Toast: "Category is required" (unchanged from before) |
| Check Network tab on Add | Payload: `{ category, amount, date, icon }` — identical shape to before |
| Dark mode on a 360px viewport | Modal scrolls; chips wrap cleanly; nothing overflows |

---

## Phase 5 — Pie Chart + Typos (#7)

Three unrelated fixes bundled because they are all small and low-risk.

### Fix A: `frontend/src/components/Dashboard/FinanceOverview.jsx` — Pie chart data

**Problem:** Three slices (Balance, Expenses, Income) where Balance = Income − Expense.
The slices conceptually overlap and a negative Balance creates a broken Recharts render.

**Fix:** Two slices (Expenses, Income). The doughnut hole label still shows Total Balance.

Find:
```js
const COLORS = ["#875CF5", "#FA2C37", "#FF6900"];

const FinanceOverview = ({ totalBalance, totalIncome, totalExpense }) => {
  const balanceData = [
    { name: "Total Balance", amount: totalBalance },
    { name: "Total Expanses", amount: totalExpense },
    { name: "Total income", amount: totalIncome },
  ];
```

Replace with:
```js
// Red = Expenses, Orange = Income — same colors as before, purple removed with the Balance slice.
const COLORS = ["#FA2C37", "#FF6900"];

const FinanceOverview = ({ totalBalance, totalIncome, totalExpense }) => {
  const balanceData = [
    { name: "Total Expenses", amount: totalExpense },
    { name: "Total Income", amount: totalIncome },
  ];
```

The rest of the component (`<CustomPieChart>` props, label, `totalAmount`, `showTextAnchor`) is unchanged.

### Fix B: `frontend/src/components/Charts/CustomLineChart.jsx` — `<sapn>` typo

Find:
```jsx
<sapn className="text-sm font-medium text-gray-900 dark:text-slate-100">
  ₹{Number(payload[0].payload.amount).toLocaleString("en-IN")}
</sapn>
```

Replace with:
```jsx
<span className="text-sm font-medium text-gray-900 dark:text-slate-100">
  ₹{Number(payload[0].payload.amount).toLocaleString("en-IN")}
</span>
```

Both the opening and closing tag change. No class changes.

### Fix C: `frontend/src/components/Expense/AddExpenseForm.jsx` — remaining `palceholder` typos

> The Category `palceholder` was already fixed in Phase 4. Fix the remaining two here.

Find:
```jsx
<Input
    value={income.amount}
    onChange={({ target }) => handleChange("amount", target.value)}
    label="Amount"
    palceholder="0.00"
    type="number"
/>

<Input
    value={income.date}
    onChange={({ target }) => handleChange("date", target.value)}
    label="Date"
    palceholder=""
    type="date"
    max={new Date().toISOString().split("T")[0]}
/>
```

Replace with:
```jsx
<Input
    value={income.amount}
    onChange={({ target }) => handleChange("amount", target.value)}
    label="Amount"
    placeholder="0.00"
    type="number"
/>

<Input
    value={income.date}
    onChange={({ target }) => handleChange("date", target.value)}
    label="Date"
    placeholder=""
    type="date"
    max={new Date().toISOString().split("T")[0]}
/>
```

> Side effect: the placeholders "0.00" and "Rent, Groceries, etc" will now appear as grey text
> in the form. This is the **intended behavior** — they were invisible before because the prop
> name was wrong.

**Commit after Phase 5:**
```
git add frontend/src/components/Dashboard/FinanceOverview.jsx \
         frontend/src/components/Charts/CustomLineChart.jsx \
         frontend/src/components/Expense/AddExpenseForm.jsx
git commit -m "fix(ui): two-slice pie chart, sapn typo, placeholder typos in AddExpenseForm"
```

**Tests for Phase 5:**

| Test | Expected result |
|---|---|
| Dashboard pie legend | Shows "Total Expenses" (red) and "Total Income" (orange) |
| Pie centre label | Still shows "Total Balance ₹…" |
| Make expense > income | Pie shows two valid slices; no glitchy rendering; centre shows negative number |
| Fresh account (no data) | Empty ring; no console errors |
| Hover expense area chart | Tooltip renders correctly with no `<sapn>` warnings in console |
| Add Expense modal | "0.00" placeholder visible in Amount field; "Rent, Groceries, etc" in Category field |
| VS Code Ctrl+Shift+F search | Zero results for: `Expanses`, `palceholder`, `sapn` |

---

## Final Verification Checklist

Run these after all five phases are committed:

```bash
cd frontend
npm run lint      # must exit 0, no new errors
npm run build     # must succeed: ✓ built in X.XXs
```

### Code-level checks (search in VS Code or grep)

```bash
# In frontend/src/hooks/useAiChat.js — must find ZERO occurrences:
grep -n "saveTransaction(enrichedData)" frontend/src/hooks/useAiChat.js
grep -n "getFormattedToday" frontend/src/hooks/useAiChat.js

# In all frontend files — must find ZERO occurrences:
grep -rn "Expanses" frontend/src/
grep -rn "palceholder" frontend/src/
grep -rn "<sapn" frontend/src/
```

### Manual regression tests

| Feature | Expected |
|---|---|
| Login / Sign Up | Unchanged |
| Add Income (manual form) | Unchanged |
| Add Expense (manual form) | Chips visible; placeholders visible; submit works |
| Delete income / expense | Unchanged |
| Download Excel | Unchanged |
| Dashboard summary cards | Unchanged |
| Dashboard pie | Two slices; correct legend; correct centre |
| Transactions page search/filter | Unchanged |
| AI chat on /dashboard | Full flow: message → card → confirm/cancel |
| AI chat on /income | Saves income only |
| AI chat on /expense | Saves expense only |
| Dark mode toggle | All fixed components look correct |
| Mobile (360px) | No overflow; chips wrap cleanly |

---

## What Visibly Changes for Users

| Feature | Change |
|---|---|
| AI chat — typing "yes" | Saves immediately (no model round-trip); success appears faster |
| AI chat — confirmation card | Always shows a date; bad/future dates show a message instead |
| AI chat — multi-turn chat | Only the newest transaction bubble has Confirm/Cancel buttons |
| Add Expense modal | "Quick pick" chips appear above Category field; placeholders now visible |
| Dashboard pie chart | Two slices (Expenses, Income); legend spelling corrected |
| Everything else | Identical to before |

---

## Rollback Plan

Each phase is a separate commit on `fix/problems-3-7`. To revert a phase:

```bash
git revert <commit-hash>
```

**Dependency note:** Phases 1, 2, 3 all import from `aiValidation.js` (Phase 0 commit).
If you need to revert Phase 0, first revert Phases 1, 2, and 3 in reverse order.
Phase 4 and Phase 5 are independent — revert them in any order.

---

## Items Noticed But Out of Scope (Future Work)

These exist in the code but are **not changed** by this plan:

1. **Date picker UTC bug** (`AddExpenseForm.jsx` and `AddIncomeForm.jsx` L45): `max={new Date().toISOString().split("T")[0]}` uses UTC — between 00:00 and 05:30 IST users cannot select today. Fix: replace with `getLocalISODate()` from `aiValidation.js`.
2. **Income sources free-text** (`AddIncomeForm.jsx`): same fragmentation issue as expense categories. Same chip approach would apply.
3. **Category ambiguity** ("Food & Dining" vs "Groceries"): a UX/product decision, not a code bug.
4. **Number format in success bubble**: already fixed in Phase 2 (changed from `en-GB` to `en-IN` for consistency).
