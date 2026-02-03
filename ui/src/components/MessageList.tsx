import { memo, useRef, useEffect } from 'react';
import { Message } from '../store/chat.store';
import { MessageItem } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  maxHistory?: number;
  showTimestamps?: boolean;
  allowMarkdown?: boolean;
  autoScroll?: boolean;
}

export const MessageList = memo(({ 
  messages, 
  maxHistory = 50,
  showTimestamps = true,
  allowMarkdown = true,
  autoScroll = true 
}: MessageListProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const displayedMessages = messages.slice(-maxHistory);

  return (
    <div className="message-list">
      {displayedMessages.length === 0 ? (
        <div className="message-list-empty">
          <p>No messages yet. Start a conversation!</p>
        </div>
      ) : (
        displayedMessages.map((msg) => (
          <MessageItem
            key={msg.id}
            message={msg}
            showTimestamp={showTimestamps}
            allowMarkdown={allowMarkdown}
          />
        ))
      )}
      <div ref={messagesEndRef} />
    </div>
  );
});

MessageList.displayName = 'MessageList';
