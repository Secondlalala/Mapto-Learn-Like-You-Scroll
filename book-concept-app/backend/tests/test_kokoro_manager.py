import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import kokoro_manager


class KokoroManagerTests(unittest.TestCase):
    @patch("services.kokoro_manager.subprocess.Popen")
    @patch("services.kokoro_manager._port_open", return_value=False)
    @patch("services.kokoro_worker_client.health", side_effect=RuntimeError("worker is not running"))
    @patch("services.kokoro_manager.get_tts_config")
    def test_starts_http_service_when_enabled_and_port_is_closed(
        self,
        get_tts_config,
        _worker_health,
        _port_open,
        popen,
    ):
        get_tts_config.return_value = {
            "enabled": True,
            "api_style": "kokoro",
            "api_url": "http://127.0.0.1:9977/tts",
        }

        kokoro_manager.start_kokoro_if_enabled()

        _worker_health.assert_not_called()
        popen.assert_called_once()
        command = popen.call_args.args[0]
        self.assertIn("services.kokoro_service:app", command)
        self.assertEqual(command[-1], "9977")


if __name__ == "__main__":
    unittest.main()
