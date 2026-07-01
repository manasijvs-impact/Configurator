import { axios, API_BASE } from '../_base';

// Monthly summary cards (non-strategy-period forecast types: FY, FY_Qx, CALENDAR_YEAR, TWELVE_MONTHS)
export default {
  getMonthlySummaryCardsChannels: (strategyId) =>
    axios.get(`${API_BASE}/validation/monthly-summary-cards/channels/${strategyId}`),
  getMonthlySummaryCardsQuery: (strategyId, channelIds = null) =>
    axios.get(`${API_BASE}/validation/monthly-summary-cards/query/${strategyId}`, { params: channelIds ? { channel_ids: channelIds } : {} }),
  validateMonthlySummaryCards: (strategyId, channelIds = null) =>
    axios.get(`${API_BASE}/validation/monthly-summary-cards/${strategyId}`, { params: channelIds ? { channel_ids: channelIds } : {} }),
};
