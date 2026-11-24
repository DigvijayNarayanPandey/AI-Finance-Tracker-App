// Scrollable message list. useRef + useEffect auto-scrolls to the latest
// message whenever messages or loading state changes.

import { useEffect, useMemo, useRef } from "react";
import ChatMessage from "./ChatMessage";
import TypingIndicator from "./TypingIndicator";
import { isRenderableTransaction } from "../../utils/aiValidation";

const ChatMessages = ({
  messages,
  isLoading,
  isSaving,
  pendingTransaction,
  onConfirm,
  onCancel,
}) => {
  const bottomRef = useRef(null);

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

  useEffect(() => {
    // Smooth scroll only — avoids jarring jump on initial mount
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoading]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          showCard={msg.id === cardMessageId}
          pendingTransaction={pendingTransaction}
          onConfirm={onConfirm}
          onCancel={onCancel}
          isSaving={isSaving}
        />
      ))}
      {isLoading && <TypingIndicator />}
      {/* Invisible sentinel — scroll target */}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
};

export default ChatMessages;
