import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.tts_client import _build_payload


class TTSClientTests(unittest.TestCase):
    def test_build_payload_uses_per_request_speed(self):
        payload = _build_payload("一句话。", _config(speed=1.2), speed=0.65)

        self.assertEqual(payload["speed"], 0.65)

    def test_build_payload_clamps_speed_to_reader_range(self):
        too_fast = _build_payload("一句话。", _config(speed=1.0), speed=2.5)
        too_slow = _build_payload("一句话。", _config(speed=1.0), speed=0.1)

        self.assertEqual(too_fast["speed"], 2.0)
        self.assertEqual(too_slow["speed"], 0.2)


def _config(speed=0.8):
    return {
        "api_style": "kokoro",
        "model": "kokoro-82m",
        "voice": "zf_xiaoxiao",
        "english_voice": "af_heart",
        "lang_code": "auto",
        "device": "auto",
        "speed": speed,
    }


if __name__ == "__main__":
    unittest.main()
