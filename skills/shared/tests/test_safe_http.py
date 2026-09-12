#!/usr/bin/env python3
from __future__ import annotations

import io
import os
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from safe_http import (  # noqa: E402
    ALLOW_PRIVATE_ENV,
    MANAGED_CONFIG_ENV,
    OUTPUTS_DEV_ENV,
    OUTPUTS_INO_ENV,
    RUN_ID_ENV,
    WORKSPACE_DEV_ENV,
    WORKSPACE_ENV,
    WORKSPACE_INO_ENV,
    ResponseTooLarge,
    SafeHttpError,
    SafeRedirectHandler,
    SecureOutputError,
    activate_secure_output,
    close_secure_output,
    download_atomic,
    open_atomic_output,
    read_limited,
    safe_urlopen,
    sanitize_log_text,
    save_bytes_atomic,
    save_response_atomic,
    validate_url,
)


@contextmanager
def _private(value: bool):
    previous = os.environ.get(ALLOW_PRIVATE_ENV)
    if value:
        os.environ[ALLOW_PRIVATE_ENV] = "1"
    else:
        os.environ.pop(ALLOW_PRIVATE_ENV, None)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(ALLOW_PRIVATE_ENV, None)
        else:
            os.environ[ALLOW_PRIVATE_ENV] = previous


class _MemoryResponse(io.BytesIO):
    def __init__(self, body: bytes, declared: int | None = None):
        super().__init__(body)
        self.headers = {} if declared is None else {"Content-Length": str(declared)}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class _FakeSocket:
    def __init__(self, response: bytes):
        self.response = response
        self.connected_to = None
        self.sent = bytearray()
        self.timeout = None

    def settimeout(self, timeout):
        self.timeout = timeout

    def bind(self, _source):
        return None

    def connect(self, target):
        self.connected_to = target

    def sendall(self, data):
        self.sent.extend(data)

    def makefile(self, _mode, _buffering=None):
        return io.BytesIO(self.response)

    def close(self):
        return None


class _FakeTlsContext:
    post_handshake_auth = None
    verify_mode = ssl.CERT_REQUIRED
    check_hostname = True

    def __init__(self):
        self.server_hostname = None

    def wrap_socket(self, sock, *, server_hostname):
        self.server_hostname = server_hostname
        return sock


