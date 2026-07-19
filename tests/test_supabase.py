import unittest

from storm_signal_recon.supabase import SupabaseRest


class SupabaseRestTests(unittest.TestCase):
    def test_modern_secret_key_is_only_sent_as_apikey(self):
        headers = SupabaseRest("https://example.supabase.co", "sb_secret_example").headers()
        self.assertEqual(headers["apikey"], "sb_secret_example")
        self.assertNotIn("Authorization", headers)

    def test_legacy_service_role_is_sent_as_bearer(self):
        headers = SupabaseRest("https://example.supabase.co", "legacy.jwt").headers()
        self.assertEqual(headers["Authorization"], "Bearer legacy.jwt")


if __name__ == "__main__":
    unittest.main()

