import { create } from 'zustand';
import type { DataEnvelope } from '../protocol';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export const EMPTY_MESSAGES: Message[] = [];

interface ChatState {
  // State per node
  nodeMessages: Map<string, Message[]>;
  conversationIds: Map<string, string>;
  waitingResponse: Map<string, boolean>;
  
  // Actions
  getMessages: (nodeId: string) => Message[];
  addMessage: (nodeId: string, message: Message) => void;
  sendMessage: (nodeId: string, content: string) => void;
  clearHistory: (nodeId: string) => void;
  receiveEnvelope: (nodeId: string, envelope: DataEnvelope) => void;
  setWaiting: (nodeId: string, waiting: boolean) => void;
  isWaiting: (nodeId: string) => boolean;
}

export const useChatStore = create<ChatState>((set, get) => ({
  nodeMessages: new Map(),
  conversationIds: new Map(),
  waitingResponse: new Map(),
  
  getMessages: (nodeId) => {
    return get().nodeMessages.get(nodeId) || EMPTY_MESSAGES;
  },
  
  addMessage: (nodeId, message) => {
    set((state) => {
      const messages = state.nodeMessages.get(nodeId) || [];
      const updated = new Map(state.nodeMessages);
      updated.set(nodeId, [...messages, message]);
      return { nodeMessages: updated };
    });
  },
  
  sendMessage: (nodeId, content) => {
    if (!content.trim()) return;
    
    const conversationId = get().conversationIds.get(nodeId) || `conv_${Date.now()}`;
    
    // Update or create conversationId
    if (!get().conversationIds.has(nodeId)) {
      set((state) => {
        const updated = new Map(state.conversationIds);
        updated.set(nodeId, conversationId);
        return { conversationIds: updated };
      });
    }
    
    const message: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
      metadata: { conversationId },
    };
    
    // Add to local state
    get().addMessage(nodeId, message);
    
    // Set waiting state
    get().setWaiting(nodeId, true);
    
    // Send to backend via RPC
    const envelope: DataEnvelope = {
      type: 'message',
      content,
      contentType: 'text/plain',
      metadata: {
        role: 'user',
        conversationId,
      },
      origin: { nodeId, port: 'out' },
      timestamp: new Date().toISOString(),
    };
    
    // Use the bridge to send message
    if (window.bridge) {
      window.bridge.sendMessage({
        type: 'ui.chat.sendMessage',
        nodeId,
        envelope,
      });
    }
  },
  
  receiveEnvelope: (nodeId, envelope) => {
    if (envelope.type === 'message') {
      const message: Message = {
        id: `msg_${Date.now()}`,
        role: envelope.metadata?.role || 'assistant',
        content: typeof envelope.content === 'string' 
          ? envelope.content 
          : JSON.stringify(envelope.content),
        timestamp: envelope.timestamp ? new Date(envelope.timestamp) : new Date(),
      };
      if (envelope.metadata) {
        message.metadata = envelope.metadata;
      }
      get().addMessage(nodeId, message);
      get().setWaiting(nodeId, false);
    }
  },
  
  clearHistory: (nodeId) => {
    set((state) => {
      const updated = new Map(state.nodeMessages);
      updated.set(nodeId, []);
      return { nodeMessages: updated };
    });
  },
  
  setWaiting: (nodeId, waiting) => {
    set((state) => {
      const updated = new Map(state.waitingResponse);
      updated.set(nodeId, waiting);
      return { waitingResponse: updated };
    });
  },
  
  isWaiting: (nodeId) => {
    return get().waitingResponse.get(nodeId) || false;
  },
}));

// Extend window bridge interface
declare global {
  interface Window {
    bridge?: {
      sendMessage: (message: any) => void;
    };
  }
}
