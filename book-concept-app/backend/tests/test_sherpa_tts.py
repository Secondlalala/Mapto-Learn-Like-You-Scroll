import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.sherpa_tts import split_language_segments


class SherpaTtsTests(unittest.TestCase):
    def test_splits_mixed_chinese_and_english(self):
        segments = split_language_segments("量子场论叫做 quantum field theory。它很重要。")

        self.assertEqual([language for language, _ in segments], ["zh", "en", "zh"])
        self.assertIn("量子场论", segments[0][1])
        self.assertIn("quantum field theory", segments[1][1])

    def test_keeps_punctuation_with_spoken_segments(self):
        segments = split_language_segments("Hello，世界。")

        self.assertEqual(segments, [("en", "Hello，"), ("zh", "世界。")])

    def test_defaults_numbers_only_text_to_chinese(self):
        self.assertEqual(split_language_segments("2026。"), [("zh", "2026。")])


if __name__ == "__main__":
    unittest.main()
