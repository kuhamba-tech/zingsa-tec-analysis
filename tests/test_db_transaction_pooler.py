"""Transaction helper when the pooler rejects set_session."""
from zgiis.db.config import transaction


class _Cursor:
    def __init__(self, log: list[str]):
        self.log = log

    def execute(self, sql: str, *_args):
        self.log.append(sql)

    def close(self):
        self.log.append("close")


class _PoolerConn:
    closed = 0

    def __init__(self):
        self.log: list[str] = []
        self._autocommit = True

    @property
    def autocommit(self):
        return self._autocommit

    @autocommit.setter
    def autocommit(self, value):
        if value is False:
            raise RuntimeError("set_session cannot be used inside a transaction")
        self._autocommit = value

    def cursor(self):
        return _Cursor(self.log)

    def commit(self):
        self.log.append("commit")

    def rollback(self):
        self.log.append("rollback")


def test_transaction_uses_begin_commit_when_autocommit_cannot_change():
    conn = _PoolerConn()
    with transaction(conn):
        pass
    assert conn.log[:2] == ["BEGIN", "COMMIT"]
    assert conn.autocommit is True
