import type {
  Session,
  Event,
  Alert,
  AlertContext,
  AlertGraph,
  Policy,
  Graph,
  DashboardStats,
  EndpointStatsEntry,
  TimelineResponse,
  PaginatedResponse,
  SessionFilters,
  EventFilters,
  AlertFilters,
  ApiError,
} from './types';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // Add auth token if stored
    const token = localStorage.getItem('agentsleak_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      // Token invalid or expired — clear it so TokenGate re-prompts
      localStorage.removeItem('agentsleak_token');
      window.dispatchEvent(new CustomEvent('agentsleak:auth_required'));
    }

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        code: 'UNKNOWN_ERROR',
        message: `HTTP error ${response.status}`,
      }));
      throw error;
    }

    return response.json();
  }

  private buildQueryString(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  // Sessions
  async fetchSessions(
    filters?: SessionFilters,
    page = 1,
    pageSize = 20
  ): Promise<PaginatedResponse<Session>> {
    const query = this.buildQueryString({ ...filters, page, page_size: pageSize });
    return this.request<PaginatedResponse<Session>>(`/sessions${query}`);
  }

  async fetchSession(id: string): Promise<Session> {
    return this.request<Session>(`/sessions/${id}`);
  }

  async terminateSession(id: string): Promise<void> {
    return this.request<void>(`/sessions/${id}/terminate`, {
      method: 'POST',
    });
  }

  // Events
  async fetchEvents(
    filters?: EventFilters,
    page = 1,
    pageSize = 50
  ): Promise<PaginatedResponse<Event>> {
    const query = this.buildQueryString({ ...filters, page, page_size: pageSize });
    return this.request<PaginatedResponse<Event>>(`/events${query}`);
  }

  async fetchEvent(id: string): Promise<Event> {
    return this.request<Event>(`/events/${id}`);
  }

  async fetchSessionEvents(
    sessionId: string,
    filters?: Omit<EventFilters, 'session_id'>,
    page = 1,
    pageSize = 50
  ): Promise<PaginatedResponse<Event>> {
    const query = this.buildQueryString({ ...filters, page, page_size: pageSize });
    return this.request<PaginatedResponse<Event>>(
      `/sessions/${sessionId}/events${query}`
    );
  }

  // Alerts
  async fetchAlerts(
    filters?: AlertFilters,
    page = 1,
    pageSize = 20
  ): Promise<PaginatedResponse<Alert>> {
    const query = this.buildQueryString({ ...filters, page, page_size: pageSize });
    return this.request<PaginatedResponse<Alert>>(`/alerts${query}`);
  }

  async fetchAlert(id: string): Promise<Alert> {
    return this.request<Alert>(`/alerts/${id}`);
  }

  async fetchAlertContext(id: string, limit = 20): Promise<AlertContext> {
    return this.request<AlertContext>(`/alerts/${id}/context?limit=${limit}`);
  }

  async fetchAlertGraph(id: string): Promise<AlertGraph> {
    return this.request<AlertGraph>(`/alerts/${id}/graph`);
  }

  async updateAlertStatus(
    id: string,
    status: string
  ): Promise<{ id: string; status: string; updated_at: string; message: string }> {
    return this.request<{ id: string; status: string; updated_at: string; message: string }>(`/alerts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async fetchSessionAlerts(
    sessionId: string,
    filters?: Omit<AlertFilters, 'session_id'>,
    page = 1,
    pageSize = 20
  ): Promise<PaginatedResponse<Alert>> {
    const query = this.buildQueryString({ ...filters, session_id: sessionId, page, page_size: pageSize });
    return this.request<PaginatedResponse<Alert>>(
      `/alerts${query}`
    );
  }

  // Policies
  async fetchPolicies(): Promise<Policy[]> {
    const response = await this.request<{ items: Policy[]; total: number }>('/policies');
    return response.items;
  }

  async fetchPolicy(id: string): Promise<Policy> {
    return this.request<Policy>(`/policies/${id}`);
  }

  async createPolicy(policy: Partial<Policy>): Promise<Policy> {
    return this.request<Policy>('/policies', {
      method: 'POST',
      body: JSON.stringify(policy),
    });
  }

  async updatePolicy(
    id: string,
    policy: Partial<Policy>
  ): Promise<Policy> {
    return this.request<Policy>(`/policies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(policy),
    });
  }

  async deletePolicy(id: string): Promise<void> {
    return this.request<void>(`/policies/${id}`, {
      method: 'DELETE',
    });
  }

  async togglePolicy(id: string, enabled: boolean): Promise<Policy> {
    return this.request<Policy>(`/policies/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async getPolicyAssistantStatus(): Promise<{ available: boolean }> {
    return this.request<{ available: boolean }>('/policies/assistant-status');
  }

  async generatePolicy(prompt: string): Promise<{ policy: Partial<Policy>; explanation: string }> {
    return this.request<{ policy: Partial<Policy>; explanation: string }>('/policies/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
  }

  // Graph
  async fetchSessionGraph(
    sessionId: string,
    options?: { cluster_dirs?: boolean; from_date?: string; to_date?: string },
  ): Promise<Graph> {
    const query = this.buildQueryString(options || {});
    return this.request<Graph>(`/graph/session/${sessionId}${query}`);
  }

  async fetchGlobalGraph(
    startDate?: string,
    endDate?: string,
    endpoint?: string,
    sessionSource?: string,
  ): Promise<Graph> {
    const query = this.buildQueryString({ from_date: startDate, to_date: endDate, cluster_dirs: true, endpoint, session_source: sessionSource });
    return this.request<Graph>(`/graph/global${query}`);
  }

  // Endpoints
  async fetchEndpointStats(): Promise<{ items: EndpointStatsEntry[]; total: number }> {
    return this.request<{ items: EndpointStatsEntry[]; total: number }>('/stats/endpoints');
  }

  // Stats & Analytics - note: backend endpoint is /stats/dashboard
  async fetchStats(fromDate?: string, toDate?: string, endpoint?: string): Promise<DashboardStats> {
    const query = this.buildQueryString({ from_date: fromDate, to_date: toDate, endpoint });
    return this.request<DashboardStats>(`/stats/dashboard${query}`);
  }

  async fetchTimeline(
    startDate: string,
    endDate: string,
    interval: 'minute' | 'hour' | 'day' = 'hour',
    sessionId?: string,
    endpoint?: string
  ): Promise<TimelineResponse> {
    const query = this.buildQueryString({
      from_date: startDate,
      to_date: endDate,
      interval,
      session_id: sessionId,
      endpoint,
    });
    return this.request<TimelineResponse>(`/stats/timeline${query}`);
  }

  async fetchEventsByCategory(
    startDate?: string,
    endDate?: string
  ): Promise<Record<string, number>> {
    const query = this.buildQueryString({ from_date: startDate, to_date: endDate });
    return this.request<Record<string, number>>(`/stats/events-by-category${query}`);
  }

  async fetchAlertsBySeverity(
    startDate?: string,
    endDate?: string
  ): Promise<Record<string, number>> {
    const query = this.buildQueryString({ from_date: startDate, to_date: endDate });
    return this.request<Record<string, number>>(`/stats/alerts-by-severity${query}`);
  }

  // Top-N analytics (aggregated from events table)
  async fetchTopFiles(limit = 20, fromDate?: string, toDate?: string, endpoint?: string): Promise<{ items: TopFileEntry[]; total: number }> {
    const query = this.buildQueryString({ limit, from_date: fromDate, to_date: toDate, endpoint });
    return this.request(`/stats/top-files${query}`);
  }

  async fetchTopCommands(limit = 20, fromDate?: string, toDate?: string, endpoint?: string): Promise<{ items: TopCommandEntry[]; total: number }> {
    const query = this.buildQueryString({ limit, from_date: fromDate, to_date: toDate, endpoint });
    return this.request(`/stats/top-commands${query}`);
  }

  async fetchTopDomains(limit = 20, fromDate?: string, toDate?: string, endpoint?: string): Promise<{ items: TopDomainEntry[]; total: number }> {
    const query = this.buildQueryString({ limit, from_date: fromDate, to_date: toDate, endpoint });
    return this.request(`/stats/top-domains${query}`);
  }
}

export interface TopFileEntry {
  file_path: string;
  read_count: number;
  write_count: number;
  delete_count: number;
  total_access: number;
  last_accessed: string | null;
  alert_count: number;
}

export interface TopCommandEntry {
  command: string;
  execution_count: number;
  last_executed: string | null;
  alert_count: number;
}

export interface TopDomainEntry {
  hostname: string;
  access_count: number;
  last_accessed: string | null;
  alert_count: number;
}

export const apiClient = new ApiClient(BASE_URL);
export default apiClient;
