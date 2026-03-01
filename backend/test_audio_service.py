from __future__ import annotations

import time
from collections.abc import Callable

import pytest

from models.queue import GenerationQueueItem
from models.schemas import GenerateRequestBody
from repositories import acestep_repository
from services import audio_service

WAV_HEADER = b"RIFF" + b"\x00" * 100


@pytest.fixture(autouse=True)
def reset_queue_state() -> None:
    audio_service.stop_queue_worker()
    audio_service.reset_generation_queue_for_tests()
    yield
    audio_service.stop_queue_worker()
    audio_service.reset_generation_queue_for_tests()


def _wait_until(
    condition: Callable[[], bool],
    *,
    timeout_seconds: float = 1.5,
    poll_interval_seconds: float = 0.005,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(poll_interval_seconds)
    raise AssertionError("Timed out while waiting for condition")


def _require_snapshot(item_id: str) -> GenerationQueueItem:
    snapshot = audio_service.get_queue_item_snapshot(item_id)
    assert snapshot is not None
    return snapshot


class TestBuildPrompt:
    def test_build_prompt_for_params_mode(self) -> None:
        body = GenerateRequestBody(mode="params", mood="chill", tempo=80, style="jazz")
        assert audio_service.build_prompt(body) == "chill lofi jazz, 80 BPM"

    def test_build_prompt_for_text_mode(self) -> None:
        body = GenerateRequestBody(mode="text", prompt="vinyl crackle and mellow piano")
        assert audio_service.build_prompt(body) == "vinyl crackle and mellow piano"

    def test_build_prompt_for_text_plus_params_mode(self) -> None:
        body = GenerateRequestBody(
            mode="text+params",
            prompt="soft bassline",
            mood="warm",
            style="ambient",
            tempo=96,
        )
        assert audio_service.build_prompt(body) == "soft bassline, warm, ambient, 96 BPM"

    def test_build_prompt_for_text_and_parameters_mode(self) -> None:
        body = GenerateRequestBody(
            mode="text-and-parameters",
            prompt="dusty drums",
            mood="moody",
            style="boom-bap",
            tempo=88,
        )
        assert audio_service.build_prompt(body) == "dusty drums, moody, boom-bap, 88 BPM"


class TestQueueEnqueue:
    def test_enqueue_generation_request_adds_queued_item(self) -> None:
        item = audio_service.enqueue_generation_request(
            GenerateRequestBody(mode="params", mood="mellow", tempo=75, style="jazz")
        )

        snapshot = audio_service.get_queue_item_snapshot(item.id)
        assert snapshot is not None
        assert snapshot.status == "queued"
        assert list(audio_service.queue_order) == [item.id]


class TestWaitForTerminalStatus:
    def test_wait_for_terminal_status_returns_completed_item(self) -> None:
        item_id = "item-completed"
        with audio_service.queue_condition:
            audio_service.queue_items[item_id] = GenerationQueueItem(
                id=item_id,
                prompt="prompt",
                status="completed",
                wav_bytes=WAV_HEADER,
            )
            audio_service.queue_condition.notify_all()

        result = audio_service.wait_for_terminal_status(item_id, timeout_seconds=0.2)

        assert result is not None
        assert result.status == "completed"
        assert result.wav_bytes == WAV_HEADER

    def test_wait_for_terminal_status_returns_failed_item(self) -> None:
        item_id = "item-failed"
        with audio_service.queue_condition:
            audio_service.queue_items[item_id] = GenerationQueueItem(
                id=item_id,
                prompt="prompt",
                status="failed",
                error_message="Audio generation failed",
            )
            audio_service.queue_condition.notify_all()

        result = audio_service.wait_for_terminal_status(item_id, timeout_seconds=0.2)

        assert result is not None
        assert result.status == "failed"
        assert result.error_message == "Audio generation failed"


class TestQueueWorker:
    def test_queue_worker_processes_items_sequentially_and_transitions_statuses(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        first = audio_service.enqueue_generation_request(
            GenerateRequestBody(mode="params", mood="warm", tempo=92, style="ambient")
        )
        second = audio_service.enqueue_generation_request(
            GenerateRequestBody(mode="params", mood="stormy", tempo=120, style="electro")
        )
        third = audio_service.enqueue_generation_request(
            GenerateRequestBody(mode="params", mood="calm", tempo=70, style="jazz")
        )

        first_snapshot = audio_service.get_queue_item_snapshot(first.id)
        second_snapshot = audio_service.get_queue_item_snapshot(second.id)
        third_snapshot = audio_service.get_queue_item_snapshot(third.id)
        assert first_snapshot is not None and first_snapshot.status == "queued"
        assert second_snapshot is not None and second_snapshot.status == "queued"
        assert third_snapshot is not None and third_snapshot.status == "queued"

        call_order: list[str] = []
        active_count = 0
        max_active_count = 0
        active_lock = audio_service.threading.Lock()

        def fake_generate_audio_bytes_for_prompt(
            prompt: str, tempo: int = 80, duration: int = 40
        ) -> bytes:
            nonlocal active_count, max_active_count
            assert isinstance(duration, int)
            call_order.append(f"{prompt}:{tempo}")

            with active_lock:
                active_count += 1
                max_active_count = max(max_active_count, active_count)

            current_ids = [first.id, second.id, third.id]
            statuses = {item_id: _require_snapshot(item_id).status for item_id in current_ids}
            assert "generating" in statuses.values()

            # Keep the job active briefly so other assertions can observe in-flight status.
            time.sleep(0.03)

            with active_lock:
                active_count -= 1

            if "stormy" in prompt:
                raise RuntimeError("simulated repository failure")
            return WAV_HEADER

        monkeypatch.setattr(
            acestep_repository,
            "generate_audio_bytes_for_prompt",
            fake_generate_audio_bytes_for_prompt,
        )

        audio_service.ensure_queue_worker_running()

        _wait_until(
            lambda: _require_snapshot(first.id).status == "generating",
            timeout_seconds=1.5,
        )
        assert _require_snapshot(second.id).status == "queued"
        assert _require_snapshot(third.id).status == "queued"

        first_result = audio_service.wait_for_terminal_status(first.id, timeout_seconds=2.0)
        second_result = audio_service.wait_for_terminal_status(second.id, timeout_seconds=2.0)
        third_result = audio_service.wait_for_terminal_status(third.id, timeout_seconds=2.0)

        assert first_result is not None and first_result.status == "completed"
        assert second_result is not None and second_result.status == "failed"
        assert third_result is not None and third_result.status == "completed"

        assert second_result.error_message == "Audio generation failed"
        assert first_result.wav_bytes == WAV_HEADER
        assert second_result.wav_bytes is None
        assert third_result.wav_bytes == WAV_HEADER

        assert max_active_count == 1
        assert call_order == [
            "warm lofi ambient, 92 BPM:92",
            "stormy lofi electro, 120 BPM:120",
            "calm lofi jazz, 70 BPM:70",
        ]
