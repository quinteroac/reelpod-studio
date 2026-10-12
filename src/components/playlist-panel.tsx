import React from 'react';
import type { PlaylistTrack } from '../lib/playlist-api';
import { playlistTrackFileUrl } from '../lib/playlist-api';
import { formatPlaylistTrackCreatedAt } from '../lib/format-playlist-track-timestamp';

interface PlaylistPanelProps {
  // State
  activePlaylistId: string | null;
  allPlaylists: { id: string; name: string }[];
  playlistTracks: PlaylistTrack[];
  playlistHeaderName: string | null;
  playlistPanelError: string | null;
  playlistRenameError: string | null;
  playlistTrackUploadError: string | null;
  isEditingPlaylistName: boolean;
  playlistNameDraft: string;
  isPlaylistRenameSaving: boolean;
  playlistTrackPlayingId: string | null;
  // Refs
  playlistNameInputRef: React.RefObject<HTMLInputElement | null>;
  skipPlaylistNameBlurCommitRef: React.RefObject<boolean>;
  // Handlers
  onPlaylistNameDraftChange: (value: string) => void;
  onCommitPlaylistName: () => void;
  onCancelEditPlaylistName: () => void;
  onBeginEditPlaylistName: () => void;
  onActivePlaylistChange: (id: string) => void;
  onCreatePlaylist: () => void;
  onToggleTrackPlayback: (trackId: string) => void;
  onDeleteTrack: (track: PlaylistTrack) => void;
  // Confirmation dialog state (for Step 2 below)
  deleteConfirmTrack: PlaylistTrack | null;
  onDeleteConfirmClose: () => void;
  onDeleteConfirmProceed: () => void;
}

