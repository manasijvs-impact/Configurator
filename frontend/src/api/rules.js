import { axios, API_BASE } from './_base';

export default {
  validateDefaultRules: () => axios.get(`${API_BASE}/rules/validate-defaults`),
};
