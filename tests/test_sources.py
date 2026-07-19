import json
import unittest
from datetime import date

from storm_signal_recon.sources import SPC_URL, Snapshot, default_historical_year, discover_ncei_details_file, discover_spc_cycle_date, field_inventory, parse_records
from storm_signal_recon.normalize import ncei_time, normalize_snapshot, spc_cycle_date, spc_report_time


class SourceTests(unittest.TestCase):
    def test_spc_uses_links_exposed_by_daily_report_pages(self):
        self.assertEqual(SPC_URL.format(day="today", kind="hail"), "https://www.spc.noaa.gov/climo/reports/today_hail.csv")

    def test_discovers_latest_revision_for_year(self):
        html = "StormEvents_details-ftp_v1.0_d2025_c20260101.csv.gz x StormEvents_details-ftp_v1.0_d2025_c20260202.csv.gz"
        self.assertEqual(discover_ncei_details_file(html, 2025), "StormEvents_details-ftp_v1.0_d2025_c20260202.csv.gz")

    def test_parses_nws_properties_and_inventories_nulls(self):
        body = json.dumps({"features": [{"properties": {"event": "Tornado Warning", "severity": None}}]}).encode()
        records = parse_records(Snapshot("nws_alerts", "x", "now", "application/geo+json", body))
        fields = field_inventory(records)
        self.assertEqual(fields["properties.event"]["examples"], ["Tornado Warning"])
        self.assertEqual(fields["properties.severity"]["null"], 1)

    def test_nws_same_code_uses_state_fips_not_partition_prefix(self):
        snap = Snapshot(
            "nws_alerts", "https://api.weather.gov/alerts/active", "2026-07-19T21:00:00+00:00",
            "application/geo+json", json.dumps({"features": [{
                "id": "urn:test:tx-warning",
                "geometry": {"type": "Polygon", "coordinates": []},
                "properties": {
                    "id": "urn:test:tx-warning", "event": "Tornado Warning", "status": "Actual",
                    "sent": "2026-07-19T20:00:00Z", "geocode": {"SAME": ["048453"]},
                },
            }]}).encode(),
        )
        _, event = normalize_snapshot(snap)[0]
        self.assertEqual(event["state"], "TX")

    def test_nws_same_code_supports_five_state_demo(self):
        expected = {"012001": "FL", "013001": "GA", "022001": "LA", "037001": "NC", "048001": "TX"}
        for same, state in expected.items():
            snap = Snapshot(
                "nws_alerts", "x", "2026-07-19T21:00:00+00:00", "application/geo+json",
                json.dumps({"features": [{"id": same, "geometry": None, "properties": {
                    "id": same, "event": "Severe Thunderstorm Warning", "sent": "2026-07-19T20:00:00Z",
                    "geocode": {"SAME": [same]},
                }}]}).encode(),
            )
            self.assertEqual(normalize_snapshot(snap)[0][1]["state"], state)

    def test_parses_csv_without_external_dependencies(self):
        snap = Snapshot("spc_hail_today", "x", "now", "text/csv", b"Time,Size,Lat,Lon\n1200,100,32.1,-97.1\n")
        self.assertEqual(parse_records(snap)[0]["Size"], "100")

    def test_historical_default_is_previous_year(self):
        self.assertEqual(default_historical_year(date(2026, 7, 19)), 2025)

    def test_spc_convective_day_crosses_midnight(self):
        cycle = spc_cycle_date("today", "2026-07-19T07:00:00+00:00")
        self.assertEqual(cycle, date(2026, 7, 18))
        self.assertEqual(spc_report_time(cycle, "0010").isoformat(), "2026-07-19T00:10:00+00:00")

    def test_spc_cycle_comes_from_published_page_not_retrieval_clock(self):
        html = "Today's Storm Reports (20260719 1200 UTC - 20260720 1159 UTC)"
        self.assertEqual(discover_spc_cycle_date(html), date(2026, 7, 19))
        snap = Snapshot(
            "spc_hail_2026-07-18", "https://example.test", "2026-07-19T14:00:00+00:00", "text/csv",
            b"Time,Size,Location,County,State,Lat,Lon,Comments\n0010,100,Here,Pondera,MT,48.3,-111.95,Observed\n",
        )
        _, event = normalize_snapshot(snap)[0]
        self.assertEqual(event["started_at"], "2026-07-19T00:10:00+00:00")

    def test_ncei_fixed_offset_is_preserved(self):
        self.assertEqual(ncei_time("02-MAR-25 14:15:00", "CST-6").isoformat(), "2025-03-02T14:15:00-06:00")

    def test_normalizes_spc_size_and_point(self):
        snap = Snapshot(
            "spc_hail_today", "https://example.test", "2026-07-19T07:00:00+00:00", "text/csv",
            b"Time,Size,Location,County,State,Lat,Lon,Comments\n0010,150,Here,County,TX,32.1,-97.1,Observed\n",
        )
        raw, event = normalize_snapshot(snap)[0]
        self.assertEqual(raw["source"], "spc_reports")
        self.assertEqual(event["magnitude"], 1.5)
        self.assertEqual(event["geometry"]["coordinates"], [-97.1, 32.1])

    def test_normalizes_spc_wind_and_unknown_speed(self):
        measured = Snapshot(
            "spc_wind_2026-07-18", "https://example.test", "2026-07-19T14:00:00+00:00", "text/csv",
            b"Time,Speed,Location,County,State,Lat,Lon,Comments\n2002,61,Airport,County,MD,39.17,-76.68,Measured\n",
        )
        _, event = normalize_snapshot(measured)[0]
        self.assertEqual((event["event_type"], event["magnitude"], event["magnitude_unit"]), ("wind_report", 61.0, "mph"))
        unknown = Snapshot(
            "spc_wind_2026-07-18", "https://example.test", "2026-07-19T14:00:00+00:00", "text/csv",
            b"Time,Speed,Location,County,State,Lat,Lon,Comments\n2003,UNK,Here,County,PA,40.1,-77.1,Trees down\n",
        )
        _, unknown_event = normalize_snapshot(unknown)[0]
        self.assertIsNone(unknown_event["magnitude"])
        self.assertIsNone(unknown_event["magnitude_unit"])

    def test_normalizes_preliminary_tornado_without_inventing_scale(self):
        snap = Snapshot(
            "spc_torn_2026-07-18", "https://example.test", "2026-07-19T14:00:00+00:00", "text/csv",
            b"Time,F_Scale,Location,County,State,Lat,Lon,Comments\n2016,UNK,Here,Jefferson,PA,41.08,-79.2,Video\n",
        )
        _, event = normalize_snapshot(snap)[0]
        self.assertEqual(event["event_type"], "tornado_report")
        self.assertIsNone(event["magnitude"])
        self.assertIsNone(event["severity"])


if __name__ == "__main__":
    unittest.main()
