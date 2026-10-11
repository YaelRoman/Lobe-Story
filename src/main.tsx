import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import App from './App';
import { startPrefs } from './state/prefs';

// Restore the remembered display preferences before the first render (no flash of the wrong theme).
startPrefs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
