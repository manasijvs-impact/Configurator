import { axios, API_BASE } from './_base';

export default {
  // Data Validator - Connection
  getValidatorApplications: () => axios.get(`${API_BASE}/validator/applications`),
  getValidatorClients: (application) => axios.get(`${API_BASE}/validator/clients/${application}`),
  getValidatorEnvironments: (client) => axios.get(`${API_BASE}/validator/environments/${client}`),
  connectValidator: (application, client, environment) =>
    axios.post(`${API_BASE}/validator/connect`, null, { params: { application, client, environment } }),
  checkValidatorSchema: () => axios.get(`${API_BASE}/validator/check-schema`),
  disconnectValidator: () => axios.post(`${API_BASE}/validator/disconnect`),
  getValidatorStatus: () => axios.get(`${API_BASE}/validator/status`),
};
