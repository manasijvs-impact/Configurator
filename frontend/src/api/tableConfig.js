import { axios, API_BASE } from './_base';

export default {
  // Table Configuration
  getReportingAttributesMetadata: () => axios.get(`${API_BASE}/table-config/reporting-attributes`),
  getProductAttributesMetadata: () => axios.get(`${API_BASE}/table-config/product-attributes`),
  getProductDetailsColumns: () => axios.get(`${API_BASE}/table-config/product-details/columns`),

  // Product Attributes Metadata Editor
  getProductAttributesMetadataSchema: () => axios.get(`${API_BASE}/product-attributes-metadata/schema`),
  getProductAttributesMetadataFull: () => axios.get(`${API_BASE}/product-attributes-metadata`),
  updateProductAttributeMetadata: (attributeId, data) => axios.put(`${API_BASE}/product-attributes-metadata/${attributeId}`, data),
  bulkUpdateProductAttributesMetadata: (updates) => axios.put(`${API_BASE}/product-attributes-metadata/bulk`, { updates }),
};
