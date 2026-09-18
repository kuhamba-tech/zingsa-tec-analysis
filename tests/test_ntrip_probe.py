import unittest

from unittest.mock import MagicMock, patch



from zgiis.live.ntrip_probe import parse_mountpoints_from_env, probe_mountpoint





class _FakeMsg:

    def __init__(self, identity: int):

        self.identity = identity





class _FakeRTCMReader:

    def __init__(self, _sock):

        self._msgs = [_FakeMsg(1029), _FakeMsg(4092)]



    def __iter__(self):

        yield from ((None, m) for m in self._msgs)





class NtripProbeTests(unittest.TestCase):

    def test_parse_mountpoints_from_env(self):

        with patch.dict(

            "os.environ",

            {"NTRIP_MOUNTPOINTS": "karo:KARO,zinh:ZINH", "NTRIP_MOUNTPOINT": "", "NTRIP_STATION_CODE": "zinh"},

            clear=False,

        ):

            self.assertEqual(parse_mountpoints_from_env(), {"karo": "KARO", "zinh": "ZINH"})



    def test_probe_rejected_mountpoint(self):

        class FakeSock:

            def sendall(self, _):

                pass



            def recv(self, n):

                return b"HTTP/1.1 404 Not Found\r\n\r\n"



            def settimeout(self, _):

                pass



            def close(self):

                pass



        with patch("zgiis.live.ntrip_probe.socket.create_connection", return_value=FakeSock()):

            result = probe_mountpoint(

                host="example.com",

                port=2101,

                username="u",

                password="p",

                mountpoint="BAD",

                listen_sec=0.1,

            )

        self.assertTrue(result["tcp_ok"])

        self.assertFalse(result["caster_ok"])

        self.assertEqual(result["verdict"], "offline")



    def test_probe_rtcm_no_msm(self):

        class FakeSock:

            def sendall(self, _):

                pass



            def recv(self, n):

                return b"HTTP/1.1 200 OK\r\n\r\n"



            def settimeout(self, _):

                pass



            def close(self):

                pass



        with patch("zgiis.live.ntrip_probe.socket.create_connection", return_value=FakeSock()), patch(

            "zgiis.live.ntrip_probe._PYRTCM_OK", True

        ), patch("zgiis.live.ntrip_probe.RTCMReader", _FakeRTCMReader):

            result = probe_mountpoint(

                host="example.com",

                port=2101,

                username="u",

                password="p",

                mountpoint="BEIT",

                listen_sec=1.0,

            )

        self.assertTrue(result["caster_ok"])

        self.assertEqual(result["verdict"], "rtcm_no_msm")

        self.assertEqual(result["rtcm_total"], 2)

        self.assertEqual(result["msm_count"], 0)

        self.assertEqual(result["msg_types"], {"1029": 1, "4092": 1})

        self.assertEqual(result["msm_types"], {})



    def test_probe_msm_streaming(self):

        class MsmReader:

            def __init__(self, _sock):

                self._msgs = [_FakeMsg(1077), _FakeMsg(1006)]



            def __iter__(self):

                yield from ((None, m) for m in self._msgs)



        class FakeSock:

            def sendall(self, _):

                pass



            def recv(self, n):

                return b"HTTP/1.1 200 OK\r\n\r\n"



            def settimeout(self, _):

                pass



            def close(self):

                pass



        with patch("zgiis.live.ntrip_probe.socket.create_connection", return_value=FakeSock()), patch(

            "zgiis.live.ntrip_probe._PYRTCM_OK", True

        ), patch("zgiis.live.ntrip_probe.RTCMReader", MsmReader):

            result = probe_mountpoint(

                host="example.com",

                port=2101,

                username="u",

                password="p",

                mountpoint="LUPA",

                listen_sec=1.0,

            )

        self.assertEqual(result["verdict"], "msm_streaming")

        self.assertEqual(result["msm_count"], 1)

        self.assertEqual(result["msm_types"], {"1077": 1})





if __name__ == "__main__":

    unittest.main()


