import { useEffect, useRef, useState } from 'react';

const MAX_DESCRIPTION_LENGTH = 5000;
const DESCRIPTION_WARN_THRESHOLD = 4500;

export interface YouTubePublishDialogProps {
  initialTitle: string;
  initialDescription: string;
  onCancel: () => void;
  onPublish: (title: string, description: string) => void;
}

export function YouTubePublishDialog({
  initialTitle,
  initialDescription,
  onCancel,
  onPublish,
}: YouTubePublishDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const containerRef = useRef<HTMLDivElement>(null);

  const isTitleEmpty = title.trim().length === 0;
  const isDescriptionOverLimit = description.length > MAX_DESCRIPTION_LENGTH;
  const isPublishDisabled = isTitleEmpty || isDescriptionOverLimit;

  const descCounterColor =
    isDescriptionOverLimit
      ? 'text-red-300'
      : description.length > DESCRIPTION_WARN_THRESHOLD
        ? 'text-amber-300'
        : 'text-lofi-textMuted';

  // Focus the title input on mount and trap keyboard focus inside the dialog.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const titleInput = container.querySelector<HTMLElement>(
      '[data-testid="youtube-publish-dialog-title"]',
    );
    titleInput?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publish to YouTube"
      data-testid="youtube-publish-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        ref={containerRef}
        className="relative w-full max-w-lg space-y-4 rounded-sm border border-lofi-accentMuted bg-lofi-panel p-6 shadow-xl"
      >
        <h2 className="text-base font-semibold text-lofi-text">Publish to YouTube</h2>

        <div className="space-y-1">
          <label
            htmlFor="yt-publish-title"
            className="block text-sm font-semibold text-lofi-text"
          >
            Title
          </label>
          <input
            id="yt-publish-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="youtube-publish-dialog-title"
            className="w-full rounded-sm border border-lofi-accentMuted bg-lofi-bg px-3 py-2 text-sm text-lofi-text outline-none transition focus-visible:ring-2 focus-visible:ring-lofi-accent"
          />
          {isTitleEmpty && (
            <p
              data-testid="youtube-publish-title-required"
              className="text-xs text-red-300"
            >
              Title is required
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="yt-publish-description"
            className="block text-sm font-semibold text-lofi-text"
          >
            Description
          </label>
          <textarea
            id="yt-publish-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            data-testid="youtube-publish-dialog-description"
            className="w-full rounded-sm border border-lofi-accentMuted bg-lofi-bg px-3 py-2 text-sm text-lofi-text outline-none transition focus-visible:ring-2 focus-visible:ring-lofi-accent"
          />
          <p
            data-testid="youtube-publish-description-counter"
            className={`text-right text-xs ${descCounterColor}`}
          >
            {description.length} / {MAX_DESCRIPTION_LENGTH}
            {isDescriptionOverLimit && (
              <span className="ml-1">— description is too long</span>
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="youtube-publish-cancel"
            className="interactive-lift min-h-11 rounded-sm border border-lofi-accentMuted/70 bg-lofi-bg px-4 py-2 text-sm font-semibold text-lofi-text outline-none transition hover:bg-lofi-bg/80 focus-visible:ring-2 focus-visible:ring-lofi-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPublishDisabled}
            onClick={() => {
              if (!isPublishDisabled) onPublish(title, description);
            }}
            data-testid="youtube-publish-confirm"
            className="interactive-lift min-h-11 rounded-sm border border-red-300/70 bg-red-950/30 px-4 py-2 text-sm font-semibold text-red-100 outline-none transition hover:bg-red-900/40 focus-visible:ring-2 focus-visible:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}
