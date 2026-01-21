import { useState, useEffect, useCallback } from 'react';
import { wsConnection } from '@/api/websocket';
import type { Event, Alert, Session, DashboardStats } from '@/api/types';

interface UseWebSocketOptions {
  autoConnect?: boolean;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

export function useWebSocket(
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const { autoConnect = true } = options;
  const [isConnected, setIsConnected] = useState(wsConnection.isConnected);

  useEffect(() => {
    const unsubscribe = wsConnection.on('connection', ({ connected }) => {
      setIsConnected(connected);
    });

    if (autoConnect && !wsConnection.isConnected) {
      wsConnection.connect();
    }

    return () => {
      unsubscribe();
    };
  }, [autoConnect]);

  const connect = useCallback(() => {
    wsConnection.connect();
  }, []);

  const disconnect = useCallback(() => {
    wsConnection.disconnect();
  }, []);

  return {
    isConnected,
    connect,
    disconnect,
  };
}

export function useWebSocketEvent(
  handler: (event: Event) => void
): void {
  useEffect(() => {
    const unsubscribe = wsConnection.on('event', handler);
    return () => {
      unsubscribe();
    };
  }, [handler]);
}

export function useWebSocketAlert(
  handler: (alert: Alert) => void
): void {
  useEffect(() => {
    const unsubscribe = wsConnection.on('alert', handler);
    return () => {
      unsubscribe();
    };
  }, [handler]);
}

export function useWebSocketSessionUpdate(
  handler: (session: Session) => void
): void {
  useEffect(() => {
    const unsubscribe = wsConnection.on('session_update', handler);
    return () => {
      unsubscribe();
    };
  }, [handler]);
}

export function useWebSocketStatsUpdate(
  handler: (stats: DashboardStats) => void
): void {
  useEffect(() => {
    const unsubscribe = wsConnection.on('stats_update', handler);
    return () => {
      unsubscribe();
    };
  }, [handler]);
}

export default useWebSocket;
