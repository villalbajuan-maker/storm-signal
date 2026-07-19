import unittest

from scripts.import_census_geographies import geometry_bbox, normalized_properties


class GeographicImportTests(unittest.TestCase):
    def test_derives_state_bbox_with_padding(self):
        collection = {"features": [{"geometry": {"coordinates": [[[-106.0, 25.8], [-93.5, 36.5]]]}}]}
        self.assertEqual(geometry_bbox(collection), (-106.1, 25.7, -93.4, 36.6))

    def test_preserves_leading_zero_zcta(self):
        fields = normalized_properties("zcta", {"GEOID": "00501", "ZCTA5": "00501", "NAME": "00501"})
        self.assertEqual(fields["geoid"], "00501")
        self.assertEqual(fields["zcta5"], "00501")

    def test_maps_county_lineage(self):
        fields = normalized_properties("county", {
            "GEOID": "30073", "STATEFP": "30", "COUNTYFP": "073", "NAMELSAD": "Pondera County"
        })
        self.assertEqual(fields["state_fips"], "30")
        self.assertEqual(fields["county_fips"], "073")
        self.assertEqual(fields["name"], "Pondera County")


if __name__ == "__main__":
    unittest.main()
