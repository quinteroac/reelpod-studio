from __future__ import annotations


class QueueItemNotFoundError(RuntimeError):
    pass


class AudioGenerationFailedError(RuntimeError):
    pass


class AudioGenerationTimeoutError(RuntimeError):
    pass


class AudioNotReadyError(RuntimeError):
    pass


class ImageGenerationFailedError(RuntimeError):
    pass
