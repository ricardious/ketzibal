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

if (import.meta.env.DEV) {
  // acceso a la tienda desde la consola durante el desarrollo
  void import('./ui/store').then(({ useStore }) => ((window as unknown as { ketzibal: unknown }).ketzibal = useStore));
}
