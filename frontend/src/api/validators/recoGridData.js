import { axios, API_BASE } from '../_base';

// Reco grid data — our rollup vs bp_strategy_price_reco_grid_data_{product,line_group}_pricezone
export default {
  getRecoGridDataQuery: (strategyId, viewBy = 'product', channelIds = null) =>
    axios.get(`${API_BASE}/validation/reco-grid-data/query/${strategyId}`, {
      params: { view_by: viewBy, ...(channelIds ? { channel_ids: channelIds } : {}) },
    }),
  runRecoGridDataValidation: (strategyId, viewBy = 'product', channelIds = null) =>
    axios.get(`${API_BASE}/validation/reco-grid-data/${strategyId}`, {
      params: { view_by: viewBy, ...(channelIds ? { channel_ids: channelIds } : {}) },
    }),
};
