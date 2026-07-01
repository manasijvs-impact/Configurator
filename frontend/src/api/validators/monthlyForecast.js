import { axios, API_BASE } from '../_base';

// bp_monthly_forecast validator
export default {
  getMonthlyForecastQuery: (strategyId) => axios.get(`${API_BASE}/validation/monthly-forecast/query/${strategyId}`),
  runMonthlyForecastValidation: (strategyId, limit = null) =>
    axios.get(`${API_BASE}/validation/monthly-forecast/run/${strategyId}`, { params: { limit } }),
};
