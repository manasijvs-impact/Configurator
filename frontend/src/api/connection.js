import { axios, API_BASE } from './_base';

export default {
  connect: (data) => axios.post(`${API_BASE}/connect`, data),
  disconnect: () => axios.post(`${API_BASE}/disconnect`),
  getConnectionStatus: () => axios.get(`${API_BASE}/connection-status`),
};
