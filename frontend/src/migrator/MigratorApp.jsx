import React, { useState } from 'react';
import { MdSync, MdCheckCircle } from 'react-icons/md';
import { migratorApi, errText } from './api';
import { THEME } from './theme';
import Step1Connect from './Step1Connect';
import Step2Classify from './Step2Classify';
import Step3Results from './Step3Results';

const STEP_LABELS = ['Connection', 'Classify', 'Review & export'];

function Stepper({ step }) {
  return (
    <ol style={{ display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 16px', fontSize: 14 }}>
      {STEP_LABELS.map((label, idx) => {
        const s = idx + 1, done = s < step, cur = s === step;
        return (
          <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 12, fontWeight: 700,
              background: cur ? THEME.indigo : done ? THEME.emerald : '#cbd5e1',
              color: cur || done ? '#fff' : '#475569',
            }}>{done ? '✓' : s}</span>
            <span style={{ fontWeight: cur ? 600 : 400, color: cur ? THEME.text : THEME.textMuted }}>{label}</span>
            {s < 3 && <span style={{ margin: '0 4px', color: '#cbd5e1' }}>———</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default function MigratorApp() {
  const [step, setStep] = useState(1);
  const [connection, setConnection] = useState(null); // { srcEnv, tgtEnv, srcSchema, tgtSchema, email, cfg }

  // Step 2 classification state (lifted so it persists across navigation).
  const [tables, setTables] = useState([]);
  const [functions, setFunctions] = useState([]);
  const [meta, setMeta] = useState(null); // threshold/csv-path info from backend
  const [objLoading, setObjLoading] = useState(false);
  const [objError, setObjError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // True when the in-memory classification has edits not yet written to the
  // shared CSV. Set by the wrapped setters below; cleared on load/save.
  const [dirty, setDirty] = useState(false);

  // Step 3 diff data.
  const [diffData, setDiffData] = useState(null);
  const [diffIsSample, setDiffIsSample] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

  const applyModel = (data) => {
    setTables(data.tables || []);
    setFunctions(data.functions || []);
    setMeta({
      threshold_table: data.threshold_table, static_seed_count: data.static_seed_count,
      table_csv_path: data.table_csv_path, function_csv_path: data.function_csv_path,
    });
    setDirty(false);  // freshly loaded/saved model is in sync with the CSV
  };

  // Wrapped setters handed to Step 2: any USER edit flips the dirty flag.
  // applyModel still uses the raw setters above, so loads/saves don't mark dirty.
  const editTables = (updater) => { setTables(updater); setDirty(true); };
  const editFunctions = (updater) => { setFunctions(updater); setDirty(true); };

  const loadClassification = async () => {
    setObjLoading(true);
    setObjError('');
    try {
      const { data } = await migratorApi.getClassification();
      applyModel(data);
    } catch (err) {
      setObjError(errText(err));
    } finally {
      setObjLoading(false);
    }
  };

  const saveClassification = async () => {
    setSaving(true);
    try {
      const tablesPayload = tables.map((t) => ({
        name: t.name, override: t.override || '',
        skip_data_check: !!t.skip_data_check, skip_schema_check: !!t.skip_schema_check,
        data_exclude_columns: t.data_exclude_columns || [],
      }));
      const fnPayload = functions.map((f) => ({
        name: f.name, arg_signature: f.arg_signature, skip_body_check: !!f.skip_body_check,
      }));
      const { data } = await migratorApi.saveClassification({ tables: tablesPayload, functions: fnPayload });
      applyModel(data);
      setSavedAt(Date.now());
      return true;
    } catch (err) {
      setObjError(errText(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleConnected = (conn) => {
    setConnection(conn);
    setStep(2);
    loadClassification();
  };

  const handleRun = async () => {
    // Run the real comparison engine. This can take a while (it fetches rows for
    // every static table + function bodies over VPN), so show a running state
    // and surface backend errors instead of silently hiding them.
    setRunning(true);
    setRunError('');
    try {
      // Auto-save any unsaved Step 2 edits first, so the validation always
      // reflects exactly what's on screen (the backend /diffs reads the CSV).
      if (dirty) {
        const ok = await saveClassification();
        if (!ok) {
          setRunError('Could not save classification before running. Fix the error above and retry.');
          setRunning(false);
          return;
        }
      }
      const { data } = await migratorApi.getDiffs();
      setDiffData(data);
      setDiffIsSample(false);
      setStep(3);
    } catch (err) {
      setRunError(errText(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: THEME.bg, fontFamily: 'Inter, system-ui, sans-serif', color: THEME.text }}>
      <style>{`@keyframes mig-spin { to { transform: rotate(360deg); } } .spin { animation: mig-spin 1s linear infinite; }`}</style>
      {/* Header */}
      <header style={{
        background: THEME.surface, borderBottom: `1px solid ${THEME.border}`,
        padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, background: THEME.indigo,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>
          <MdSync size={20} />
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>DB Migrator</div>
          <div style={{ fontSize: 12, color: THEME.textMuted }}>Source → Target schema &amp; data migration</div>
        </div>
        {connection && (
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 12px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 20,
          }}>
            <MdCheckCircle size={16} style={{ color: '#16a34a' }} />
            <span style={{ fontSize: 13, color: '#166534', fontWeight: 500 }}>
              {connection.srcEnv} → {connection.tgtEnv}
            </span>
          </div>
        )}
      </header>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '20px 28px 48px' }}>
        <Stepper step={step} />

        {step === 1 && (
          <Step1Connect initial={connection} onConnected={handleConnected} />
        )}

        {step === 2 && (
          <Step2Classify
            tables={tables} setTables={editTables}
            functions={functions} setFunctions={editFunctions}
            meta={meta} loading={objLoading} error={objError}
            onReload={loadClassification} onSave={saveClassification}
            saving={saving} savedAt={savedAt} dirty={dirty}
            onBack={() => setStep(1)} onRun={handleRun}
            running={running} runError={runError}
            sourceEnv={connection?.srcEnv} targetEnv={connection?.tgtEnv}
          />
        )}

        {step === 3 && diffData && (
          <Step3Results data={diffData} isSample={diffIsSample} onBack={() => setStep(2)} />
        )}
      </div>
    </div>
  );
}