export function PlaylistPanel({
  activePlaylistId,
  allPlaylists,
  playlistTracks,
  playlistHeaderName,
  playlistPanelError,
  playlistRenameError,
  playlistTrackUploadError,
  isEditingPlaylistName,
  playlistNameDraft,
  isPlaylistRenameSaving,
  playlistTrackPlayingId,
  playlistNameInputRef,
  skipPlaylistNameBlurCommitRef,
  onPlaylistNameDraftChange,
  onCommitPlaylistName,
  onCancelEditPlaylistName,
  onBeginEditPlaylistName,
  onActivePlaylistChange,
  onCreatePlaylist,
  onToggleTrackPlayback,
  onDeleteTrack,
  deleteConfirmTrack,
  onDeleteConfirmClose,
  onDeleteConfirmProceed,
}: PlaylistPanelProps) {
  return (
    <>
      <div className="min-w-0 max-w-[min(100%,20rem)]">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-lofi-accentMuted">
          Queue
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label htmlFor="active-playlist-select" className="sr-only">
            Active playlist
          </label>
          <select
            id="active-playlist-select"
            data-testid="playlist-selector"
            className="min-w-0 max-w-[min(100%,18rem)] flex-1 rounded-sm border border-lofi-accent/50 bg-lofi-bg/80 px-2 py-1.5 text-sm font-medium text-lofi-text outline-none transition focus-visible:ring-2 focus-visible:ring-lofi-accent disabled:cursor-not-allowed disabled:opacity-50"
            value={activePlaylistId ?? ''}
            onChange={(e) => {
              onActivePlaylistChange(e.target.value);
            }}
            disabled={allPlaylists.length === 0}
            aria-label="Active playlist"
          >
            {allPlaylists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="new-playlist-button"
            className="interactive-lift shrink-0 rounded-sm border border-lofi-accent/45 bg-lofi-bg/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-lofi-accent outline-none transition hover:bg-lofi-accent/15 focus-visible:ring-2 focus-visible:ring-lofi-accent"
            onClick={() => onCreatePlaylist()}
            aria-label="New playlist"
          >
            New Playlist
          </button>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {isEditingPlaylistName ? (
            <input
              ref={playlistNameInputRef}
              type="text"
              data-testid="playlist-name-input"
              className="min-w-0 flex-1 rounded-sm border border-lofi-accent/50 bg-lofi-bg/80 px-2 py-1 text-sm font-semibold text-lofi-text outline-none focus-visible:ring-2 focus-visible:ring-lofi-accent disabled:opacity-60"
              value={playlistNameDraft}
              onChange={(e) => onPlaylistNameDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitPlaylistName();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelEditPlaylistName();
                }
              }}
              onBlur={() => {
                if (skipPlaylistNameBlurCommitRef.current) {
                  skipPlaylistNameBlurCommitRef.current = false;
                  return;
                }
                onCommitPlaylistName();
              }}
              disabled={isPlaylistRenameSaving}
              aria-label="Playlist name"
            />
          ) : (
            <h2
              className="min-w-0 flex-1 truncate text-sm font-semibold text-lofi-text"
              data-testid="playlist-header-name"
              title={playlistHeaderName ?? undefined}
            >
              {playlistHeaderName ?? '\u00a0'}
            </h2>
          )}
          {!isEditingPlaylistName &&
            activePlaylistId !== null &&
            playlistHeaderName !== null && (
              <button
                type="button"
                data-testid="playlist-rename-button"
                className="interactive-lift shrink-0 rounded-sm p-1.5 text-lofi-accent outline-none transition hover:bg-lofi-accent/20 focus-visible:ring-2 focus-visible:ring-lofi-accent"
                aria-label="Rename playlist"
                title="Rename playlist"
                onClick={onBeginEditPlaylistName}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
                  <path d="M13.5 6.5l4 4" />
                </svg>
              </button>
            )}
        </div>
      </div>

      {playlistPanelError && (
        <div
          role="alert"
          data-testid="playlist-panel-error"
          className="rounded-md border border-red-400/60 bg-red-950/40 p-3 text-sm font-semibold text-red-100"
        >
          {playlistPanelError}
        </div>
      )}
      {playlistRenameError && (
        <div
          role="alert"
          data-testid="playlist-rename-error"
          className="rounded-md border border-red-400/60 bg-red-950/40 p-3 text-sm font-semibold text-red-100"
        >
          {playlistRenameError}
        </div>
      )}
      {playlistTrackUploadError && (
        <div
          role="alert"
          data-testid="playlist-track-upload-error"
          className="rounded-md border border-red-400/60 bg-red-950/40 p-3 text-sm font-semibold text-red-100"
        >
          {playlistTrackUploadError}
        </div>
      )}

      {activePlaylistId !== null && (
        <div className="space-y-2" data-testid="playlist-tracks-panel">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-lofi-accentMuted">
            Playlist
          </h3>
          {playlistTracks.length === 0 ? (
            <p
              className="text-xs text-lofi-accentMuted"
              data-testid="playlist-tracks-empty"
            >
              No tracks saved yet — recordings appear here automatically.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="playlist-tracks">
              {playlistTracks.map((t) => (
                <li
                  key={t.id}
                  data-testid={`playlist-track-${t.id}`}
                  className="rounded-sm border border-lofi-accentMuted/50 bg-lofi-bg/30 px-3 py-2 text-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p
                        data-testid={`playlist-track-filename-${t.id}`}
                        className="truncate font-semibold text-lofi-text"
                      >
                        {t.filename}
                      </p>
                      <p
                        className="text-xs text-lofi-accentMuted"
                        data-testid={`playlist-track-meta-${t.id}`}
                      >
                        <span data-testid={`playlist-track-size-${t.id}`}>
                          {(t.size_bytes / (1024 * 1024)).toFixed(2)} MB
                        </span>
                        <span className="mx-1">·</span>
                        <time
                          dateTime={t.created_at}
                          data-testid={`playlist-track-created-${t.id}`}
                        >
                          {formatPlaylistTrackCreatedAt(t.created_at)}
                        </time>
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid={`playlist-track-play-${t.id}`}
                        className="interactive-lift min-h-10 rounded-sm border border-lofi-accent bg-lofi-accent/20 px-3 py-1.5 text-xs font-semibold text-lofi-text outline-none transition hover:bg-lofi-accent/30 focus-visible:ring-2 focus-visible:ring-lofi-accent"
                        aria-pressed={playlistTrackPlayingId === t.id}
                        onClick={() => {
                          onToggleTrackPlayback(t.id);
                        }}
                      >
                        {playlistTrackPlayingId === t.id ? 'Hide player' : 'Play'}
                      </button>
                      <a
                        data-testid={`playlist-track-download-${t.id}`}
                        href={playlistTrackFileUrl(activePlaylistId, t.id)}
                        download={t.filename}
                        className="interactive-lift inline-flex min-h-10 items-center rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg/40 px-3 py-1.5 text-xs font-semibold text-lofi-text outline-none transition hover:border-lofi-accent/50 focus-visible:ring-2 focus-visible:ring-lofi-accent"
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        data-testid={`playlist-track-delete-${t.id}`}
                        className="interactive-lift min-h-10 rounded-sm border border-red-400/50 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-100 outline-none transition hover:bg-red-950/45 focus-visible:ring-2 focus-visible:ring-red-300"
                        onClick={() => {
                          onDeleteTrack(t);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {playlistTrackPlayingId === t.id && activePlaylistId !== null && (
                    <video
                      controls
                      playsInline
                      className="mt-2 w-full max-h-48 rounded-sm border border-lofi-accentMuted/40 bg-black/40"
                      src={playlistTrackFileUrl(activePlaylistId, t.id)}
                      data-testid={`playlist-track-video-${t.id}`}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {deleteConfirmTrack !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm track deletion"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={onDeleteConfirmClose}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-sm space-y-4 rounded-sm border border-lofi-accentMuted bg-lofi-panel p-6 shadow-xl">
            <h2 className="text-base font-semibold text-lofi-text">Delete track?</h2>
            <p className="text-sm text-lofi-text">
              Delete{' '}
              <span className="font-semibold">&ldquo;{deleteConfirmTrack.filename}&rdquo;</span>{' '}
              from this playlist? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onDeleteConfirmClose}
                data-testid="delete-track-cancel"
                className="interactive-lift min-h-11 rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg px-4 py-2 text-sm font-semibold text-lofi-text outline-none transition hover:bg-lofi-bg/80 focus-visible:ring-2 focus-visible:ring-lofi-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDeleteConfirmProceed}
                data-testid="delete-track-confirm"
                className="interactive-lift min-h-11 rounded-sm border border-red-300/70 bg-red-950/30 px-4 py-2 text-sm font-semibold text-red-100 outline-none transition hover:bg-red-900/40 focus-visible:ring-2 focus-visible:ring-red-300"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
