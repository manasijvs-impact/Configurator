import React from 'react';
import ReactDOM from 'react-dom/client';
import MigratorApp from './MigratorApp';

// Isolated entry for the DB Migrator tool. This does NOT touch Pranjal's
// App.jsx / main.jsx — it mounts our own component tree into its own root,
// served by the same Vite dev server at /migrator.html.
ReactDOM.createRoot(document.getElementById('migrator-root')).render(
  <React.StrictMode>
    <MigratorApp />
  </React.StrictMode>,
);
