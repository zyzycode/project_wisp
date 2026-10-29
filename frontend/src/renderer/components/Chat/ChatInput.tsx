import React, { useState, useRef, useEffect } from 'react';

export interface ChatInputProps {
  isOpen: boolean;
  onSendMessage: (text: string) => Promise<boolean>;
  canSubmit: boolean;
  errorMessage?: string | null;
  submissionMessage?: string;
  replyTopic?: string;
  cancelTopic?: () => void;
  onClose: () => void;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  isOpen,
  onSendMessage,
  onClose,
  canSubmit,
  errorMessage,
  submissionMessage, replyTopic, cancelTopic,
  placeholder = 'Напишите Wisp...',
}) => {
  const [text, setText] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const latestText = useRef(text);
  latestText.current = text;
  const close = () => onClose();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isOpen) {
      timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      setText('');
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit && text.trim().length > 0 && await onSendMessage(text) && latestText.current === text) {
      setText('');
      onClose();
    }
  };

  return (
    <div
      className="wisp-chat-input-container"
      data-wisp-interactive="true"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Escape') close(); }}
    >
      {replyTopic && <div role="status">Ответ по теме: {replyTopic}<button type="button" onClick={cancelTopic}>Отменить выбор темы</button></div>}
      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          ref={inputRef}
          type="text"
          className="chat-input-field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          maxLength={240}
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={!canSubmit || text.trim().length === 0}
        >
          ➤
        </button>
        <button
          type="button"
          className="chat-cancel-btn"
          onClick={close}
        >
          ✕
        </button>
      </form>
      {submissionMessage ? <div role="status">{submissionMessage}</div> : null}
      {errorMessage ? <div role="alert">{errorMessage}</div> : null}
      <div className="chat-input-arrow" />
    </div>
  );
};
