import unittest

import pandas as pd

from zgiis.processing.daily_summary_charts import build_daily_vtec_chart


class DailySummaryChartTests(unittest.TestCase):
    def test_chart_has_visible_axes_title_and_legend(self):
        data = pd.DataFrame(
            {
                "date": ["2024-04-30", "2024-05-01"],
                "mean_vtec": [18.2, 20.4],
            }
        )

        fig = build_daily_vtec_chart(
            data,
            "mean_vtec",
            "Mean VTEC",
            "#00d4ff",
        )

        self.assertEqual(fig.layout.title.text, "Mean VTEC")
        self.assertEqual(fig.layout.xaxis.title.text, "Date")
        self.assertEqual(fig.layout.yaxis.title.text, "VTEC (TECU)")
        self.assertTrue(fig.layout.showlegend)
        self.assertEqual(fig.data[0].name, "Mean VTEC")
        self.assertEqual(fig.layout.plot_bgcolor, "#0d1b2a")
        self.assertEqual(fig.layout.xaxis.tickfont.color, "#ffffff")
        self.assertEqual(fig.layout.yaxis.tickfont.color, "#ffffff")

    def test_chart_marks_only_official_kp_storm_days(self):
        data = pd.DataFrame(
            {
                "date": ["2024-04-30", "2024-05-01"],
                "mean_vtec": [18.2, 20.4],
                "kp_index": [4.9, 5.0],
                "kp_condition": ["Active", "Minor Storm G1"],
                "kp_storm_flag": [False, True],
            }
        )

        fig = build_daily_vtec_chart(
            data,
            "mean_vtec",
            "Mean VTEC",
            "#00d4ff",
        )

        self.assertEqual(len(fig.data), 2)
        self.assertEqual(fig.data[1].name, "NOAA Kp storm (Kp >= 5)")
        self.assertEqual(len(fig.data[1].x), 1)
        self.assertEqual(pd.Timestamp(fig.data[1].x[0]), pd.Timestamp("2024-05-01"))
        self.assertIn("Minor Storm G1", fig.data[1].customdata[0])


if __name__ == "__main__":
    unittest.main()
