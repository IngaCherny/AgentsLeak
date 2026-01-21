import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket, useWebSocketEvent, useWebSocketAlert } from './useWebSocket';
import type { Event, Alert, LiveEvent, LiveAlert } from '@/api/types';
import { queryKeys } from '@/api/queries';

interface UseLiveEventsOptions {
  maxEvents?: number;
  sessionId?: string;
  autoConnect?: boolean;
}

interface UseLiveEventsReturn {
  events: LiveEvent[];
  alerts: LiveAlert[];
  isConnected: boolean;
  clearEvents: () => void;
  clearAlerts: () => void;
  pauseUpdates: () => void;
  resumeUpdates: () => void;
  isPaused: boolean;
}

export function useLiveEvents(
  options: UseLiveEventsOptions = {}
): UseLiveEventsReturn {
  const { maxEvents = 100, sessionId, autoConnect = true } = options;

  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(isPaused);

  const queryClient = useQueryClient();
  const { isConnected } = useWebSocket({ autoConnect });

  // Keep ref in sync with state
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const handleEvent = useCallback(
    (event: Event) => {
      if (isPausedRef.current) return;
      if (sessionId && event.session_id !== sessionId) return;

      setEvents((prev) => {
        const newEvent: LiveEvent = { ...event, isNew: true };
        const updated = [newEvent, ...prev].slice(0, maxEvents);

        // Mark previous events as not new after a brief delay
        setTimeout(() => {
          setEvents((current) =>
            current.map((e) =>
              e.id === event.id ? { ...e, isNew: false } : e
            )
          );
        }, 2000);

        return updated;
      });

      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: queryKeys.events.all,
        refetchType: 'none',
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.stats.dashboard(),
        refetchType: 'none',
      });
    },
    [sessionId, maxEvents, queryClient]
  );

  const handleAlert = useCallback(
    (alert: Alert) => {
      if (isPausedRef.current) return;
      if (sessionId && alert.session_id !== sessionId) return;

      setAlerts((prev) => {
        const newAlert: LiveAlert = { ...alert, isNew: true };
        const updated = [newAlert, ...prev].slice(0, maxEvents);

        // Mark previous alerts as not new after a brief delay
        setTimeout(() => {
          setAlerts((current) =>
            current.map((a) =>
              a.id === alert.id ? { ...a, isNew: false } : a
            )
          );
        }, 2000);

        return updated;
      });

      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: queryKeys.alerts.all,
        refetchType: 'none',
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.stats.dashboard(),
        refetchType: 'none',
      });
    },
    [sessionId, maxEvents, queryClient]
  );

  useWebSocketEvent(handleEvent);
  useWebSocketAlert(handleAlert);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const pauseUpdates = useCallback(() => {
    setIsPaused(true);
  }, []);

  const resumeUpdates = useCallback(() => {
    setIsPaused(false);
  }, []);

  return {
    events,
    alerts,
    isConnected,
    clearEvents,
    clearAlerts,
    pauseUpdates,
    resumeUpdates,
    isPaused,
  };
}

export default useLiveEvents;
