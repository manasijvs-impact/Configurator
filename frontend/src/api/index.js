// Composes every api/*.js domain module into a single `api` object so consumers
// keep using `api.X(...)` with no changes.
import connection from './connection';
import hierarchy from './hierarchy';
import segments from './segments';
import screens from './screens';
import tableConfig from './tableConfig';
import validatorConnection from './validatorConnection';
import rules from './rules';

import recoMetrics from './validators/recoMetrics';
import monthlyForecast from './validators/monthlyForecast';
import monthlyActuals from './validators/monthlyActuals';
import summaryCards from './validators/summaryCards';
import monthlySummaryCards from './validators/monthlySummaryCards';
import monthlyDetailedView from './validators/monthlyDetailedView';
import recoGridData from './validators/recoGridData';

export const api = {
  ...connection,
  ...hierarchy,
  ...segments,
  ...screens,
  ...tableConfig,
  ...validatorConnection,
  ...rules,
  ...recoMetrics,
  ...monthlyForecast,
  ...monthlyActuals,
  ...summaryCards,
  ...monthlySummaryCards,
  ...monthlyDetailedView,
  ...recoGridData,
};
