import unittest

from scripts.import_census_geographies import normalized_properties


class GeographicImportTests(unittest.TestCase):
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
