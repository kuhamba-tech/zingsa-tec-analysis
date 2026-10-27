"""Recent UTC hours survive the timeline point cap."""

import datetime as dt
import unittest

from backend.schemas import TimelinePoint
from backend.timeline_builder import limit_timeline_points


class TimelineHourlyCapTest(unittest.TestCase):
    def test_each_recent_hour_is_kept(self):
        now = dt.datetime.now(dt.timezone.utc).replace(minute=10, second=0, microsecond=0)
        points = []
        for hours_ago in range(80, -1, -1):
            when = now - dt.timedelta(hours=hours_ago)
            points.append(TimelinePoint(t=when.strftime("%Y-%m-%dT%H:%M:%S"), v=float(hours_ago)))
        kept = limit_timeline_points(points, max_points=12)
        recent = {
            (now - dt.timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H")
            for hours_ago in range(0, 6)
        }
        kept_hours = {point.t[:13] for point in kept}
        self.assertTrue(recent <= kept_hours)


if __name__ == "__main__":
    unittest.main()
