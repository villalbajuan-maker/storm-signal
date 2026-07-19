import unittest
from datetime import datetime, timezone

from scripts.import_nhc_archived_advisory import (
    clean_number,
    deduplicate_features,
    normalize_warning_type,
    parse_advisory_time,
    parse_compact_utc,
    parse_forecast_valid_time,
)


class NHCArchivedImportTests(unittest.TestCase):
    def test_parses_advisory_issue_time_as_utc(self):
        self.assertEqual(
            parse_advisory_time("500 AM AST Mon Sep 04 2017").isoformat(),
            "2017-09-04T09:00:00+00:00",
        )

    def test_preserves_synoptic_forecast_valid_time(self):
        issued = datetime(2017, 9, 4, 9, tzinfo=timezone.utc)
        self.assertEqual(parse_forecast_valid_time("04/0600", issued).isoformat(), "2017-09-04T06:00:00+00:00")
        self.assertEqual(parse_compact_utc("2017090418").isoformat(), "2017-09-04T18:00:00+00:00")

    def test_rolls_valid_time_across_year_boundary(self):
        issued = datetime(2025, 12, 31, 21, tzinfo=timezone.utc)
        self.assertEqual(parse_forecast_valid_time("01/0600", issued).isoformat(), "2026-01-01T06:00:00+00:00")

    def test_source_sentinels_are_not_invented_values(self):
        self.assertIsNone(clean_number(9999, integer=True))
        self.assertEqual(clean_number("64", integer=True), 64)

    def test_normalizes_watch_warning_label(self):
        self.assertEqual(normalize_warning_type("Hurricane Watch"), "hurricane_watch")

    def test_deduplicates_repeated_initial_wind_radius(self):
        features = [{"id": "same", "layer": "initial"}, {"id": "same", "layer": "forecast"}, {"id": "other"}]
        self.assertEqual(deduplicate_features(features), [features[0], features[2]])


if __name__ == "__main__":
    unittest.main()
