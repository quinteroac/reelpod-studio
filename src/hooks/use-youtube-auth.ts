import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_TOKEN_STORAGE_KEY = 'reelpod.youtube.oauth-token';
const YOUTUBE_OAUTH_STATE_STORAGE_KEY = 'reelpod.youtube.oauth-state';
const DEFAULT_YOUTUBE_CLIENT_ID = 'reelpod-studio-local-client-id';
const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

interface StoredYoutubeToken {
  accessToken: string;
  tokenType: string;
  scope: string;
  expiresAt: number;
}

interface OAuthCallbackResult {
  accessToken: string | null;
  tokenType: string | null;
  scope: string | null;
  state: string | null;
  expiresInSeconds: number | null;
  error: string | null;
  errorDescription: string | null;
}

export interface UseYouTubeAuthOptions {
  clientId?: string;
  now?: () => number;
  navigate?: (url: string) => void;
  randomState?: () => string;
}

export interface UseYouTubeAuthResult {
  connectedLabel: string | null;
  connectionErrorMessage: string | null;
  isConnected: boolean;
  connectYouTube: () => void;
  disconnectYouTube: () => void;
}

interface YouTubeAuthState {
  connectedLabel: string | null;
  connectionErrorMessage: string | null;
}

function parseOAuthCallbackHash(hash: string): OAuthCallbackResult | null {
  if (!hash.startsWith('#')) {
    return null;
  }

  const params = new URLSearchParams(hash.slice(1));
  const containsOAuthData = params.has('access_token') || params.has('error');
  if (!containsOAuthData) {
    return null;
  }

  const expiresValue = params.get('expires_in');
  const expiresInSeconds = expiresValue === null ? null : Number(expiresValue);
  const hasValidExpires = expiresInSeconds !== null && Number.isFinite(expiresInSeconds);

  return {
    accessToken: params.get('access_token'),
    tokenType: params.get('token_type'),
    scope: params.get('scope'),
    state: params.get('state'),
    expiresInSeconds: hasValidExpires ? expiresInSeconds : null,
    error: params.get('error'),
    errorDescription: params.get('error_description'),
  };
}

