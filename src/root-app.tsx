import { App } from './App';
import { LivePage } from './live-page';

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function RootApp() {
  const pathname = normalizePathname(window.location.pathname);

  if (pathname === '/live') {
    return <LivePage />;
  }

  return <App />;
}
