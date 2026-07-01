import { axios, API_BASE } from './_base';

export default {
  // Screen Hierarchies
  getScreens: () => axios.get(`${API_BASE}/screens`),
  getScreen: (screenId) => axios.get(`${API_BASE}/screens/${screenId}`),
  generateScreenDefault: (screenId) => axios.post(`${API_BASE}/screens/${screenId}/generate`),
  saveScreen: (screenId, hierarchies) => axios.post(`${API_BASE}/screens/${screenId}/save`, { hierarchies }),
  getFilterTemplates: () => axios.get(`${API_BASE}/screens/templates`),
  checkScreensStatus: () => axios.get(`${API_BASE}/screens/check-status`),
  initializeAllScreens: () => axios.post(`${API_BASE}/screens/initialize-all`),
  regenerateScreen: (screenId) => axios.post(`${API_BASE}/screens/${screenId}/regenerate`),
  regenerateAllScreens: () => axios.post(`${API_BASE}/screens/regenerate-all`),
  previewScreenRegeneration: (screenId) => axios.post(`${API_BASE}/screens/${screenId}/preview`),
  previewAllScreensRegeneration: () => axios.post(`${API_BASE}/screens/preview-all`),

  // Screen Allowances
  getScreenAllowances: () => axios.get(`${API_BASE}/screens/allowances`),
  updateScreenAllowance: (screenId, data) => axios.put(`${API_BASE}/screens/allowances/${screenId}`, data),
};
