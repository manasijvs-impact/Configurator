import { axios, API_BASE } from './_base';

export default {
  // Customer Segments (bp_customer_segment_config + bp_customer_segment_master)
  getCustomerSegments: async () => {
    const response = await axios.get(`${API_BASE}/customer-segments`);
    return response.data;
  },
  saveCustomerSegments: async (data) => {
    const response = await axios.post(`${API_BASE}/customer-segments/save`, data);
    return response.data;
  },

  // Legacy - Customer Segment Config
  getCustomerSegmentConfig: () => axios.get(`${API_BASE}/customer-segment-config`),
  saveCustomerSegmentConfig: (isEnabled) =>
    axios.post(`${API_BASE}/customer-segment-config/save`, { is_customer_segment_enabled: isEnabled }),
};
