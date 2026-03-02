import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({
  App: () => <div data-testid="app-page">app-page</div>
}));

vi.mock('./live-page', () => ({
  LivePage: () => <div data-testid="live-page">live-page</div>
}));

import { RootApp } from './root-app';

describe('RootApp routing', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders LivePage for /live route', () => {
    window.history.pushState({}, '', '/live');

    render(<RootApp />);

    expect(screen.getByTestId('live-page')).toBeInTheDocument();
    expect(screen.queryByTestId('app-page')).not.toBeInTheDocument();
  });

  it('renders App for non-live routes', () => {
    window.history.pushState({}, '', '/');

    render(<RootApp />);

    expect(screen.getByTestId('app-page')).toBeInTheDocument();
    expect(screen.queryByTestId('live-page')).not.toBeInTheDocument();
  });
});
