from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from unittest.mock import Mock, patch


def load_server(monkeypatch):
    monkeypatch.setenv("DINGTALK_CLIENT_ID", "cid")
    monkeypatch.setenv("DINGTALK_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("DINGTALK_CORP_ID", "corp")
    monkeypatch.setenv("APP_SESSION_SECRET", "test-session-secret-123456789012")
    path = Path(__file__).resolve().parents[1] / "src" / "server.py"
    spec = importlib.util.spec_from_file_location("frontend_server_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dingtalk_access_token_uses_oauth2_sdk(monkeypatch) -> None:
    server = load_server(monkeypatch)
    client = Mock()
    client.get_token.return_value = Mock(body={"access_token": "app-token", "expires_in": 7200})

    models = Mock()
    models.GetTokenRequest.side_effect = lambda **kwargs: kwargs

    with patch.object(server, "make_oauth_client", return_value=(client, models)):
        token = server.get_dingtalk_access_token("corp")

    assert token == "app-token"
    models.GetTokenRequest.assert_called_once_with(
        client_id="cid",
        client_secret="csecret",
        grant_type="client_credentials",
    )
    client.get_token.assert_called_once_with(
        "corp",
        {"client_id": "cid", "client_secret": "csecret", "grant_type": "client_credentials"},
    )


def test_dingtalk_topapi_uses_query_access_token(monkeypatch) -> None:
    server = load_server(monkeypatch)

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self) -> bytes:
            return b'{"errcode":0,"errmsg":"ok","result":{"userid":"uid1"}}'

    def fake_urlopen(req, timeout):
        assert timeout == 15
        assert req.full_url == f"{server.DINGTALK_GETUSERINFO_URL}?access_token=app-token"
        assert json.loads(req.data.decode("utf-8")) == {"code": "h5-code"}
        return FakeResponse()

    with patch.object(server.urlrequest, "urlopen", side_effect=fake_urlopen):
        body = server.dingtalk_topapi_post(
            server.DINGTALK_GETUSERINFO_URL,
            "app-token",
            {"code": "h5-code"},
            "通过免登码获取钉钉用户信息",
        )

    assert body["result"]["userid"] == "uid1"


def test_exchange_dingtalk_code_maps_user_detail(monkeypatch) -> None:
    server = load_server(monkeypatch)
    calls = []

    def fake_topapi(url, access_token, payload, operation):
        calls.append((url, access_token, payload, operation))
        if url == server.DINGTALK_GETUSERINFO_URL:
            return {"errcode": 0, "result": {"userid": "uid1", "name": "张三", "unionid": "union-x"}}
        return {
            "errcode": 0,
            "result": {
                "userid": "uid1",
                "name": "张三",
                "mobile": "13800000000",
                "dept_id_list": "[2,3,4]",
                "unionid": "union-x",
            },
        }

    with patch.object(server, "get_dingtalk_access_token", return_value="app-token"), patch.object(
        server,
        "dingtalk_topapi_post",
        side_effect=fake_topapi,
    ):
        user = server.exchange_dingtalk_code("h5-code", "corp")

    assert calls[0] == (
        server.DINGTALK_GETUSERINFO_URL,
        "app-token",
        {"code": "h5-code"},
        "通过免登码获取钉钉用户信息",
    )
    assert calls[1][0] == server.DINGTALK_USER_GET_URL
    assert calls[1][2] == {"userid": "uid1", "language": "zh_CN"}
    assert user["userid"] == "uid1"
    assert user["mobile"] == "13800000000"
    assert user["dept_ids"] == [2, 3, 4]
    assert user["unionid"] == "union-x"
