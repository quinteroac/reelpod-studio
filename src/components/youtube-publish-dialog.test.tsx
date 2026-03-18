import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YouTubePublishDialog } from './youtube-publish-dialog';

describe('YouTubePublishDialog', () => {
  it('renders with pre-filled title and description', () => {
    render(
      <YouTubePublishDialog
        initialTitle="My Track Title"
        initialDescription="A great lofi track."
        onCancel={vi.fn()}
        onPublish={vi.fn()}
      />,
    );

    expect(screen.getByTestId('youtube-publish-dialog-title')).toHaveValue(
      'My Track Title',
    );
    expect(
      screen.getByTestId('youtube-publish-dialog-description'),
    ).toHaveValue('A great lofi track.');
  });

  it('Publish button is enabled when title is non-empty', () => {
    render(
      <YouTubePublishDialog
        initialTitle="Some Title"
        initialDescription=""
        onCancel={vi.fn()}
        onPublish={vi.fn()}
      />,
    );

    expect(screen.getByTestId('youtube-publish-confirm')).not.toBeDisabled();
    expect(
      screen.queryByTestId('youtube-publish-title-required'),
    ).not.toBeInTheDocument();
  });

  it('Publish button is disabled and required message shown when title is empty', () => {
    render(
      <YouTubePublishDialog
        initialTitle=""
        initialDescription=""
        onCancel={vi.fn()}
        onPublish={vi.fn()}
      />,
    );

    expect(screen.getByTestId('youtube-publish-confirm')).toBeDisabled();
    expect(
      screen.getByTestId('youtube-publish-title-required'),
    ).toBeInTheDocument();
  });

  it('Publish button becomes disabled after user clears the title', () => {
    render(
      <YouTubePublishDialog
        initialTitle="Original Title"
        initialDescription=""
        onCancel={vi.fn()}
        onPublish={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('youtube-publish-dialog-title'), {
      target: { value: '' },
    });

    expect(screen.getByTestId('youtube-publish-confirm')).toBeDisabled();
    expect(
      screen.getByTestId('youtube-publish-title-required'),
    ).toBeInTheDocument();
  });

  it('calls onPublish with edited title and description verbatim', () => {
    const onPublish = vi.fn();

    render(
      <YouTubePublishDialog
        initialTitle="Original Title"
        initialDescription="Original desc"
        onCancel={vi.fn()}
        onPublish={onPublish}
      />,
    );

    fireEvent.change(screen.getByTestId('youtube-publish-dialog-title'), {
      target: { value: 'Edited Title' },
    });
    fireEvent.change(
      screen.getByTestId('youtube-publish-dialog-description'),
      { target: { value: 'Edited description text' } },
    );
    fireEvent.click(screen.getByTestId('youtube-publish-confirm'));

    expect(onPublish).toHaveBeenCalledOnce();
    expect(onPublish).toHaveBeenCalledWith('Edited Title', 'Edited description text');
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();

    render(
      <YouTubePublishDialog
        initialTitle="Title"
        initialDescription=""
        onCancel={onCancel}
        onPublish={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('youtube-publish-cancel'));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();

    render(
      <YouTubePublishDialog
        initialTitle="Title"
        initialDescription=""
        onCancel={onCancel}
        onPublish={vi.fn()}
      />,
    );

    // The backdrop is the aria-hidden div behind the dialog panel
    const backdrop = screen
      .getByTestId('youtube-publish-dialog')
      .querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