class SafeHttpTests(unittest.TestCase):
    def tearDown(self):
        close_secure_output()

    @staticmethod
    def _managed_output_env(workspace: Path, outputs: Path) -> dict[str, str]:
        workspace_info = workspace.stat()
        outputs_info = outputs.stat()
        return {
            MANAGED_CONFIG_ENV: "1",
            WORKSPACE_ENV: str(workspace),
            RUN_ID_ENV: "4f2bc1ce-602a-42c6-b7b8-16e4429451f3",
            WORKSPACE_DEV_ENV: str(workspace_info.st_dev),
            WORKSPACE_INO_ENV: str(workspace_info.st_ino),
            OUTPUTS_DEV_ENV: str(outputs_info.st_dev),
            OUTPUTS_INO_ENV: str(outputs_info.st_ino),
        }

    def test_secure_output_pins_parent_fd_across_rename_and_symlink_swap(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "workspace"
            outputs = workspace / "outputs"
            approved_parent = outputs / "topic"
            outside = Path(directory) / "outside"
            approved_parent.mkdir(parents=True)
            outside.mkdir()
            requested = approved_parent / "result.bin"
            outside_target = outside / requested.name
            outside_target.write_bytes(b"outside-old")
            env = self._managed_output_env(workspace, outputs)

            with mock.patch.dict(os.environ, env, clear=False):
                normalized = activate_secure_output(requested)
                atomic = open_atomic_output(normalized)
                self.assertRegex(
                    atomic.temporary_name,
                    r"^\.dsh-mediaops-4f2bc1ce-602a-42c6-b7b8-16e4429451f3-[0-9a-f]{24}\.part$",
                )
                atomic.abort()

                pinned_parent = outputs / "topic-pinned"
                approved_parent.rename(pinned_parent)
                approved_parent.symlink_to(outside, target_is_directory=True)
                save_bytes_atomic(b"approved", normalized, max_bytes=32, label="test")

            self.assertEqual((pinned_parent / requested.name).read_bytes(), b"approved")
            self.assertEqual(outside_target.read_bytes(), b"outside-old")
            self.assertEqual(list(pinned_parent.glob(".dsh-mediaops-*.part*")), [])

    def test_managed_cli_rejects_swapped_outputs_inode_before_provider_call(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "workspace"
            outputs = workspace / "outputs"
            target_parent = outputs / "music"
            target_parent.mkdir(parents=True)
            env = self._managed_output_env(workspace, outputs)
            approved_outputs = workspace / "outputs-approved"
            outputs.rename(approved_outputs)
            outputs.mkdir()

            child_env = os.environ.copy()
            child_env.update(env)
            child_env.update({
                "MUSIC_PROVIDER": "suno-compatible",
                "MUSIC_API_KEY": "not-used",
                "MUSIC_BASE_URL": "https://127.0.0.1.invalid/v1",
            })
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "ai_music.py"),
                    "generate",
                    "--provider", "suno-compatible",
                    "--prompt", "test",
                    "--output", str(outputs / "music" / "track.mp3"),
                ],
                cwd=workspace,
                env=child_env,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("inode", result.stderr)
            self.assertNotIn("提交任务", result.stderr)
            self.assertFalse((outputs / "music" / "track.mp3").exists())

    def test_voice_ffmpeg_uses_seekable_fixed_fd_after_parent_swap(self):
        previous_sigterm = signal.getsignal(signal.SIGTERM)
        import voice_clone

        class Result:
            returncode = 0

        try:
            with tempfile.TemporaryDirectory() as directory:
                workspace = Path(directory) / "workspace"
                outputs = workspace / "outputs"
                approved_parent = outputs / "voice"
                outside = Path(directory) / "outside"
                approved_parent.mkdir(parents=True)
                outside.mkdir()
                requested = approved_parent / "speech.mp3"
                outside_target = outside / requested.name
                outside_target.write_bytes(b"outside-old")
                env = self._managed_output_env(workspace, outputs)

                with mock.patch.dict(os.environ, env, clear=False):
                    normalized = activate_secure_output(requested)
                    pinned_parent = outputs / "voice-pinned"
                    approved_parent.rename(pinned_parent)
                    approved_parent.symlink_to(outside, target_is_directory=True)

                    def write_seekable_fd(argv, **kwargs):
                        self.assertEqual(argv[-5:], ["-f", "mp3", "-fd", argv[-2], "fd:"])
                        fd = int(argv[-2])
                        self.assertIn(fd, kwargs["pass_fds"])
                        self.assertTrue(os.lseek(fd, 0, os.SEEK_CUR) >= 0)
                        os.write(fd, b"encoded-audio")
                        return Result()

                    with mock.patch("subprocess.run", side_effect=write_seekable_fd):
                        self.assertTrue(voice_clone._ffmpeg_convert_atomic(b"wav", normalized))

                self.assertEqual((pinned_parent / requested.name).read_bytes(), b"encoded-audio")
                self.assertEqual(outside_target.read_bytes(), b"outside-old")
        finally:
            signal.signal(signal.SIGTERM, previous_sigterm)

    def test_managed_output_requires_complete_host_inode_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / "workspace"
            outputs = workspace / "outputs"
            outputs.mkdir(parents=True)
            with mock.patch.dict(
                os.environ,
                {
                    MANAGED_CONFIG_ENV: "1",
                    WORKSPACE_ENV: str(workspace),
                    RUN_ID_ENV: "4f2bc1ce-602a-42c6-b7b8-16e4429451f3",
                },
                clear=True,
            ), self.assertRaises(SecureOutputError):
                activate_secure_output(outputs / "topic" / "result.bin")

    def test_http_connects_to_the_single_validated_dns_snapshot_and_keeps_host(self):
        port = 8443
        calls = 0
        fake_socket = _FakeSocket(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
        )

        def resolve_once(host, requested_port, **_kwargs):
            nonlocal calls
            self.assertEqual(host, "rebind.test")
            self.assertEqual(requested_port, port)
            calls += 1
            if calls > 1:
                raise AssertionError("the hostname was resolved again after validation")
            return [
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("127.0.0.1", port),
                )
            ]

        with mock.patch("safe_http.socket.getaddrinfo", side_effect=resolve_once), mock.patch(
            "safe_http.socket.socket", return_value=fake_socket,
        ):
            with safe_urlopen(
                f"http://rebind.test:{port}/host",
                timeout=3,
                allow_private=True,
            ) as response:
                self.assertEqual(response.read(), b"ok")
        self.assertEqual(calls, 1)
        self.assertEqual(fake_socket.connected_to, ("127.0.0.1", port))
        self.assertIn(f"Host: rebind.test:{port}\r\n".encode(), fake_socket.sent)

    def test_https_uses_original_hostname_for_sni_certificate_and_host(self):
        port = 9443
        fake_socket = _FakeSocket(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
        )
        tls_context = _FakeTlsContext()
        resolution = [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                ("127.0.0.1", port),
            )
        ]
        with mock.patch("safe_http.socket.getaddrinfo", return_value=resolution) as resolver, mock.patch(
            "safe_http.socket.socket", return_value=fake_socket,
        ), mock.patch(
            "ssl._create_default_https_context", return_value=tls_context,
        ):
            request = urllib.request.Request(
                f"https://origin.example:{port}/asset",
                headers={"Host": "attacker.invalid"},
            )
            with safe_urlopen(
                request,
                timeout=3,
                allow_private=True,
            ) as response:
                self.assertEqual(response.read(), b"ok")

        resolver.assert_called_once()
        self.assertEqual(fake_socket.connected_to, ("127.0.0.1", port))
        self.assertEqual(tls_context.server_hostname, "origin.example")
        self.assertTrue(tls_context.check_hostname)
        self.assertIn(f"Host: origin.example:{port}\r\n".encode(), fake_socket.sent)
        self.assertNotIn(b"attacker.invalid", fake_socket.sent)

    def test_each_redirect_hop_gets_one_new_validated_dns_snapshot(self):
        port = 8088
        first_socket = _FakeSocket(
            (
                "HTTP/1.1 302 Found\r\n"
                f"Location: http://cdn.example:{port}/final\r\n"
                "Content-Length: 0\r\nConnection: close\r\n\r\n"
            ).encode("ascii")
        )
        second_socket = _FakeSocket(
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndone"
        )
        calls: dict[str, int] = {}

        def resolve_hop(host, requested_port, **_kwargs):
            self.assertEqual(requested_port, port)
            calls[host] = calls.get(host, 0) + 1
            if calls[host] > 1:
                raise AssertionError(f"redirect hop {host} was resolved twice")
            return [
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("127.0.0.1", port),
                )
            ]

        with mock.patch("safe_http.socket.getaddrinfo", side_effect=resolve_hop), mock.patch(
            "safe_http.socket.socket", side_effect=[first_socket, second_socket],
        ):
            with safe_urlopen(
                f"http://api.example:{port}/start",
                timeout=3,
                allow_private=True,
                max_redirects=3,
            ) as response:
                self.assertEqual(response.read(), b"done")

        self.assertEqual(calls, {"api.example": 1, "cdn.example": 1})
        self.assertIn(f"Host: api.example:{port}\r\n".encode(), first_socket.sent)
        self.assertIn(f"Host: cdn.example:{port}\r\n".encode(), second_socket.sent)

    def test_localhost_is_blocked_by_default(self):
        with _private(False), self.assertRaises(SafeHttpError):
            validate_url("http://127.0.0.1:7777/small")

    def test_explicit_private_network_allows_ordinary_loopback(self):
        with _private(True):
            self.assertEqual(
                validate_url("http://127.0.0.1:7777/small"),
                "http://127.0.0.1:7777/small",
            )

    def test_http_public_literal_is_rejected_even_with_private_opt_in(self):
        resolution = [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                ("8.8.8.8", 80),
            )
        ]
        with mock.patch("safe_http.socket.getaddrinfo", return_value=resolution), self.assertRaisesRegex(
            SafeHttpError, "明文 HTTP 只允许显式私网地址",
        ):
            validate_url("http://8.8.8.8/resource", allow_private=True)

    def test_http_hostname_resolving_public_is_rejected_with_private_opt_in(self):
        resolution = [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                ("8.8.4.4", 80),
            )
        ]
        with mock.patch("safe_http.socket.getaddrinfo", return_value=resolution), self.assertRaisesRegex(
            SafeHttpError, "明文 HTTP 只允许显式私网地址",
        ):
            validate_url("http://public.example/resource", allow_private=True)

    def test_public_https_remains_allowed(self):
        resolution = [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                ("8.8.8.8", 443),
            )
        ]
        with mock.patch("safe_http.socket.getaddrinfo", return_value=resolution):
            self.assertEqual(
                validate_url("https://public.example/resource", allow_private=False),
                "https://public.example/resource",
            )

    def test_metadata_and_link_local_are_always_blocked(self):
        with _private(True):
            for url in (
                "http://169.254.169.254/latest/meta-data",
                "http://169.254.170.2/credentials",
                "http://[fd00:ec2::254]/latest/meta-data",
                "http://metadata.google.internal/computeMetadata/v1",
            ):
                with self.subTest(url=url), self.assertRaises(SafeHttpError):
                    validate_url(url)

    def test_api_redirects_are_disabled(self):
        handler = SafeRedirectHandler(allow_private=True, max_redirects=0)
        request = urllib.request.Request("http://127.0.0.1:7777/start")
        with self.assertRaises(SafeHttpError):
            handler.redirect_request(request, None, 302, "Found", {}, "/next")

    def test_redirect_target_is_validated_before_following(self):
        handler = SafeRedirectHandler(allow_private=False, max_redirects=3)
        request = urllib.request.Request("https://public.example/start")
        with self.assertRaises(SafeHttpError):
            handler.redirect_request(
                request, None, 302, "Found", {},
                "http://127.0.0.1/private",
            )

    def test_media_redirect_may_follow_three_validated_hops(self):
        handler = SafeRedirectHandler(allow_private=True, max_redirects=3)
        request = urllib.request.Request("http://127.0.0.1:7777/start")
        for index in range(3):
            request = handler.redirect_request(
                request, None, 302, "Found", {}, f"/hop-{index}",
            )
            self.assertIsNotNone(request)
        with self.assertRaises(SafeHttpError):
            handler.redirect_request(request, None, 302, "Found", {}, "/hop-4")

    def test_declared_oversize_preserves_target_and_cleans_temp(self):
        with _private(True), tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "kept.bin"
            output.write_bytes(b"old")
            response = _MemoryResponse(b"x" * 4096, declared=4096)
            with mock.patch("safe_http.safe_urlopen", return_value=response), self.assertRaises(ResponseTooLarge):
                download_atomic("http://127.0.0.1/large", output, max_bytes=32, timeout=3, label="test")
            self.assertEqual(output.read_bytes(), b"old")
            self.assertEqual(list(Path(directory).glob("*.part")), [])

    def test_streamed_oversize_cleans_partial_file(self):
        with _private(True), tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "absent.bin"
            response = _MemoryResponse(b"y" * 4096)
            with mock.patch("safe_http.safe_urlopen", return_value=response), self.assertRaises(ResponseTooLarge):
                download_atomic("http://127.0.0.1/chunked-large", output, max_bytes=32, timeout=3, label="test")
            self.assertFalse(output.exists())
            self.assertEqual(list(Path(directory).glob("*.part")), [])

    def test_media_download_never_inherits_provider_private_network_opt_in(self):
        with _private(True), tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "media.bin"
            with self.assertRaisesRegex(SafeHttpError, "默认拒绝非公网地址"):
                download_atomic(
                    "http://127.0.0.1/media",
                    output,
                    max_bytes=32,
                    timeout=3,
                    label="test",
                )
            self.assertFalse(output.exists())

    def test_sigterm_cleans_active_partial_then_delegates_and_restores_handler(self):
        class Terminated(RuntimeError):
            pass

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "kept.bin"
            output.write_bytes(b"old")
            delegated = []

            def previous_handler(signum, _frame):
                delegated.append(signum)
                self.assertEqual(list(root.glob("*.part")), [])
                raise Terminated("stop")

            state = {"handler": previous_handler}

            def get_handler(_signum):
                return state["handler"]

            def set_handler(_signum, handler):
                old = state["handler"]
                state["handler"] = handler
                return old

            class SignalDuringRead(_MemoryResponse):
                fired = False

                def read(self, size=-1):
                    if not self.fired:
                        self.fired = True
                        state["handler"](signal.SIGTERM, None)
                    return super().read(size)

            with mock.patch("safe_http.signal.getsignal", side_effect=get_handler), mock.patch(
                "safe_http.signal.signal", side_effect=set_handler,
            ), self.assertRaises(Terminated):
                save_response_atomic(
                    SignalDuringRead(b"new"),
                    output,
                    max_bytes=32,
                    label="test",
                )

            self.assertEqual(delegated, [signal.SIGTERM])
            self.assertIs(state["handler"], previous_handler)
            self.assertEqual(output.read_bytes(), b"old")
            self.assertEqual(list(root.glob("*.part")), [])

    def test_small_body_reader_enforces_declared_and_streamed_limits(self):
        with self.assertRaises(ResponseTooLarge):
            read_limited(_MemoryResponse(b"x", declared=100), 10)
        with self.assertRaises(ResponseTooLarge):
            read_limited(_MemoryResponse(b"x" * 11), 10)

    def test_all_safe_openers_disable_proxy_and_use_pinned_transport(self):
        opener = mock.Mock()
        opener.open.return_value = _MemoryResponse(b"ok", declared=2)
        with _private(True), mock.patch(
            "urllib.request.build_opener", return_value=opener,
        ) as build_opener:
            safe_urlopen("http://127.0.0.1/small", timeout=3, direct=True, max_redirects=0)
            direct_handlers = build_opener.call_args.args
            self.assertTrue(any(
                isinstance(handler, urllib.request.ProxyHandler) and handler.proxies == {}
                for handler in direct_handlers
            ))
            build_opener.reset_mock()
            safe_urlopen("http://127.0.0.1/small", timeout=3, direct=False, max_redirects=0)
            safe_handlers = build_opener.call_args.args
            self.assertTrue(any(
                isinstance(handler, urllib.request.ProxyHandler) and handler.proxies == {}
                for handler in safe_handlers
            ))
            self.assertTrue(any(handler.__class__.__name__ == "_PinnedHTTPHandler" for handler in safe_handlers))

    def test_managed_mode_disables_environment_proxies_without_direct_flag(self):
        opener = mock.Mock()
        opener.open.return_value = _MemoryResponse(b"ok", declared=2)
        with _private(True), mock.patch.dict(
            os.environ, {MANAGED_CONFIG_ENV: "1"}, clear=False,
        ), mock.patch(
            "urllib.request.build_opener", return_value=opener,
        ) as build_opener:
            safe_urlopen("http://127.0.0.1/small", timeout=3, max_redirects=0)
            handlers = build_opener.call_args.args
            self.assertTrue(any(
                isinstance(handler, urllib.request.ProxyHandler) and handler.proxies == {}
                for handler in handlers
            ))

    def test_url_credentials_are_rejected_before_open(self):
        with self.assertRaises(SafeHttpError):
            validate_url("https://user:password@example.com/media")

    def test_log_sanitizer_removes_signed_urls_and_temporary_credentials(self):
        output = sanitize_log_text(
            'download https://user:pass@cdn.example.com/media?X-Amz-Signature=secret#frag\n'
            '{"AccessKeyId":"ASIASECRET","SessionToken":"TOKENVALUE"}'
        )
        self.assertIn("https://cdn.example.com/media", output)
        for secret in ("user", "pass", "X-Amz", "secret", "frag", "ASIASECRET", "TOKENVALUE"):
            self.assertNotIn(secret, output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
