import { YOUTUBE_TOKEN_STORAGE_KEY } from '../hooks/use-youtube-auth';

export interface YouTubeUploadToken {
  accessToken: string;
  tokenType: string;
  scope: string;
  expiresAt: number;
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
}

export interface UploadVideoToYouTubeParams {
  blob: Blob;
  filename: string;
  token: YouTubeUploadToken;
}

const YOUTUBE_UPLOAD_PATH = '/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart';
export const YOUTUBE_VIDEOS_INSERT_UPLOAD_URL = import.meta.env.DEV
  ? `/yt-upload${YOUTUBE_UPLOAD_PATH}`
  : `https://www.googleapis.com${YOUTUBE_UPLOAD_PATH}`;

/** Thrown when the YouTube API returns a 401 — the stored token must be cleared. */
export class YouTubeUnauthorizedError extends Error {
  constructor() {
    super('YouTube session expired. Please reconnect your account.');
    this.name = 'YouTubeUnauthorizedError';
  }
}

function buildMultipartBody(
  metadata: Record<string, unknown>,
  blob: Blob,
  boundary: string,
): Blob {
  const encoder = new TextEncoder();
  const metadataJson = JSON.stringify(metadata);
  const preamble = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'video/mp4'}\r\n\r\n`,
  );
  const epilogue = encoder.encode(`\r\n--${boundary}--`);
  return new Blob([preamble, blob, epilogue]);
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidate = record.error ?? record.detail;

  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }

  if (typeof candidate === 'object' && candidate !== null) {
    const nested = candidate as Record<string, unknown>;
    const nestedMessage = nested.message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
      return nestedMessage.trim();
    }
  }

  return null;
}

function buildVideoTitle(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.length === 0) {
    return 'ReelPod Studio Recording';
  }

  return trimmed.replace(/\.[^.]+$/, '');
}

export function readYouTubeUploadTokenFromStorage(
  now: number = Date.now(),
): YouTubeUploadToken | null {
  const raw = localStorage.getItem(YOUTUBE_TOKEN_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<YouTubeUploadToken>;
    if (
      typeof parsed.accessToken !== 'string' ||
      parsed.accessToken.length === 0 ||
      typeof parsed.tokenType !== 'string' ||
      parsed.tokenType.length === 0 ||
      typeof parsed.scope !== 'string' ||
      parsed.scope.length === 0 ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= now
    ) {
      localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
      return null;
    }

    return parsed as YouTubeUploadToken;
  } catch {
    localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
    return null;
  }
}

export async function uploadVideoToYouTube({
  blob,
  filename,
  token,
}: UploadVideoToYouTubeParams): Promise<YouTubeUploadResult> {
  const boundary = `reelpod-${Date.now()}`;
  const metadata = {
    snippet: { title: buildVideoTitle(filename) },
    status: { privacyStatus: 'unlisted' },
  };
  const body = buildMultipartBody(metadata, blob, boundary);

  const response = await fetch(YOUTUBE_VIDEOS_INSERT_UPLOAD_URL, {
    method: 'POST',
    headers: {
      authorization: `${token.tokenType} ${token.accessToken}`,
      'content-type': `multipart/related; boundary="${boundary}"`,
    },
    body,
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem(YOUTUBE_TOKEN_STORAGE_KEY);
      throw new YouTubeUnauthorizedError();
    }

    let errorMessage: string | null = null;
    try {
      const payload: unknown = await response.json();
      errorMessage = extractErrorMessage(payload);
    } catch {
      // ignore parse errors for non-JSON responses
    }

    throw new Error(
      errorMessage ?? `YouTube upload failed with status ${response.status}.`,
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error('YouTube upload failed: invalid API response.');
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('YouTube upload failed: invalid API response.');
  }

  const videoId = (payload as Record<string, unknown>).id;
  if (typeof videoId !== 'string' || videoId.trim().length === 0) {
    throw new Error('YouTube upload failed: missing uploaded video ID.');
  }

  return {
    videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
