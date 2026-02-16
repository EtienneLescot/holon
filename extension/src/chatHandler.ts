/**
 * Chat Handler - manages chat node interactions between UI and backend
 */

import type { RpcClient } from './rpcClient';

interface DataEnvelope {
  type: string;
  content: any;
  contentType?: string;
  metadata?: Record<string, any>;
  origin?: {
    nodeId: string;
    port: string;
  };
  timestamp?: string;
}

interface ChatMessage {
  type: string;
  nodeId: string;
  envelope?: DataEnvelope;
  conversationHistory?: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  action?: string;
  event?: {
    action: string;
    details?: any;
  };
}

export class ChatHandler {
  constructor(
    private rpcClient: RpcClient,
    private postMessageToWebview: (message: any) => void
  ) {}

  /**
   * Handle message sent from UI chat node
   */
  async handleSendMessage(
    nodeId: string,
    envelope: DataEnvelope,
    conversationHistory?: Array<{ role: string; content: string; timestamp: string }>
  ): Promise<void> {
    try {
      // Trigger workflow execution via the new /api/trigger endpoint
      const response = await fetch('http://localhost:8787/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId,
          envelope,
          conversationHistory: conversationHistory || [],
        }),
      });

      if (!response.ok) {
        throw new Error(`Trigger failed: ${response.statusText}`);
      }

      const result = await response.json() as { success: boolean; response?: any; error?: string };

      if (result.success && result.response) {
        // Forward the workflow response to the chat UI
        this.postMessageToWebview({
          type: 'chat.messageReceived',
          nodeId,
          envelope: result.response,
        });
      } else if (!result.success) {
        throw new Error(result.error || 'Workflow execution failed');
      }

      // Notify UI that message was sent and processed successfully
      this.postMessageToWebview({
        type: 'chat.event',
        nodeId,
        event: {
          action: 'message_sent',
          messageId: envelope.metadata?.messageId,
        },
      });
    } catch (error) {
      // Notify UI of error
      console.error('[ChatHandler] Error handling message:', error);
      this.postMessageToWebview({
        type: 'chat.event',
        nodeId,
        event: {
          action: 'error',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  /**
   * Handle incoming message from an agent/node to display in chat UI
   */
  async handleIncomingMessage(nodeId: string, envelope: DataEnvelope): Promise<void> {
    // Forward the received message to the UI
    this.postMessageToWebview({
      type: 'chat.messageReceived',
      nodeId,
      envelope,
    });
  }

  /**
   * Handle control commands (clear, pause, resume, etc.)
   */
  async handleControlCommand(nodeId: string, action: string, payload?: any): Promise<void> {
    switch (action) {
      case 'clear_history':
        this.postMessageToWebview({
          type: 'chat.event',
          nodeId,
          event: { action: 'clear_history' },
        });
        break;

      case 'set_config':
        // Update node configuration
        if (payload?.props) {
          this.postMessageToWebview({
            type: 'chat.event',
            nodeId,
            event: { action: 'config_updated', props: payload.props },
          });
        }
        break;

      case 'pause':
        this.postMessageToWebview({
          type: 'chat.event',
          nodeId,
          event: { action: 'pause' },
        });
        break;

      case 'resume':
        this.postMessageToWebview({
          type: 'chat.event',
          nodeId,
          event: { action: 'resume' },
        });
        break;

      default:
        console.warn(`Unknown chat control action: ${action}`);
    }
  }

  /**
   * Route incoming messages from the webview
   */
  async handleWebviewMessage(message: ChatMessage): Promise<void> {
    switch (message.type) {
      case 'ui.chat.sendMessage':
        if (message.envelope) {
          await this.handleSendMessage(
            message.nodeId,
            message.envelope,
            message.conversationHistory
          );
        }
        break;

      case 'ui.chat.control':
        if (message.action) {
          await this.handleControlCommand(message.nodeId, message.action);
        }
        break;

      default:
        // Not a chat message, ignore
        break;
    }
  }

  /**
   * Subscribe to port updates to receive messages destined for chat nodes
   */
  subscribeToPortUpdates(onMessage: (nodeId: string, port: string, envelope: DataEnvelope) => void): void {
    // This would be called when the execution engine updates port values
    // The extension should call this method to forward messages to chat nodes
    // Implementation depends on the RPC/event system architecture
  }
}
