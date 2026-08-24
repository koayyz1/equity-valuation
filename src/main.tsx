import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts — previously Inter was declared but never loaded, so the
// app silently fell back to Segoe UI / Consolas on Windows.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
