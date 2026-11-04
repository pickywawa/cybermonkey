import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/themes.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/features.css';

// The title bar only blends into the window on macOS (traffic lights); elsewhere the native frame is used.
document.documentElement.dataset.os = /Mac/i.test(navigator.platform) ? 'mac' : 'other';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
