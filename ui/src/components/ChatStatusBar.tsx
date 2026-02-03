import { memo } from 'react';

interface ChatStatusBarProps {
  messageCount: number;
  isWaiting: boolean;
  errorMessage?: string | null;
  onClear?: () => void;
  onExport?: () => void;
}

export const ChatStatusBar = memo(({ 
  messageCount, 
  isWaiting, 
  errorMessage,
  onClear,
  onExport 
}: ChatStatusBarProps) => {
  return (
    <div className="chat-status-bar">
      <div className="chat-status-info">
        <span className="chat-message-count">💬 {messageCount} messages</span>
        {isWaiting && <span className="chat-waiting">⏱️ Waiting...</span>}
        {errorMessage && <span className="chat-error">❌ {errorMessage}</span>}
      </div>
      <div className="chat-actions">
        {onClear && (
          <button 
            className="chat-action-btn" 
            onClick={onClear}
            title="Clear history"
          >
            Clear
          </button>
        )}
        {onExport && (
          <button 
            className="chat-action-btn" 
            onClick={onExport}
            title="Export conversation"
          >
            Export
          </button>
        )}
      </div>
    </div>
  );
});

ChatStatusBar.displayName = 'ChatStatusBar';
