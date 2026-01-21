import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type {
  Policy,
  SessionFilters,
  EventFilters,
  AlertFilters,
} from './types';

// Query Keys
export const queryKeys = {
  sessions: {
    all: ['sessions'] as const,
    list: (filters?: SessionFilters, page?: number) =>
      [...queryKeys.sessions.all, 'list', filters, page] as const,
    detail: (id: string) => [...queryKeys.sessions.all, 'detail', id] as const,
    events: (id: string, filters?: EventFilters, page?: number) =>
      [...queryKeys.sessions.all, id, 'events', filters, page] as const,
    alerts: (id: string, filters?: AlertFilters, page?: number) =>
      [...queryKeys.sessions.all, id, 'alerts', filters, page] as const,
    graph: (id: string) => [...queryKeys.sessions.all, id, 'graph'] as const,
  },
  events: {
    all: ['events'] as const,
    list: (filters?: EventFilters, page?: number) =>
      [...queryKeys.events.all, 'list', filters, page] as const,
    detail: (id: string) => [...queryKeys.events.all, 'detail', id] as const,
  },
  alerts: {
    all: ['alerts'] as const,
    list: (filters?: AlertFilters, page?: number) =>
      [...queryKeys.alerts.all, 'list', filters, page] as const,
    detail: (id: string) => [...queryKeys.alerts.all, 'detail', id] as const,
  },
  policies: {
    all: ['policies'] as const,
    list: () => [...queryKeys.policies.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.policies.all, 'detail', id] as const,
    assistantStatus: () => [...queryKeys.policies.all, 'assistant-status'] as const,
  },
  endpoints: {
    all: ['endpoints'] as const,
    stats: () => [...['endpoints'], 'stats'] as const,
  },
  stats: {
    all: ['stats'] as const,
    dashboard: () => [...queryKeys.stats.all, 'dashboard'] as const,
    timeline: (startDate: string, endDate: string, interval?: string) =>
      [...queryKeys.stats.all, 'timeline', startDate, endDate, interval] as const,
  },
  graph: {
    all: ['graph'] as const,
    global: (startDate?: string, endDate?: string) =>
      [...queryKeys.graph.all, 'global', startDate, endDate] as const,
  },
};

// Session Hooks
export function useSessions(
  filters?: SessionFilters,
  page = 1,
  pageSize = 20
) {
  return useQuery({
    queryKey: queryKeys.sessions.list(filters, page),
    queryFn: () => apiClient.fetchSessions(filters, page, pageSize),
    refetchInterval: 10000,
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: queryKeys.sessions.detail(id),
    queryFn: () => apiClient.fetchSession(id),
    enabled: !!id,
  });
}

export function useSessionEvents(
  sessionId: string,
  filters?: Omit<EventFilters, 'session_id'>,
  page = 1,
  pageSize = 50
) {
  return useQuery({
    queryKey: queryKeys.sessions.events(sessionId, filters, page),
    queryFn: () => apiClient.fetchSessionEvents(sessionId, filters, page, pageSize),
    enabled: !!sessionId,
  });
}

export function useSessionAlerts(
  sessionId: string,
  filters?: Omit<AlertFilters, 'session_id'>,
  page = 1,
  pageSize = 20
) {
  return useQuery({
    queryKey: queryKeys.sessions.alerts(sessionId, filters, page),
    queryFn: () => apiClient.fetchSessionAlerts(sessionId, filters, page, pageSize),
    enabled: !!sessionId,
  });
}

export function useSessionGraph(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.sessions.graph(sessionId),
    queryFn: () => apiClient.fetchSessionGraph(sessionId),
    enabled: !!sessionId,
  });
}

export function useTerminateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.terminateSession(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
}

// Event Hooks
export function useEvents(
  filters?: EventFilters,
  page = 1,
  pageSize = 50
) {
  return useQuery({
    queryKey: queryKeys.events.list(filters, page),
    queryFn: () => apiClient.fetchEvents(filters, page, pageSize),
    refetchInterval: 10000,
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: queryKeys.events.detail(id),
    queryFn: () => apiClient.fetchEvent(id),
    enabled: !!id,
  });
}

// Alert Hooks
export function useAlerts(
  filters?: AlertFilters,
  page = 1,
  pageSize = 20
) {
  return useQuery({
    queryKey: queryKeys.alerts.list(filters, page),
    queryFn: () => apiClient.fetchAlerts(filters, page, pageSize),
    refetchInterval: 5000,
  });
}

export function useAlert(id: string) {
  return useQuery({
    queryKey: queryKeys.alerts.detail(id),
    queryFn: () => apiClient.fetchAlert(id),
    enabled: !!id,
  });
}

