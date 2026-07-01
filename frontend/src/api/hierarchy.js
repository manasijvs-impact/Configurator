import { axios, API_BASE } from './_base';

export default {
  // Product Hierarchy (bp_product_hierarchy_level)
  getProductHierarchy: async () => {
    const response = await axios.get(`${API_BASE}/product-hierarchy`);
    return response.data;
  },
  saveProductHierarchy: async (levels) => {
    const response = await axios.post(`${API_BASE}/product-hierarchy/save`, { levels });
    return response.data;
  },
  deleteProductHierarchyLevel: (id) => axios.delete(`${API_BASE}/product-hierarchy/${id}`),

  // Store Hierarchy (bp_store_hierarchy_level)
  getStoreHierarchy: async () => {
    const response = await axios.get(`${API_BASE}/store-hierarchy`);
    return response.data;
  },
  saveStoreHierarchy: async (levels) => {
    const response = await axios.post(`${API_BASE}/store-hierarchy/save`, { levels });
    return response.data;
  },
  deleteStoreHierarchyLevel: (id) => axios.delete(`${API_BASE}/store-hierarchy/${id}`),
};
