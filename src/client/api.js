const API_BASE = '/api';

export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`API Error on ${url}:`, err);
    throw err;
  }
}

export const api = {
  getOverview: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/overview${qs ? `?${qs}` : ''}`);
  },

  getCampaigns: (params = {}) => {
    const cleanParams = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== '' && v != null) {
        cleanParams[k] = String(v);
      }
    }
    const qs = new URLSearchParams(cleanParams).toString();
    return apiRequest(`/campaigns${qs ? `?${qs}` : ''}`);
  },
};
