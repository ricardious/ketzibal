import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/afacad-flux';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/source-code-pro';
import './styles/colors.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
