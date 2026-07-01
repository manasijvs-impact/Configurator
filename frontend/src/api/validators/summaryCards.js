import { axios, API_BASE } from '../_base';

export default {
  getSummaryCardsChannels: (strategyId) => axios.get(`${API_BASE}/validation/summary-cards/channels/${strategyId}`),
  getSummaryCardsQuery: (strategyId, channelIds = null) =>
    axios.get(`${API_BASE}/validation/summary-cards/query/${strategyId}`, { params: channelIds ? { channel_ids: channelIds } : {} }),
  validateSummaryCards: (strategyId, channelIds = null) =>
    axios.get(`${API_BASE}/validation/summary-cards/${strategyId}`, { params: channelIds ? { channel_ids: channelIds } : {} }),
};
