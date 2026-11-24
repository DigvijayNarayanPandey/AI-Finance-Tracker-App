// Renders a single message bubble (AI or user).
// If an AI message carries parsedData with a valid unconfirmed transaction,
// it also renders the ConfirmationCard beneath the text.

import ConfirmationCard from "./ConfirmationCard";

const ChatMessage = ({ message, showCard, pendingTransaction, onConfirm, onCancel, isSaving }) => {
  const isAi = message.role === "assistant";

  // Parent (ChatMessages) decides which bubble owns the card via the showCard prop.
  // This guarantees only the latest transaction bubble ever shows Confirm/Cancel.
  const renderCard = isAi && showCard && pendingTransaction;

  return (
    <div className={`flex items-start gap-2 ${isAi ? "" : "flex-row-reverse"}`}>
      <div
        className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
          isAi
            ? "bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-100 rounded-2xl rounded-tl-sm"
            : "bg-primary text-white rounded-2xl rounded-tr-sm"
        }`}
      >
        {/* Preserve newlines in AI messages */}
        <p className="whitespace-pre-wrap">{message.content}</p>

        {renderCard && (
          <ConfirmationCard
            transaction={pendingTransaction}
            onConfirm={onConfirm}
            onCancel={onCancel}
            isSaving={isSaving}
          />
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
