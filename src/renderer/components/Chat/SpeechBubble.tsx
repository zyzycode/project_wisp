import React, { useEffect, useState } from 'react';
import type { ChatMessage } from '../../../domain/chat/chat-message';

export interface SpeechBubbleProps {
  message: ChatMessage | null;
  onDismiss?: () => void;
}

export const SpeechBubble: React.FC<SpeechBubbleProps> = ({
  message,
  onDismiss,
}) => {
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }

    setVisible(true);

    const duration = message.durationMs ?? 4000;
    const timer = setTimeout(() => {
      setVisible(false);
      if (onDismiss) {
        onDismiss();
      }
    }, duration);

    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message || !visible) return null;

  const isThought = message.sender === 'thought';

  return (
    <div
      className={`wisp-speech-bubble ${isThought ? 'is-thought' : 'is-speech'}`}
      onClick={(e) => {
        e.stopPropagation();
        setVisible(false);
        if (onDismiss) onDismiss();
      }}
    >
      <div className="speech-content">
        {isThought && <span className="thought-icon">💭 </span>}
        <span className="speech-text">{message.text}</span>
      </div>
      <div className="speech-arrow" />
    </div>
  );
};