export function useAlertContext(alertId: string, enabled = false) {
  return useQuery({
    queryKey: [...queryKeys.alerts.detail(alertId), 'context'] as const,
    queryFn: () => apiClient.fetchAlertContext(alertId),
    enabled: enabled && !!alertId,
  });
}

export function useAlertGraph(alertId: string, enabled = false) {
  return useQuery({
    queryKey: [...queryKeys.alerts.detail(alertId), 'graph'] as const,
    queryFn: () => apiClient.fetchAlertGraph(alertId),
    enabled: enabled && !!alertId,
  });
}

export function useUpdateAlertStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.updateAlertStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats.all });
    },
  });
}

// Policy Hooks
export function usePolicies() {
  return useQuery({
    queryKey: queryKeys.policies.list(),
    queryFn: () => apiClient.fetchPolicies(),
  });
}

export function usePolicy(id: string) {
  return useQuery({
    queryKey: queryKeys.policies.detail(id),
    queryFn: () => apiClient.fetchPolicy(id),
    enabled: !!id,
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (policy: Partial<Policy>) =>
      apiClient.createPolicy(policy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, policy }: { id: string; policy: Partial<Policy> }) =>
      apiClient.updatePolicy(id, policy),
    onSuccess: (updatedPolicy) => {
      queryClient.setQueryData<Policy>(
        queryKeys.policies.detail(updatedPolicy.id),
        updatedPolicy
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.list() });
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deletePolicy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

export function useTogglePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiClient.togglePolicy(id, enabled),
    onSuccess: (updatedPolicy) => {
      queryClient.setQueryData<Policy>(
        queryKeys.policies.detail(updatedPolicy.id),
        updatedPolicy
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.list() });
    },
  });
}

// Policy Assistant Hooks
export function usePolicyAssistantStatus() {
  return useQuery({
    queryKey: queryKeys.policies.assistantStatus(),
    queryFn: () => apiClient.getPolicyAssistantStatus(),
    staleTime: 60000,
  });
}

export function useGeneratePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (prompt: string) => apiClient.generatePolicy(prompt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.policies.all });
    },
  });
}

// Endpoint Hooks
export function useEndpointStats() {
  return useQuery({
    queryKey: queryKeys.endpoints.stats(),
    queryFn: () => apiClient.fetchEndpointStats(),
    refetchInterval: 15000,
  });
}

// Stats Hooks
export function useStats(fromDate?: string, toDate?: string, endpoint?: string) {
  return useQuery({
    queryKey: [...queryKeys.stats.dashboard(), fromDate, toDate, endpoint] as const,
    queryFn: () => apiClient.fetchStats(fromDate, toDate, endpoint),
    refetchInterval: 5000,
  });
}

export function useTimeline(
  startDate: string,
  endDate: string,
  interval: 'minute' | 'hour' | 'day' = 'hour',
  sessionId?: string,
  endpoint?: string
) {
  return useQuery({
    queryKey: [...queryKeys.stats.timeline(startDate, endDate, interval), sessionId, endpoint],
    queryFn: () => apiClient.fetchTimeline(startDate, endDate, interval, sessionId, endpoint),
    enabled: !!startDate && !!endDate,
    select: (data) => data,
  });
}

// Top-N Analytics Hooks
export function useTopFiles(limit = 20, fromDate?: string, toDate?: string, endpoint?: string) {
  return useQuery({
    queryKey: [...queryKeys.stats.all, 'top-files', limit, fromDate, toDate, endpoint] as const,
    queryFn: () => apiClient.fetchTopFiles(limit, fromDate, toDate, endpoint),
  });
}

export function useTopCommands(limit = 20, fromDate?: string, toDate?: string, endpoint?: string) {
  return useQuery({
    queryKey: [...queryKeys.stats.all, 'top-commands', limit, fromDate, toDate, endpoint] as const,
    queryFn: () => apiClient.fetchTopCommands(limit, fromDate, toDate, endpoint),
  });
}

export function useTopDomains(limit = 20, fromDate?: string, toDate?: string, endpoint?: string) {
  return useQuery({
    queryKey: [...queryKeys.stats.all, 'top-domains', limit, fromDate, toDate, endpoint] as const,
    queryFn: () => apiClient.fetchTopDomains(limit, fromDate, toDate, endpoint),
  });
}

// Graph Hooks
export function useGlobalGraph(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: queryKeys.graph.global(startDate, endDate),
    queryFn: () => apiClient.fetchGlobalGraph(startDate, endDate),
  });
}
