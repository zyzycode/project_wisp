"""Missing image dependencies select the environment owned by the pipeline."""

import builtins
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class InterpreterSelected(Exception):
    pass


class EnvironmentBootstrapTests(unittest.TestCase):
    def test_missing_dependencies_restart_in_pipeline_environment(self):
        original_import = builtins.__import__

        def missing_scipy(name, *args, **kwargs):
            if name == "scipy.ndimage":
                raise ImportError("Synthetic missing image dependency")
            return original_import(name, *args, **kwargs)

        for script in ("process_sprites.py", "preview_sprites.py"):
            for platform, executable in (("posix", ("bin", "python")), ("nt", ("Scripts", "python.exe"))):
                with self.subTest(script=script, platform=platform):
                    expected = str(SCRIPTS.parent / ".venv" / executable[0] / executable[1])
                    with (
                        patch.object(sys, "path", sys.path.copy()),
                        patch.object(sys, "executable", "/unrelated/python"),
                        patch("builtins.__import__", side_effect=missing_scipy),
                        patch("os.name", platform),
                        patch("os.path.exists", return_value=True),
                        patch("os.execv", side_effect=InterpreterSelected) as restart,
                    ):
                        with self.assertRaises(InterpreterSelected):
                            runpy.run_path(str(SCRIPTS / script), run_name="bootstrap_test")
                    self.assertEqual(restart.call_args.args[0], expected)
                    self.assertEqual(restart.call_args.args[1][0], expected)


if __name__ == "__main__":
    unittest.main()
