import { axios, API_BASE } from '../_base';

// Monthly detailed view — companion to summary cards; grouped at product/line_group × zone × channel × segment
export default {
  getMonthlyDetailedView: (strategyId, viewBy = 'product', channelIds = null) =>
    axios.get(`${API_BASE}/validation/monthly-detailed-view/${strategyId}`, {
      params: { view_by: viewBy, ...(channelIds ? { channel_ids: channelIds } : {}) },
    }),
  getMonthlyDetailedViewQuery: (strategyId, viewBy = 'product', channelIds = null) =>
    axios.get(`${API_BASE}/validation/monthly-detailed-view/query/${strategyId}`, {
      params: { view_by: viewBy, ...(channelIds ? { channel_ids: channelIds } : {}) },
    }),
};