function buildOAuthAuthorizeUrl(clientId: string, state: string): string {
  const redirectUri = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: YOUTUBE_UPLOAD_SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

function readStoredToken(now: number): StoredYoutubeToken | null {
  const raw = localStorage.getItem(YOUTUBE_TOKEN_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredYoutubeToken>;
    if (
      typeof parsed.accessToken !== 'string' ||
      parsed.accessToken.length === 0 ||
      typeof parsed.tokenType !== 'string' ||
      parsed.tokenType.length === 0 ||
      typeof parsed.scope !== 'string' ||
      parsed.scope.length === 0 ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
      return null;
    }

    if (parsed.expiresAt <= now) {
      localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
      return null;
    }

    return parsed as StoredYoutubeToken;
  } catch {
    localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
    return null;
  }
}

function clearOAuthHashFromUrl(): void {
  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', cleanUrl);
}

function buildOAuthErrorMessage(result: OAuthCallbackResult): string {
  if (result.error === 'access_denied') {
    return 'YouTube connection was cancelled.';
  }

  if (result.errorDescription) {
    return `YouTube connection failed: ${result.errorDescription}.`;
  }

  if (result.error) {
    return `YouTube connection failed: ${result.error}.`;
  }

  return 'YouTube connection failed.';
}

export function useYouTubeAuth(options: UseYouTubeAuthOptions = {}): UseYouTubeAuthResult {
  const [authState, setAuthState] = useState<YouTubeAuthState>(() => {
    const now = options.now ?? (() => Date.now());
    const callbackResult = parseOAuthCallbackHash(window.location.hash);
    if (callbackResult) {
      clearOAuthHashFromUrl();
      localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);

      if (callbackResult.error) {
        return {
          connectedLabel: null,
          connectionErrorMessage: buildOAuthErrorMessage(callbackResult),
        };
      }

      const expectedState = sessionStorage.getItem(YOUTUBE_OAUTH_STATE_STORAGE_KEY);
      sessionStorage.removeItem(YOUTUBE_OAUTH_STATE_STORAGE_KEY);
      if (
        expectedState &&
        callbackResult.state &&
        callbackResult.state !== expectedState
      ) {
        return {
          connectedLabel: null,
          connectionErrorMessage: 'YouTube connection failed: invalid OAuth state.',
        };
      }

      if (
        !callbackResult.accessToken ||
        !callbackResult.tokenType ||
        !callbackResult.scope
      ) {
        return {
          connectedLabel: null,
          connectionErrorMessage: 'YouTube connection failed: missing OAuth token details.',
        };
      }

      const scopeItems = callbackResult.scope.split(/\s+/).filter(Boolean);
      if (!scopeItems.includes(YOUTUBE_UPLOAD_SCOPE)) {
        return {
          connectedLabel: null,
          connectionErrorMessage: 'YouTube connection failed: required upload scope was not granted.',
        };
      }

      const expiresIn = callbackResult.expiresInSeconds ?? 3600;
      const expiresAt = now() + expiresIn * 1000;
      const token: StoredYoutubeToken = {
        accessToken: callbackResult.accessToken,
        tokenType: callbackResult.tokenType,
        scope: callbackResult.scope,
        expiresAt,
      };

      localStorage.setItem(YOUTUBE_TOKEN_STORAGE_KEY, JSON.stringify(token));
      return {
        connectedLabel: 'Connected',
        connectionErrorMessage: null,
      };
    }

    const storedToken = readStoredToken(now());
    if (storedToken) {
      return {
        connectedLabel: 'Connected',
        connectionErrorMessage: null,
      };
    }

    return {
      connectedLabel: null,
      connectionErrorMessage: null,
    };
  });

  const connectYouTube = useCallback(() => {
    const randomState = options.randomState ?? (() => crypto.randomUUID());
    const navigate = options.navigate ?? ((url: string) => window.location.assign(url));
    setAuthState((previous) => ({ ...previous, connectionErrorMessage: null }));
    const state = randomState();
    sessionStorage.setItem(YOUTUBE_OAUTH_STATE_STORAGE_KEY, state);
    const clientId =
      options.clientId ?? (import.meta.env.VITE_YOUTUBE_CLIENT_ID as string | undefined) ?? DEFAULT_YOUTUBE_CLIENT_ID;
    const authorizeUrl = buildOAuthAuthorizeUrl(clientId, state);
    navigate(authorizeUrl);
  }, [options.clientId, options.navigate, options.randomState]);

  const disconnectYouTube = useCallback(() => {
    localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
    setAuthState({ connectedLabel: null, connectionErrorMessage: null });
  }, []);

  // Keep a ref so the expiry timer always calls the latest connectYouTube
  const connectYouTubeRef = useRef(connectYouTube);
  useEffect(() => {
    connectYouTubeRef.current = connectYouTube;
  }, [connectYouTube]);

  useEffect(() => {
    if (authState.connectedLabel === null) return;

    const raw = localStorage.getItem(YOUTUBE_TOKEN_STORAGE_KEY);
    if (!raw) return;

    let expiresAt: number;
    try {
      expiresAt = (JSON.parse(raw) as Partial<StoredYoutubeToken>).expiresAt ?? 0;
    } catch {
      return;
    }

    const now = options.now ?? (() => Date.now());
    const msUntilExpiry = expiresAt - now();
    if (msUntilExpiry <= 0) {
      connectYouTubeRef.current();
      return;
    }

    const timerId = window.setTimeout(() => {
      connectYouTubeRef.current();
    }, msUntilExpiry);

    return () => window.clearTimeout(timerId);
  }, [authState.connectedLabel, options.now]);

  return useMemo(
    () => ({
      connectedLabel: authState.connectedLabel,
      connectionErrorMessage: authState.connectionErrorMessage,
      isConnected: authState.connectedLabel !== null,
      connectYouTube,
      disconnectYouTube,
    }),
    [authState.connectedLabel, authState.connectionErrorMessage, connectYouTube, disconnectYouTube],
  );
}
