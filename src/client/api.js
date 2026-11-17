const API_BASE = '/api';

let sessionId = 'unknown';
export const setSession = (id) => {
  sessionId = id;
};

export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'x-session-id': sessionId,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
    err.status = response.status;
    err.body = data;
    throw err;
  }
  return data;
}

const qs = (params = {}) => {
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v != null) clean[k] = String(v);
  }
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

export const api = {
  getOverview: (params) => apiRequest(`/overview${qs(params)}`),
  getCampaigns: (params) => apiRequest(`/campaigns${qs(params)}`),
  getCampaign: (id, params) => apiRequest(`/campaigns/${id}${qs(params)}`),
  getAdSets: () => apiRequest('/adsets'),
  getTimeseries: (params) => apiRequest(`/timeseries${qs(params)}`),

  bulkStatus: (body) => apiRequest('/bulk/status', json('POST', body)),

  getGroups: (params) => apiRequest(`/groups${qs(params)}`),
  createGroup: (body) => apiRequest('/groups', json('POST', body)),
  addToGroup: (id, campaignIds) => apiRequest(`/groups/${id}/campaigns`, json('POST', { campaignIds })),
  removeFromGroup: (id, campaignId) => apiRequest(`/groups/${id}/campaigns/${campaignId}`, { method: 'DELETE' }),
  deleteGroup: (id) => apiRequest(`/groups/${id}`, { method: 'DELETE' }),

  getAlerts: () => apiRequest('/alerts'),
  getRecommendations: (entityType, entityIds) => apiRequest(`/alerts/recommendations${qs({ entityType, entityIds: entityIds.join(',') })}`),
  createAlert: (body) => apiRequest('/alerts', json('POST', body)),
  testAlert: (body) => apiRequest('/alerts/test', json('POST', body)),
  evaluateAlerts: () => apiRequest('/alerts/evaluate', json('POST', {})),
  setAlertStatus: (id, status) => apiRequest(`/alerts/${id}/status`, json('POST', { status })),
  deleteAlert: (id) => apiRequest(`/alerts/${id}`, { method: 'DELETE' }),
  openTrigger: (id) => apiRequest(`/alerts/triggers/${id}/open`, json('POST', {})),
  dismissTrigger: (id) => apiRequest(`/alerts/triggers/${id}/dismiss`, json('POST', {})),
  reviewTrigger: (id, verdict) => apiRequest(`/alerts/triggers/${id}/feedback`, json('POST', { verdict })),

  getActivity: (type) => apiRequest(`/activity${qs({ type })}`),

  openIssue: (id, source) => apiRequest(`/issues/${id}/open`, json('POST', { sessionId, source })),
  resolveIssue: (id, source) => apiRequest(`/issues/${id}/resolve`, json('POST', { sessionId, source })),
  reviewIssue: (id) => apiRequest(`/issues/${id}/review`, json('POST', {})),
  dismissIssue: (id, source) => apiRequest(`/issues/${id}/dismiss`, json('POST', { sessionId, source })),

  getSuccessMetrics: (params) => apiRequest(`/metrics/success${qs(params)}`),

  /** Fire-and-forget product event; tracking must never break the UI. */
  track: (event, props = {}) => {
    apiRequest('/events', json('POST', { event, sessionId, ...props })).catch(() => {});
  },
};
