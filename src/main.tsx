import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrapStrudelRepl } from './lib/strudel-repl';

void bootstrapStrudelRepl().catch((error) => {
  console.error('Failed to initialize Strudel REPL.', error);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
