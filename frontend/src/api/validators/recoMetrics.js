import { axios, API_BASE } from '../_base';

export default {
  getValidationConfig: () => axios.get(`${API_BASE}/validation/config`),
  getValidationStrategies: () => axios.get(`${API_BASE}/validation/strategies`),
  getValidationQuery: (strategyId) => axios.get(`${API_BASE}/validation/query/${strategyId}`),
  runValidation: (strategyId, limit = null) => axios.get(`${API_BASE}/validation/run/${strategyId}`, { params: { limit } }),
};
