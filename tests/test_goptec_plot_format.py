import ast
from pathlib import Path
import unittest

import numpy as np
import pandas as pd
import plotly.graph_objects as go

from zgiis.processing.plot_gaps import gap_break_indices


def _load_plot_builder():
    source = Path("pages/2_Processing.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    node = next(
        item
        for item in tree.body
        if isinstance(item, ast.FunctionDef)
        and item.name == "_make_goptec_plot_xy"
    )
    module = ast.Module(body=[node], type_ignores=[])
    ast.fix_missing_locations(module)
    namespace = {
        "np": np,
        "pd": pd,
        "go": go,
        "gap_break_indices": gap_break_indices,
    }
    exec(compile(module, "pages/2_Processing.py", "exec"), namespace)
    return namespace["_make_goptec_plot_xy"]


class GopTecPlotFormatTests(unittest.TestCase):
    def test_axes_title_and_legends_match_reference_format(self):
        build = _load_plot_builder()
        frame = pd.DataFrame(
            {
                "prn": ["G01"] * 12,
                "_x": np.linspace(0, 2.75, 12),
                "vtec": np.linspace(5, 25, 12),
            }
        )

        fig = build(
            frame,
            "vtec",
            "Calculated TEC - Elevation Mask 25.5°",
            [0, 24],
            list(range(0, 25, 2)),
            "UT (hrs)",
        )

        names = {
            trace.name
            for trace in fig.data
            if trace.showlegend is not False
        }
        self.assertEqual(
            names,
            {"Satellite PRN arcs", "Mean TEC", "Zero TEC reference"},
        )
        self.assertEqual(
            fig.layout.title.text,
            "Calculated TEC - Elevation Mask 25.5°",
        )
        self.assertEqual(fig.layout.xaxis.title.text, "UT (hrs)")
        self.assertEqual(fig.layout.yaxis.title.text, "TEC (TECU)")
        self.assertEqual(fig.layout.xaxis.tickfont.color, "#ff0000")
        self.assertEqual(fig.layout.yaxis.tickfont.color, "#ff0000")
        self.assertTrue(fig.layout.showlegend)
        fig.to_json(validate=True)


if __name__ == "__main__":
    unittest.main()
