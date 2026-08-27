import React, { useState, useRef, useEffect } from 'react';
import { sanitizeUserMessage } from '../../../domain/chat/chat-message';

export interface ChatInputProps {
  isOpen: boolean;
  onSendMessage: (text: string) => void;
  onClose: () => void;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  isOpen,
  onSendMessage,
  onClose,
  placeholder = 'Напишите Wisp...',
}) => {
  const [text, setText] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeUserMessage(text);
    if (sanitized.length > 0) {
      onSendMessage(sanitized);
      setText('');
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="wisp-chat-input-container"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          ref={inputRef}
          type="text"
          className="chat-input-field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={240}
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={text.trim().length === 0}
        >
          ➤
        </button>
        <button
          type="button"
          className="chat-cancel-btn"
          onClick={onClose}
        >
          ✕
        </button>
      </form>
      <div className="chat-input-arrow" />
    </div>
  );
};
