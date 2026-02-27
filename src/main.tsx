import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrapStrudelRepl } from './lib/strudel-repl';
import './index.css';

const root = createRoot(document.getElementById('root')!);

function renderApp(): void {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

function getBootstrapErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Could not initialize audio runtime: Unknown REPL error';
}

function renderBootstrapError(error: unknown): void {
  root.render(
    <StrictMode>
      <main className="flex min-h-screen items-center justify-center bg-lofi-bg px-6 py-10 text-lofi-text">
        <section
          role="alert"
          className="w-full max-w-2xl space-y-3 rounded-lg border border-red-400/60 bg-red-950/35 p-6 shadow-lg"
        >
          <h1 className="font-serif text-3xl font-bold">Audio Setup Failed</h1>
          <p className="text-sm leading-relaxed text-red-100">{getBootstrapErrorMessage(error)}</p>
        </section>
      </main>
    </StrictMode>
  );
}

async function bootstrapApp(): Promise<void> {
  try {
    await bootstrapStrudelRepl();
    renderApp();
  } catch (error) {
    console.error('Failed to initialize Strudel REPL.', error);
    renderBootstrapError(error);
  }
}

void bootstrapApp();
