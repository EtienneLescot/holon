import { memo, useState, KeyboardEvent } from 'react';
import { Handle, Position } from 'reactflow';
import { useChatStore, EMPTY_MESSAGES } from '../store/chat.store';
import { MessageList } from './MessageList';
import { ChatStatusBar } from './ChatStatusBar';

interface ChatNodeProps {
  id: string;
  data: {
    label?: string;
    props?: {
      placeholder?: string;
      max_history?: number;
      auto_scroll?: boolean;
      show_timestamps?: boolean;
      allow_markdown?: boolean;
      theme?: string;
    } | Record<string, unknown>;
  };
}

export const ChatNode = memo(({ id, data }: ChatNodeProps) => {
  const messages = useChatStore((s) => s.nodeMessages.get(id) ?? EMPTY_MESSAGES);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const clearHistory = useChatStore((s) => s.clearHistory);
  const isWaiting = useChatStore((s) => s.isWaiting(id));
  
  const [input, setInput] = useState('');

  const props = (data.props && typeof data.props === 'object') ? data.props : {};
  const placeholder = typeof props.placeholder === 'string' ? props.placeholder : 'Tapez votre message...';
  const maxHistory = typeof props.max_history === 'number' ? props.max_history : 50;
  const autoScroll = typeof props.auto_scroll === 'boolean' ? props.auto_scroll : true;
  const showTimestamps = typeof props.show_timestamps === 'boolean' ? props.show_timestamps : true;
  const allowMarkdown = typeof props.allow_markdown === 'boolean' ? props.allow_markdown : true;
  const theme = typeof props.theme === 'string' ? props.theme : 'default';

  const handleSend = () => {
    if (!input.trim() || isWaiting) return;
    sendMessage(id, input);
    setInput('');
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (window.confirm('Clear all messages?')) {
      clearHistory(id);
    }
  };

  const handleExport = () => {
    const exportData = {
      nodeId: id,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
        metadata: m.metadata,
      })),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${id}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`chat-node chat-node-theme-${theme}`}>
      {/* Flowback Response Port (Bottom-Left Corner) - Loop re-entry point */}
      <div style={{ 
        position: 'absolute', 
        left: '8px',
        bottom: '8px',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '6px'
      }}>
        {/* Loop indicator */}
        <div style={{ 
          fontSize: '16px', 
          color: 'rgba(168, 85, 247, 0.9)',
          fontWeight: 'bold',
          textShadow: '0 0 4px rgba(168, 85, 247, 0.5)',
          lineHeight: '1'
        }}>
          ↺
        </div>
        <Handle 
          type="target" 
          position={Position.Left} 
          id="in"
          style={{ 
            position: 'relative',
            transform: 'none',
            background: 'rgba(168, 85, 247, 0.9)',
            border: '2px solid rgba(168, 85, 247, 1)',
            boxShadow: '0 0 10px rgba(168, 85, 247, 0.6)',
            width: '14px',
            height: '14px'
          }}
          title="Loop re-entry point - Receives workflow output to continue conversation"
        />
        <div style={{ 
          fontSize: '9px', 
          color: 'rgba(168, 85, 247, 0.95)', 
          fontWeight: '700',
          whiteSpace: 'nowrap',
          background: 'rgba(168, 85, 247, 0.15)',
          padding: '3px 6px',
          borderRadius: '4px',
          border: '1px solid rgba(168, 85, 247, 0.4)',
          textShadow: '0 1px 2px rgba(0,0,0,0.3)'
        }}>
          ↩ Response
        </div>
      </div>
      
      {/* Output port */}
      <Handle 
        type="source" 
        position={Position.Right} 
        id="out"
        style={{ top: '50%' }}
        title="Message"
      />

      {/* Header */}
      <div className="chat-node-header">
        <span className="chat-node-icon">💬</span>
        <span className="chat-node-label">{data.label || 'Chat'}</span>
      </div>

      {/* Message history */}
      <div className="chat-node-messages">
        <MessageList
          messages={messages}
          maxHistory={maxHistory}
          showTimestamps={showTimestamps}
          allowMarkdown={allowMarkdown}
          autoScroll={autoScroll}
        />
      </div>

      {/* Input form */}
      <div className="chat-node-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          disabled={isWaiting}
          className="chat-input-field"
        />
        <button 
          onClick={handleSend} 
          disabled={!input.trim() || isWaiting}
          className="chat-send-button"
          title="Send message"
        >
          {isWaiting ? '⏳' : '📤'}
        </button>
      </div>

      {/* Status bar */}
      <ChatStatusBar
        messageCount={messages.length}
        isWaiting={isWaiting}
        onClear={handleClear}
        onExport={handleExport}
      />
    </div>
  );
});

ChatNode.displayName = 'ChatNode';
