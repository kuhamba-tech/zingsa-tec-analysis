import subprocess
import sys
import unittest

from zgiis.live.process_health import pid_alive


class ProcessHealthTests(unittest.TestCase):
    def test_checks_do_not_terminate_running_process(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        try:
            for _ in range(10):
                self.assertTrue(pid_alive(child.pid))
            self.assertIsNone(child.poll())
        finally:
            child.terminate()
            child.wait()
        self.assertFalse(pid_alive(child.pid))

    def test_invalid_pid(self):
        self.assertFalse(pid_alive(0))
        self.assertFalse(pid_alive(-1))
