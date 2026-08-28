import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Self-hosted variable fonts avoid a render-blocking CDN round trip. Import them
// here so Vite, rather than Tailwind's PostCSS pipeline, resolves their assets.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/outfit/wght.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
