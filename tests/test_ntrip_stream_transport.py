import unittest
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch

from zgiis.live.ntrip_stream import StationStream, _FairConnectionSlots


class StreamTransportTests(unittest.TestCase):
    def test_waiting_stations_acquire_in_order(self):
        slots = _FairConnectionSlots(1)
        stop = threading.Event()
        self.assertTrue(slots.acquire(stop))
        order = []
        threads = []
        def station(code):
            if slots.acquire(stop):
                order.append(code)
                slots.release()
        try:
            for code in range(4):
                thread = threading.Thread(target=station, args=(code,), daemon=True)
                threads.append(thread)
                thread.start()
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    with slots._condition:
                        if len(slots._waiting) == code + 1:
                            break
                    time.sleep(0.005)
                else:
                    self.fail("station did not join queue")
            slots.release()
            for thread in threads:
                thread.join(2)
            self.assertEqual(order, [0, 1, 2, 3])
            self.assertEqual(slots._available, 1)
        finally:
            stop.set()

    def test_cancelled_waiter_does_not_consume_a_slot(self):
        slots = _FairConnectionSlots(1)
        stop = threading.Event()
        stop.set()
        self.assertFalse(slots.acquire(stop))
        self.assertEqual(slots._available, 1)
        self.assertEqual(len(slots._waiting), 0)

    def stream(self):
        return StationStream("test", "TEST", "caster", 2101, "user", "pass", Mock())

    def test_header_does_not_consume_first_rtcm_frame(self):
        pending = bytearray(b"HTTP/1.1 200 OK\r\nContent-Type: gnss/data\r\n\r\n\xd3\x00\x10")
        sock = Mock()
        def recv(size):
            result = bytes(pending[:size])
            del pending[:size]
            return result
        sock.recv.side_effect = recv
        with patch("zgiis.live.ntrip_stream.socket.create_connection", return_value=sock):
            self.stream()._connect()
        self.assertEqual(pending, b"\xd3\x00\x10")

    def test_rtcm_account_refusal_is_not_a_live_heartbeat(self):
        text = "Too many connections"
        msg = SimpleNamespace(identity="1029", DF139=len(text), DF140=text)
        stream = self.stream()
        sock = Mock()
        with patch("zgiis.live.ntrip_stream.RTCMReader", return_value=iter([(b"", msg)])):
            with self.assertRaisesRegex(ConnectionError, "Caster rejected"):
                stream._stream(sock)
        self.assertIsNone(stream.last_seen)
        self.assertIsNone(stream._last_connected_at)
        sock.close.assert_called_once()
