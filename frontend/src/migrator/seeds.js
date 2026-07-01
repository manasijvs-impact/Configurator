// Authoritative list of STATIC tables in base_pricing (42). A discovered table
// is seeded as static iff its name is in this set; everything else is dynamic
// (schema-only). Mirrors STATIC_SEED in the diff_viewer.html mockup.
export const STATIC_SEED = new Set([
  'bp_app_status_master', 'bp_actions', 'bp_bucket_config', 'bp_channel_config',
  'bp_channel_cost_logic_config', 'bp_comparison_types', 'bp_competitor_attributes_metadata',
  'bp_customer_segment_config', 'bp_customer_segment_master', 'bp_grouping_type_level',
  'bp_ongoing_strategy_action_status_transitions', 'bp_price_bucket_details',
  'bp_product_attributes_metadata', 'bp_product_hierarchy_level',
  'bp_product_store_attributes_metadata', 'bp_reporting_attributes_metadata',
  'bp_rule_attributes_metadata', 'bp_rule_types', 'bp_scope_level', 'bp_screen_hierarchies',
  'bp_store_attributes_metadata', 'bp_store_hierarchy_level', 'bp_strategy_status_level',
  'bp_sync_status', 'bp_table_metadata', 'bp_table_view_template_mapping',
  'bp_template_attributes_mapping', 'bp_templates_metadata', 'bp_validation',
  'bp_view_type_metadata', 'bp_strategy_current_stage_level', 'bp_notifier_config',
  'bp_upcoming_strategy_action_status_transitions', 'bp_kpi_metrics_config',
  'bp_decision_dashboard_kpi_metrics', 'bp_product_group_attributes_metadata',
  'bp_store_group_attributes_metadata', 'bp_strategy_price_recommendation_attributes_metadata',
  'bp_suffixes_metadata', 'bp_zone_attributes_metadata', 'bp_forecast_kpi_meta',
  'bp_forecast_cal_config',
]);

// Default values for the global run-config fields (Step 1), mirroring the mockup.
export const GLOBAL_DEFAULTS = {
  threshold: 'bp_template_attributes_mapping',
  exclude: 'temp_, unlogged_, bp_unlogged_',
  stale: '30',
};

// Sample diff payload used ONLY as a Step-3 PREVIEW when the backend /diffs
// endpoint isn't available yet. Shape matches the agreed migration_diffs JSON
// contract so the same UI renders real data once /diffs is built.
export const SAMPLE_DIFFS = {
  source: { label: 'SOURCE', schema: 'base_pricing' },
  target: { label: 'TARGET', schema: 'base_pricing' },
  summary: { total_diffs: 4, by_object_type: { table: 2, function: 1, procedure: 1 } },
  diffs: [
    {
      object_type: 'table', name: 'sp_execution_logs', category: 'missing_in_target',
      source_present: true, target_present: false,
      detail: 'Only in SOURCE. Table sp_execution_logs exists in source but is missing in target.',
    },
    {
      object_type: 'table', name: 'bp_customer_segment_config', category: 'schema_diff',
      source_present: true, target_present: true,
      detail: 'Column "segment_priority" (integer) present in source, missing in target.',
      column_diffs: [
        { column: 'segment_priority', kind: 'missing_in_target', source_type: 'integer', target_type: null },
        { column: 'legacy_code', kind: 'missing_in_source', source_type: null, target_type: 'character varying' },
        { column: 'updated_at', kind: 'type_diff', source_type: 'timestamp with time zone', target_type: 'timestamp without time zone' },
      ],
    },
    {
      object_type: 'function', name: 'fn_baseline_metrics_refresh', category: 'body_diff',
      arg_signature: 'p_zone_id integer',
      source_present: true, target_present: true,
      source_body: 'CREATE OR REPLACE FUNCTION fn_baseline_metrics_refresh(p_zone_id integer)\nRETURNS void AS $$\nBEGIN\n  DELETE FROM bp_baseline_metrics WHERE zone_id = p_zone_id;\n  INSERT INTO bp_baseline_metrics (zone_id, metric, value)\n  SELECT p_zone_id, metric, AVG(value)\n  FROM bp_price_history\n  WHERE zone_id = p_zone_id\n  GROUP BY metric;\nEND;\n$$ LANGUAGE plpgsql;',
      target_body: 'CREATE OR REPLACE FUNCTION fn_baseline_metrics_refresh(p_zone_id integer)\nRETURNS void AS $$\nBEGIN\n  DELETE FROM bp_baseline_metrics WHERE zone_id = p_zone_id;\n  INSERT INTO bp_baseline_metrics (zone_id, metric, value, refreshed_at)\n  SELECT p_zone_id, metric, AVG(value), now()\n  FROM bp_price_history\n  WHERE zone_id = p_zone_id AND active = true\n  GROUP BY metric;\nEND;\n$$ LANGUAGE plpgsql;',
      detail: 'Function body differs between source and target.',
    },
    {
      object_type: 'procedure', name: 'sp_baseline_data_cleanup', category: 'body_diff',
      arg_signature: '',
      source_present: true, target_present: true,
      source_body: 'CREATE OR REPLACE PROCEDURE sp_baseline_data_cleanup()\nLANGUAGE plpgsql AS $$\nBEGIN\n  DELETE FROM bp_baseline_metrics WHERE created_at < now() - interval \'90 days\';\nEND;\n$$;',
      target_body: 'CREATE OR REPLACE PROCEDURE sp_baseline_data_cleanup()\nLANGUAGE plpgsql AS $$\nBEGIN\n  DELETE FROM bp_baseline_metrics WHERE created_at < now() - interval \'30 days\';\n  DELETE FROM sp_execution_logs WHERE created_at < now() - interval \'30 days\';\nEND;\n$$;',
      detail: 'Procedure body differs between source and target.',
    },
  ],
};
