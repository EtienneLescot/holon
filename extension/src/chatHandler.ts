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
  async handleSendMessage(nodeId: string, envelope: DataEnvelope): Promise<void> {
    try {
      // Emit the message on the out.message port in the PortRegistry
      await this.rpcClient.call('port.emit', {
        nodeId,
        port: 'out.message',
        value: envelope,
      });

      // Notify UI that message was sent successfully
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
          await this.handleSendMessage(message.nodeId, message.envelope);
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
