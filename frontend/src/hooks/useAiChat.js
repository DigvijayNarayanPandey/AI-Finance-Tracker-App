import { useReducer, useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
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

// Reducer
// useReducer over multiple useStates because these values change together.
// Atomic updates = no intermediate inconsistent states.

const makeInitialState = (pageContext) => ({
  messages: [makeGreetingMessage(pageContext)],
  pendingTransaction: null,
  isLoading: false,   // waiting for Groq API
  isSaving: false,    // waiting for income/expense API save
});

const ACTIONS = {
  ADD_USER_MSG:         "ADD_USER_MSG",
  ADD_AI_MSG:           "ADD_AI_MSG",
  SET_LOADING:          "SET_LOADING",
  SET_SAVING:           "SET_SAVING",
  SET_PENDING:          "SET_PENDING",
  CLEAR_PENDING:        "CLEAR_PENDING",
  RESET:                "RESET",
};

function reducer(state, action) {
  switch (action.type) {
    case ACTIONS.ADD_USER_MSG:
      return { ...state, messages: [...state.messages, action.payload] };

    case ACTIONS.ADD_AI_MSG:
      return {
        ...state,
        messages: [...state.messages, action.payload],
        isLoading: false,
      };

    case ACTIONS.SET_LOADING:
      return { ...state, isLoading: action.payload };

    case ACTIONS.SET_SAVING:
      return { ...state, isSaving: action.payload };

    case ACTIONS.SET_PENDING:
      return { ...state, pendingTransaction: action.payload };

    case ACTIONS.CLEAR_PENDING:
      return { ...state, pendingTransaction: null };

    case ACTIONS.RESET:
      return makeInitialState(action.pageContext);

    default:
      return state;
  }
}

// Hook

const useAiChat = ({ pageContext, onTransactionAdded }) => {
  const [state, dispatch] = useReducer(reducer, null, () =>
    makeInitialState(pageContext)
  );

  // AbortController ref — cancel in-flight Groq request if modal closes
  const abortControllerRef = useRef(null);

  // Prevents double-saves from rapid Confirm taps or Enter-key spam
  const savingRef = useRef(false);

  // Cleanup: abort any pending request when hook unmounts
  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  // Confirm and save the pending transaction.
  // Called by: confirmTransaction (button), sendMessage (affirmative "yes" detection).
  // saveTransaction is declared BEFORE sendMessage because sendMessage lists it as a dependency.
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

        // Refresh the page data (e.g., re-fetch expense list)
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
      // Include the new user message — the reducer hasn't flushed yet
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
            currentDate: getLocalISODate(), // local ISO date, not en-GB text
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

        // The old step 7 (auto-save when model returns confirmed:true) is intentionally
        // removed. The model NEVER triggers a write to the database.

      } catch (error) {
        // Don't show error if request was deliberately aborted (modal closed)
        if (error?.code === "ERR_CANCELED") return;

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
    // saveTransaction is stable (useCallback with [onTransactionAdded]).
    [
      state.messages,
      state.isLoading,
      state.isSaving,
      state.pendingTransaction,
      pageContext,
      saveTransaction,
    ]
  );

  const confirmTransaction = useCallback(
    () => saveTransaction(state.pendingTransaction),
    [saveTransaction, state.pendingTransaction]
  );

  const cancelTransaction = useCallback(() => {
    dispatch({ type: ACTIONS.CLEAR_PENDING });
    const cancelMsg = {
      id: newMsgId(),
      role: "assistant",
      content: "No problem! What else can I add for you?",
      parsedData: null,
    };
    dispatch({ type: ACTIONS.ADD_AI_MSG, payload: cancelMsg });
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    dispatch({ type: ACTIONS.RESET, pageContext });
  }, [pageContext]);

  return {
    messages: state.messages,
    pendingTransaction: state.pendingTransaction,
    isLoading: state.isLoading,
    isSaving: state.isSaving,
    sendMessage,
    confirmTransaction,
    cancelTransaction,
    reset,
  };
};

export default useAiChat;
