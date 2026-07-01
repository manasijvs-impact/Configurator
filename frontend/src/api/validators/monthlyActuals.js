import { axios, API_BASE } from '../_base';

// bp_monthly_forecast_actuals validator
export default {
  getMonthlyActualsQuery: (strategyId) => axios.get(`${API_BASE}/validation/monthly-actuals/query/${strategyId}`),
  runMonthlyActualsValidation: (strategyId, limit = null) =>
    axios.get(`${API_BASE}/validation/monthly-actuals/run/${strategyId}`, { params: { limit } }),
};
