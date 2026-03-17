import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YOUTUBE_TOKEN_STORAGE_KEY,
  YOUTUBE_UPLOAD_SCOPE,
  useYouTubeAuth,
} from './use-youtube-auth';

describe('useYouTubeAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('starts disconnected when no token exists', () => {
    const { result } = renderHook(() => useYouTubeAuth());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectedLabel).toBeNull();
    expect(result.current.connectionErrorMessage).toBeNull();
  });

  it('initiates Google OAuth with the YouTube upload scope', async () => {
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useYouTubeAuth({
        clientId: 'test-client-id',
        navigate,
        randomState: () => 'state-123',
      }),
    );

    await act(async () => {
      result.current.connectYouTube();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    const authUrl = String(navigate.mock.calls[0][0]);
    expect(authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    expect(authUrl).toContain('client_id=test-client-id');
    expect(authUrl).toContain('response_type=token');
    expect(authUrl).toContain(
      `scope=${encodeURIComponent(YOUTUBE_UPLOAD_SCOPE)}`,
    );
  });

  it('persists token and moves to connected state after successful authorization', async () => {
    sessionStorage.setItem('reelpod.youtube.oauth-state', 'state-123');
    window.history.replaceState(
      null,
      '',
      `/#access_token=token-abc&token_type=Bearer&scope=${encodeURIComponent(YOUTUBE_UPLOAD_SCOPE)}&expires_in=3600&state=state-123`,
    );

    const { result } = renderHook(() =>
      useYouTubeAuth({
        now: () => 1_700_000_000_000,
      }),
    );

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
      expect(result.current.connectedLabel).toBe('Connected');
    });

    const storedTokenRaw = localStorage.getItem(YOUTUBE_TOKEN_STORAGE_KEY);
    expect(storedTokenRaw).toBeTruthy();
    const storedToken = JSON.parse(String(storedTokenRaw)) as {
      accessToken: string;
      tokenType: string;
      scope: string;
      expiresAt: number;
    };
    expect(storedToken.accessToken).toBe('token-abc');
    expect(storedToken.tokenType).toBe('Bearer');
    expect(storedToken.scope).toBe(YOUTUBE_UPLOAD_SCOPE);
    expect(window.location.hash).toBe('');
  });

  it('restores connected state from localStorage token on reload', async () => {
    localStorage.setItem(
      YOUTUBE_TOKEN_STORAGE_KEY,
      JSON.stringify({
        accessToken: 'persisted-token',
        tokenType: 'Bearer',
        scope: YOUTUBE_UPLOAD_SCOPE,
        expiresAt: Date.now() + 60_000,
      }),
    );

    const { result } = renderHook(() => useYouTubeAuth());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
      expect(result.current.connectedLabel).toBe('Connected');
    });
  });

  it('shows error and remains disconnected when authorization is cancelled', async () => {
    window.history.replaceState(
      null,
      '',
      '/#error=access_denied&error_description=The+user+denied+the+request',
    );

    const { result } = renderHook(() => useYouTubeAuth());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
      expect(result.current.connectionErrorMessage).toContain('cancelled');
    });
    expect(localStorage.getItem(YOUTUBE_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
