import { memo } from 'react';
import { Message } from '../store/chat.store';

interface MessageItemProps {
  message: Message;
  showTimestamp?: boolean;
  allowMarkdown?: boolean;
}

export const MessageItem = memo(({ message, showTimestamp, allowMarkdown }: MessageItemProps) => {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('fr-FR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const roleIcons = {
    user: '👤',
    assistant: '🤖',
    system: '⚙️',
  };

  const roleClass = `message-${message.role}`;

  return (
    <div className={`message ${roleClass}`}>
      <div className="message-header">
        <span className="message-icon">{roleIcons[message.role]}</span>
        <span className="message-role">{message.role}</span>
        {showTimestamp && (
          <span className="message-timestamp">{formatTime(message.timestamp)}</span>
        )}
      </div>
      <div className="message-content">
        {allowMarkdown ? (
          // For now, just render as text. Markdown support can be added later with a library
          <div className="message-text">{message.content}</div>
        ) : (
          <span className="message-text">{message.content}</span>
        )}
      </div>
      {message.metadata && Object.keys(message.metadata).length > 0 && (
        <div className="message-metadata-indicator" title={JSON.stringify(message.metadata, null, 2)}>
          ℹ️
        </div>
      )}
    </div>
  );
});

MessageItem.displayName = 'MessageItem';
