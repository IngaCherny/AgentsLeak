import type { WebSocketMessage, Event, Alert, Session, DashboardStats } from './types';

type EventHandler<T> = (data: T) => void;

interface WebSocketHandlers {
  event: EventHandler<Event>[];
  alert: EventHandler<Alert>[];
  session_update: EventHandler<Session>[];
  stats_update: EventHandler<DashboardStats>[];
  connection: EventHandler<{ connected: boolean }>[];
  error: EventHandler<Error>[];
}

type HandlerType = keyof WebSocketHandlers;

class WebSocketConnection {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers: WebSocketHandlers = {
    event: [],
    alert: [],
    session_update: [],
    stats_update: [],
    connection: [],
    error: [],
  };
  private isIntentionallyClosed = false;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (import.meta.env.VITE_WS_URL) {
      this.url = `${import.meta.env.VITE_WS_URL}/api/ws`;
    } else {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      if (apiUrl) {
        // VITE_API_URL like "http://localhost:3827/api" → "ws://localhost:3827/api/ws"
        const wsUrl = apiUrl.replace(/^http/, 'ws');
        this.url = `${wsUrl.replace(/\/api$/, '')}/api/ws`;
      } else {
        // Use same origin — Vite proxy handles /api including WebSocket
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.url = `${wsProtocol}//${window.location.host}/api/ws`;
      }
    }
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isIntentionallyClosed = false;

    try {
      // Append auth token as query param if available
      let wsUrl = this.url;
      const token = localStorage.getItem('agentsleak_token');
      if (token) {
        const separator = wsUrl.includes('?') ? '&' : '?';
        wsUrl = `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        if (import.meta.env.DEV) console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this.emit('connection', { connected: true });
      };

      this.ws.onclose = (event) => {
        if (import.meta.env.DEV) console.log('[WebSocket] Disconnected', event.code, event.reason);
        this.emit('connection', { connected: false });

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        if (import.meta.env.DEV) console.error('[WebSocket] Error', error);
        this.emit('error', new Error('WebSocket error'));
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          if (import.meta.env.DEV) console.error('[WebSocket] Failed to parse message', error);
        }
      };
    } catch (error) {
      if (import.meta.env.DEV) console.error('[WebSocket] Failed to connect', error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (import.meta.env.DEV) console.error('[WebSocket] Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );

    if (import.meta.env.DEV) console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private handleMessage(message: WebSocketMessage): void {
    const { type, payload } = message;

    switch (type) {
      case 'event':
        this.emit('event', payload as Event);
        break;
      case 'alert':
        this.emit('alert', payload as Alert);
        break;
      case 'session_update':
        this.emit('session_update', payload as Session);
        break;
      case 'stats_update':
        this.emit('stats_update', payload as DashboardStats);
        break;
      default:
        if (import.meta.env.DEV) console.warn('[WebSocket] Unknown message type', type);
    }
  }

  private emit<T extends HandlerType>(
    type: T,
    data: WebSocketHandlers[T] extends EventHandler<infer U>[] ? U : never
  ): void {
    const handlers = this.handlers[type] as EventHandler<typeof data>[];
    handlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        if (import.meta.env.DEV) console.error(`[WebSocket] Handler error for ${type}`, error);
      }
    });
  }

  on<T extends HandlerType>(
    type: T,
    handler: WebSocketHandlers[T][number]
  ): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.handlers[type] as any[]).push(handler);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handlers = this.handlers[type] as any[];
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    };
  }

  off<T extends HandlerType>(
    type: T,
    handler: WebSocketHandlers[T][number]
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = this.handlers[type] as any[];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      if (import.meta.env.DEV) console.warn('[WebSocket] Cannot send, not connected');
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const wsConnection = new WebSocketConnection();
export default wsConnection;
