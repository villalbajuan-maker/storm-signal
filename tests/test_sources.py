import json
import unittest
from datetime import date

from storm_signal_recon.sources import SPC_URL, Snapshot, default_historical_year, discover_ncei_details_file, field_inventory, parse_records
from storm_signal_recon.normalize import ncei_time, normalize_snapshot, spc_cycle_date, spc_report_time


class SourceTests(unittest.TestCase):
    def test_spc_uses_links_exposed_by_daily_report_pages(self):
        self.assertEqual(SPC_URL.format(day="today"), "https://www.spc.noaa.gov/climo/reports/today_hail.csv")

    def test_discovers_latest_revision_for_year(self):
        html = "StormEvents_details-ftp_v1.0_d2025_c20260101.csv.gz x StormEvents_details-ftp_v1.0_d2025_c20260202.csv.gz"
        self.assertEqual(discover_ncei_details_file(html, 2025), "StormEvents_details-ftp_v1.0_d2025_c20260202.csv.gz")

    def test_parses_nws_properties_and_inventories_nulls(self):
        body = json.dumps({"features": [{"properties": {"event": "Tornado Warning", "severity": None}}]}).encode()
        records = parse_records(Snapshot("nws_alerts", "x", "now", "application/geo+json", body))
        fields = field_inventory(records)
        self.assertEqual(fields["properties.event"]["examples"], ["Tornado Warning"])
        self.assertEqual(fields["properties.severity"]["null"], 1)

    def test_parses_csv_without_external_dependencies(self):
        snap = Snapshot("spc_hail_today", "x", "now", "text/csv", b"Time,Size,Lat,Lon\n1200,100,32.1,-97.1\n")
        self.assertEqual(parse_records(snap)[0]["Size"], "100")

    def test_historical_default_is_previous_year(self):
        self.assertEqual(default_historical_year(date(2026, 7, 19)), 2025)

    def test_spc_convective_day_crosses_midnight(self):
        cycle = spc_cycle_date("today", "2026-07-19T07:00:00+00:00")
        self.assertEqual(cycle, date(2026, 7, 18))
        self.assertEqual(spc_report_time(cycle, "0010").isoformat(), "2026-07-19T00:10:00+00:00")

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


if __name__ == "__main__":
    unittest.main()
