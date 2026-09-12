#!/usr/bin/env python3
"""Bounded, redirect-aware HTTP helpers for DSH-MediaOps media scripts.

This module is intentionally stdlib-only. It validates the initial URL and
every redirect target, refuses any non-global address unless the Host opted a
provider into private network access, and never buffers media bodies in memory.
Every request connects only to the validated DNS snapshot and bypasses
environment proxies, so validation and transport cannot resolve different IPs.
"""
from __future__ import annotations

import http.client
import ipaddress
import json
import os
import re
import secrets
import signal
import socket
import stat
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO, NamedTuple


ALLOW_PRIVATE_ENV = "DSH_MEDIAOPS_ALLOW_PRIVATE_NETWORK"
MANAGED_CONFIG_ENV = "DSH_MEDIAOPS_MANAGED_MODEL_CONFIG"
WORKSPACE_ENV = "DSH_MEDIAOPS_WORKSPACE"
RUN_ID_ENV = "DSH_MEDIAOPS_MODEL_RUN_ID"
WORKSPACE_DEV_ENV = "DSH_MEDIAOPS_OUTPUT_WORKSPACE_DEV"
WORKSPACE_INO_ENV = "DSH_MEDIAOPS_OUTPUT_WORKSPACE_INO"
OUTPUTS_DEV_ENV = "DSH_MEDIAOPS_OUTPUTS_DEV"
OUTPUTS_INO_ENV = "DSH_MEDIAOPS_OUTPUTS_INO"
MAX_DOWNLOAD_REDIRECTS = 3
MAX_JSON_BYTES = 32 * 1024 * 1024
MAX_ERROR_BYTES = 256 * 1024
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_AUDIO_BYTES = 256 * 1024 * 1024
MAX_VIDEO_BYTES = 1024 * 1024 * 1024
STREAM_CHUNK_BYTES = 64 * 1024

_METADATA_HOSTS = {
    "metadata",
    "metadata.google.internal",
    "instance-data",
    "instance-data.ec2.internal",
}
_ALWAYS_BLOCKED_NETWORKS = (
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("fe80::/10"),
)
_ALWAYS_BLOCKED_ADDRESSES = {
    ipaddress.ip_address("169.254.169.254"),
    ipaddress.ip_address("169.254.170.2"),
    ipaddress.ip_address("fd00:ec2::254"),
}
_EXPLICIT_PRIVATE_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("::1/128"),
)
_URL_IN_TEXT = re.compile(r"https?://[^\s<>\"'`]+", re.IGNORECASE)
_SENSITIVE_ASSIGNMENT = re.compile(
    r"(?:api[_-]?key|secret[_-]?key|access[_-]?key|accesskeyid|"
    r"secretaccesskey|sessiontoken|security[_-]?token|token|password|"
    r"credential|signature|private[_-]?key|signed[_-]?url|\bpolicy\b)",
    re.IGNORECASE,
)
_ACTIVE_TEMP_FILES: set[tuple[int, str]] = set()
_SIGTERM_HANDLER_INSTALLED = False
_PREVIOUS_SIGTERM_HANDLER: Any = signal.SIG_DFL
_ACTIVE_SECURE_OUTPUT: "SecureOutput | None" = None

_DIRECTORY_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_DIRECTORY", 0)
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
)
_TEMP_FLAGS = (
    os.O_RDWR
    | os.O_CREAT
    | os.O_EXCL
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
)
_RUN_ID_PATTERN = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\Z")


class SafeHttpError(urllib.error.URLError):
    """Security or size-policy failure surfaced like other urllib failures."""


class ResponseTooLarge(SafeHttpError):
    """Response exceeded its declared or streamed byte budget."""


class SecureOutputError(RuntimeError):
    """The Host-approved output directory cannot be pinned safely."""


def _parse_expected_identity(name: str, *, required: bool) -> int | None:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        if required:
            raise SecureOutputError(f"受管输出缺少 Host inode 凭据: {name}")
        return None
    if not raw.isdecimal():
        raise SecureOutputError(f"Host inode 凭据不是十进制整数: {name}")
    return int(raw, 10)


def _assert_identity(fd: int, expected_dev: int | None, expected_ino: int | None, label: str) -> None:
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode):
        raise SecureOutputError(f"{label} 不是目录")
    if expected_dev is not None and expected_ino is not None:
        if (info.st_dev, info.st_ino) != (expected_dev, expected_ino):
            raise SecureOutputError(f"{label} inode 与 Host 批准值不匹配")


def _safe_component(value: str) -> str:
    if not value or value in {".", ".."} or value != os.path.basename(value):
        raise SecureOutputError("输出路径包含不安全目录组件")
    if "\x00" in value or any(ord(character) < 0x20 for character in value):
        raise SecureOutputError("输出路径包含控制字符")
    return value


def _open_child_directory(parent_fd: int, name: str, *, create: bool) -> int:
    component = _safe_component(name)
    try:
        return os.open(component, _DIRECTORY_FLAGS, dir_fd=parent_fd)
    except FileNotFoundError:
        if not create:
            raise
    try:
        os.mkdir(component, 0o700, dir_fd=parent_fd)
    except FileExistsError:
        pass
    return os.open(component, _DIRECTORY_FLAGS, dir_fd=parent_fd)


def _open_relative_directory(root_fd: int, components: tuple[str, ...], *, create: bool) -> int:
    current = os.dup(root_fd)
    try:
        for raw_component in components:
            next_fd = _open_child_directory(current, raw_component, create=create)
            os.close(current)
            current = next_fd
        _assert_identity(current, None, None, "输出目标父目录")
        return current
    except BaseException:
        os.close(current)
        raise


def _lexical_output_path(workspace: str, raw_output: str | os.PathLike[str]) -> tuple[str, tuple[str, ...]]:
    raw = os.fspath(raw_output)
    if not raw or "\x00" in raw or any(ord(character) < 0x20 for character in raw):
        raise SecureOutputError("输出路径为空或包含控制字符")
    expanded = os.path.expanduser(raw)
    candidate = os.path.normpath(
        expanded if os.path.isabs(expanded) else os.path.join(workspace, expanded)
    )
    output_root = os.path.join(workspace, "outputs")
    try:
        contained = os.path.commonpath((output_root, candidate)) == output_root
    except ValueError as exc:
        raise SecureOutputError("输出路径不属于当前 workspace") from exc
    if not contained or candidate == output_root:
        raise SecureOutputError("输出必须位于当前 workspace 的 outputs/ 子目录")
    relative = os.path.relpath(candidate, output_root)
    components = tuple(_safe_component(value) for value in Path(relative).parts)
    if not components:
        raise SecureOutputError("输出必须位于 outputs/ 子目录")
    return candidate, components


class SecureOutput:
    """Pinned workspace/output/parent directory descriptors for one CLI run.

    Managed executions must present the device/inode values captured by the
    Host immediately before spawn.  All descendants are then opened with
    ``dir_fd`` + ``O_NOFOLLOW`` and the final parent descriptor remains open
    for the complete provider request/poll/download lifecycle.
    """

    def __init__(
        self,
        raw_output: str | os.PathLike[str],
        *,
        output_is_directory: bool = False,
    ) -> None:
        managed = os.environ.get(MANAGED_CONFIG_ENV) == "1"
        raw_workspace = os.environ.get(WORKSPACE_ENV, "").strip()
        if managed and not raw_workspace:
            raise SecureOutputError(f"受管输出缺少 {WORKSPACE_ENV}")
        workspace = os.path.normpath(os.path.abspath(raw_workspace or os.getcwd()))
        if managed and not os.path.isabs(raw_workspace):
            raise SecureOutputError("受管 workspace 必须是绝对路径")

        run_id = os.environ.get(RUN_ID_ENV, "").strip()
        if managed and not _RUN_ID_PATTERN.fullmatch(run_id):
            raise SecureOutputError(f"受管输出缺少或包含无效 {RUN_ID_ENV}")
        if not run_id:
            import uuid
            run_id = str(uuid.uuid4())
        elif not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", run_id):
            raise SecureOutputError("输出 run id 包含不安全字符")

        workspace_dev = _parse_expected_identity(WORKSPACE_DEV_ENV, required=managed)
        workspace_ino = _parse_expected_identity(WORKSPACE_INO_ENV, required=managed)
        outputs_dev = _parse_expected_identity(OUTPUTS_DEV_ENV, required=managed)
        outputs_ino = _parse_expected_identity(OUTPUTS_INO_ENV, required=managed)
        pins = (workspace_dev, workspace_ino, outputs_dev, outputs_ino)
        if not managed and any(value is not None for value in pins) and any(value is None for value in pins):
            raise SecureOutputError("Host 输出 inode 凭据必须完整提供")

        workspace_fd: int | None = None
        outputs_fd: int | None = None
        parent_fd: int | None = None
        try:
            workspace_fd = os.open(workspace, _DIRECTORY_FLAGS)
            _assert_identity(workspace_fd, workspace_dev, workspace_ino, "workspace")
            try:
                outputs_fd = _open_child_directory(workspace_fd, "outputs", create=not managed)
            except FileNotFoundError as exc:
                raise SecureOutputError("Host 批准的 outputs 目录在脚本启动前消失") from exc
            _assert_identity(outputs_fd, outputs_dev, outputs_ino, "workspace/outputs")

            target_path, components = _lexical_output_path(workspace, raw_output)
            parent_components = components if output_is_directory else components[:-1]
            parent_fd = _open_relative_directory(outputs_fd, parent_components, create=True)
        except BaseException as exc:
            for fd in (parent_fd, outputs_fd, workspace_fd):
                if fd is not None:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
            if isinstance(exc, OSError):
                raise SecureOutputError("无法安全打开 Host 批准的输出目录") from exc
            raise

        self.workspace = workspace
        self.workspace_fd = workspace_fd
        self.outputs_fd = outputs_fd
        self.parent_fd = parent_fd
        self.target_path = target_path
        self.parent_path = target_path if output_is_directory else os.path.dirname(target_path)
        self.run_id = run_id
        self.closed = False

    def destination(self, output: str | os.PathLike[str]) -> tuple[int, str]:
        if self.closed:
            raise SecureOutputError("安全输出上下文已经关闭")
        candidate, components = _lexical_output_path(self.workspace, output)
        if os.path.dirname(candidate) != self.parent_path:
            raise SecureOutputError("派生输出越出启动时固定的目标父目录")
        return os.dup(self.parent_fd), _safe_component(components[-1])

    def stat(self, output: str | os.PathLike[str]) -> os.stat_result:
        parent_fd, name = self.destination(output)
        try:
            info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                raise SecureOutputError("输出目标不是普通文件")
            return info
        finally:
            os.close(parent_fd)

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        for fd in (self.parent_fd, self.outputs_fd, self.workspace_fd):
            try:
                os.close(fd)
            except OSError:
                pass


def activate_secure_output(
    raw_output: str | os.PathLike[str],
    *,
    output_is_directory: bool = False,
) -> Path:
    """Pin an approved output before a provider can make any network call."""
    global _ACTIVE_SECURE_OUTPUT
    if _ACTIVE_SECURE_OUTPUT is not None:
        raise SecureOutputError("同一进程不能同时激活多个安全输出上下文")
    secured = SecureOutput(raw_output, output_is_directory=output_is_directory)
    _ACTIVE_SECURE_OUTPUT = secured
    return Path(secured.target_path)


def close_secure_output() -> None:
    global _ACTIVE_SECURE_OUTPUT
    secured = _ACTIVE_SECURE_OUTPUT
    _ACTIVE_SECURE_OUTPUT = None
    if secured is not None:
        secured.close()


def secure_output_active() -> bool:
    return _ACTIVE_SECURE_OUTPUT is not None


def secure_output_run_id() -> str:
    if _ACTIVE_SECURE_OUTPUT is not None:
        return _ACTIVE_SECURE_OUTPUT.run_id
    run_id = os.environ.get(RUN_ID_ENV, "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{1,80}", run_id):
        return run_id
    return secrets.token_hex(16)


def secure_output_stat(output: str | os.PathLike[str]) -> os.stat_result:
    if _ACTIVE_SECURE_OUTPUT is None:
        return os.stat(output, follow_symlinks=False)
    return _ACTIVE_SECURE_OUTPUT.stat(output)


class _ResolvedEndpoint(NamedTuple):
    family: int
    socktype: int
    protocol: int
    sockaddr: Any


class _ResolvedTarget(NamedTuple):
    url: str
    hostname: str
    port: int
    endpoints: tuple[_ResolvedEndpoint, ...]


def private_network_allowed() -> bool:
    return os.environ.get(ALLOW_PRIVATE_ENV, "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _resolved_endpoints(hostname: str, port: int) -> tuple[_ResolvedEndpoint, ...]:
    try:
        records = socket.getaddrinfo(
            hostname, port, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise SafeHttpError(f"URL 主机 DNS 解析失败: {hostname}: {exc}") from exc
    endpoints: list[_ResolvedEndpoint] = []
    seen: set[tuple[int, int, int, str]] = set()
    for family, socktype, protocol, _canonical_name, sockaddr in records:
        key = (family, socktype, protocol, repr(sockaddr))
        if key in seen:
            continue
        seen.add(key)
        endpoints.append(_ResolvedEndpoint(family, socktype, protocol, sockaddr))
    return tuple(endpoints)


def _validated_target(url: str, *, allow_private: bool) -> _ResolvedTarget:
    """Resolve and validate once; the returned endpoints are the connect snapshot."""
    if not isinstance(url, str) or not url or any(ord(ch) < 0x20 for ch in url):
        raise SafeHttpError("URL 为空或包含控制字符")
    try:
        parsed = urllib.parse.urlsplit(url)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise SafeHttpError(f"URL 无效: {exc}") from exc
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise SafeHttpError("只允许 http(s) URL")
    if not hostname:
        raise SafeHttpError("URL 缺少主机名")
    if parsed.username is not None or parsed.password is not None:
        raise SafeHttpError("URL 不能包含用户名或密码")
    hostname = hostname.rstrip(".").lower()
    if hostname in _METADATA_HOSTS or hostname.endswith(".metadata.google.internal"):
        raise SafeHttpError("始终拒绝云元数据地址")
    target_port = port or (443 if scheme == "https" else 80)
    endpoints = _resolved_endpoints(hostname, target_port)
    if not endpoints:
        raise SafeHttpError(f"URL 主机没有可用地址: {hostname}")
    for endpoint in endpoints:
        raw = endpoint.sockaddr[0]
        try:
            address = ipaddress.ip_address(raw.split("%", 1)[0])
        except ValueError as exc:
            raise SafeHttpError(f"DNS 返回无效 IP: {raw}") from exc
        if address in _ALWAYS_BLOCKED_ADDRESSES or any(
            address in network for network in _ALWAYS_BLOCKED_NETWORKS
        ):
            raise SafeHttpError(f"始终拒绝链路本地/云元数据地址: {hostname} -> {address}")
        explicit_private = any(address in network for network in _EXPLICIT_PRIVATE_NETWORKS)
        # Plain HTTP is only acceptable for explicitly opted-in local/private
        # providers. Public providers must use HTTPS even when the private
        # network switch is enabled; checking every endpoint also rejects a
        # mixed public/private DNS answer.
        if scheme == "http" and address.is_global:
            raise SafeHttpError(
                f"明文 HTTP 只允许显式私网地址: {hostname} -> {address}"
            )
        # The explicit opt-in is intentionally narrow: ordinary loopback,
        # RFC1918 and IPv6 ULA only. It never opens link-local, multicast,
        # unspecified, documentation or reserved ranges.
        if allow_private and explicit_private:
            continue
        # is_global excludes every remaining non-public category.
        if not address.is_global:
            raise SafeHttpError(f"默认拒绝非公网地址: {hostname} -> {address}")
    return _ResolvedTarget(url, hostname, target_port, endpoints)


def validate_url(url: str, *, allow_private: bool | None = None) -> str:
    """Validate one outbound URL before the opener sees it."""
    allow = private_network_allowed() if allow_private is None else bool(allow_private)
    _validated_target(url, allow_private=allow)
    return url


def _connect_resolved(
    target: _ResolvedTarget,
    timeout: object,
    source_address: Any = None,
):
    """Connect only to addresses from the validated DNS snapshot."""
    last_error: OSError | None = None
    for endpoint in target.endpoints:
        sock = None
        try:
            sock = socket.socket(endpoint.family, endpoint.socktype, endpoint.protocol)
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(endpoint.sockaddr)
            return sock
        except OSError as exc:
            last_error = exc
            if sock is not None:
                sock.close()
    if last_error is not None:
        raise last_error
    raise SafeHttpError(f"URL 主机没有可用连接地址: {target.hostname}")


def _set_origin_host_header(req: urllib.request.Request, target: _ResolvedTarget) -> None:
    parsed = urllib.parse.urlsplit(target.url)
    ascii_hostname = target.hostname.encode("idna").decode("ascii")
    host = f"[{ascii_hostname}]" if ":" in ascii_hostname else ascii_hostname
    authority = f"{host}:{parsed.port}" if parsed.port is not None else host
    # A caller-supplied Host must not diverge from the hostname that was DNS
    # validated and (for HTTPS) certificate-checked.
    req.remove_header("Host")
    req.add_unredirected_header("Host", authority)


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, *, resolved_target: _ResolvedTarget, **kwargs: Any):
        self._resolved_target = resolved_target
        super().__init__(host, **kwargs)

    def connect(self) -> None:
        self.sock = _connect_resolved(
            self._resolved_target, self.timeout, self.source_address,
        )
        if self._tunnel_host:
            self._tunnel()


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, *, resolved_target: _ResolvedTarget, **kwargs: Any):
        self._resolved_target = resolved_target
        super().__init__(host, **kwargs)

    def connect(self) -> None:
        self.sock = _connect_resolved(
            self._resolved_target, self.timeout, self.source_address,
        )
        if self._tunnel_host:
            self._tunnel()
        # Connect to the pinned IP, but authenticate and send SNI for the
        # original validated hostname. HTTPConnection.host remains unchanged,
        # so urllib also emits the original Host authority.
        self.sock = self._context.wrap_socket(
            self.sock, server_hostname=self._resolved_target.hostname,
        )


def _target_for_request(req: urllib.request.Request, allow_private: bool) -> _ResolvedTarget:
    target = getattr(req, "_dsh_mediaops_resolved_target", None)
    if isinstance(target, _ResolvedTarget) and target.url == req.full_url:
        _set_origin_host_header(req, target)
        return target
    target = _validated_target(req.full_url, allow_private=allow_private)
    setattr(req, "_dsh_mediaops_resolved_target", target)
    _set_origin_host_header(req, target)
    return target


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, *, allow_private: bool):
        super().__init__()
        self.allow_private = allow_private

    def http_open(self, req):  # noqa: ANN001
        target = _target_for_request(req, self.allow_private)
        return self.do_open(
            _PinnedHTTPConnection, req, resolved_target=target,
        )


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, *, allow_private: bool):
        super().__init__()
        self.allow_private = allow_private

    def https_open(self, req):  # noqa: ANN001
        target = _target_for_request(req, self.allow_private)
        return self.do_open(
            _PinnedHTTPSConnection,
            req,
            context=self._context,
            check_hostname=self._check_hostname,
            resolved_target=target,
        )


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Validate each Location target and cap a redirect chain."""

    def __init__(self, *, allow_private: bool, max_redirects: int = 0):
        super().__init__()
        self.allow_private = allow_private
        self.max_redirects = max_redirects

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        count = int(getattr(req, "_dsh_mediaops_redirect_count", 0)) + 1
        if count > self.max_redirects:
            raise SafeHttpError(f"HTTP 重定向超过 {self.max_redirects} 次")
        absolute = urllib.parse.urljoin(req.full_url, newurl)
        target = _validated_target(absolute, allow_private=self.allow_private)
        redirected = super().redirect_request(req, fp, code, msg, headers, absolute)
        if redirected is not None:
            setattr(redirected, "_dsh_mediaops_redirect_count", count)
            setattr(redirected, "_dsh_mediaops_resolved_target", target)
            _set_origin_host_header(redirected, target)
        return redirected


def safe_urlopen(
    request: str | urllib.request.Request,
    *,
    timeout: int | float,
    direct: bool = False,
    allow_private: bool | None = None,
    max_redirects: int = 0,
):
    """Open a validated URL with a validating redirect handler."""
    allow = private_network_allowed() if allow_private is None else bool(allow_private)
    url = request.full_url if isinstance(request, urllib.request.Request) else request
    target = _validated_target(url, allow_private=allow)
    if not isinstance(request, urllib.request.Request):
        request = urllib.request.Request(request)
    setattr(request, "_dsh_mediaops_resolved_target", target)
    _set_origin_host_header(request, target)
    # A proxy would resolve/connect the hostname independently and reopen the
    # DNS-rebinding window after validation. Security-sensitive helpers always
    # disable environment proxies and connect only to the validated snapshot;
    # `direct` remains a compatibility argument but cannot weaken this rule.
    handlers: list[Any] = [
        urllib.request.ProxyHandler({}),
        SafeRedirectHandler(allow_private=allow, max_redirects=max_redirects),
        _PinnedHTTPHandler(allow_private=allow),
        _PinnedHTTPSHandler(allow_private=allow),
    ]
    opener = urllib.request.build_opener(*handlers)
    return opener.open(request, timeout=timeout)


def _declared_length(response: Any) -> int | None:
    raw = response.headers.get("Content-Length") if getattr(response, "headers", None) else None
    if raw is None:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise SafeHttpError("响应 Content-Length 无效") from exc
    if value < 0:
        raise SafeHttpError("响应 Content-Length 不能为负数")
    return value


def _check_declared_length(response: Any, max_bytes: int, label: str) -> None:
    declared = _declared_length(response)
    if declared is not None and declared > max_bytes:
        raise ResponseTooLarge(f"{label} Content-Length {declared} 超过 {max_bytes} 字节上限")


def read_limited(response: BinaryIO, max_bytes: int, *, label: str = "响应") -> bytes:
    """Read a small body with Content-Length and streaming enforcement."""
    if max_bytes <= 0:
        raise ValueError("max_bytes must be positive")
    _check_declared_length(response, max_bytes, label)
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(min(STREAM_CHUNK_BYTES, max_bytes - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ResponseTooLarge(f"{label} 流式响应超过 {max_bytes} 字节上限")
        chunks.append(chunk)
    return b"".join(chunks)


def read_text_limited(
    response: BinaryIO,
    max_bytes: int = MAX_JSON_BYTES,
    *,
    label: str = "JSON 响应",
) -> str:
    return read_limited(response, max_bytes, label=label).decode("utf-8", errors="replace")


def read_json_limited(
    response: BinaryIO,
    max_bytes: int = MAX_JSON_BYTES,
    *,
    label: str = "JSON 响应",
) -> Any:
    raw = read_text_limited(response, max_bytes, label=label)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SafeHttpError(f"{label} 不是有效 JSON: {raw[:300]}") from exc


def read_error_text(response: BinaryIO, max_bytes: int = MAX_ERROR_BYTES) -> str:
    try:
        return read_text_limited(response, max_bytes, label="错误响应")
    except ResponseTooLarge as exc:
        return f"[错误响应已截断: {exc.reason}]"


def _cleanup_active_temp_files() -> None:
    for parent_fd, temporary_name in tuple(_ACTIVE_TEMP_FILES):
        try:
            os.unlink(temporary_name, dir_fd=parent_fd)
        except FileNotFoundError:
            pass
        except OSError:
            pass
        finally:
            _ACTIVE_TEMP_FILES.discard((parent_fd, temporary_name))


def _handle_sigterm(signum: int, frame: Any) -> None:
    """Remove active partials, then preserve the process' prior SIGTERM policy."""
    _cleanup_active_temp_files()
    previous = _PREVIOUS_SIGTERM_HANDLER
    if callable(previous) and previous is not _handle_sigterm:
        previous(signum, frame)
        return
    if previous == signal.SIG_IGN:
        return
    # Restore and re-deliver so the default handler retains true SIGTERM
    # semantics (rather than turning it into a catchable Python exception).
    signal.signal(signum, signal.SIG_DFL)
    os.kill(os.getpid(), signum)


def _install_sigterm_cleanup() -> None:
    global _PREVIOUS_SIGTERM_HANDLER, _SIGTERM_HANDLER_INSTALLED
    if _SIGTERM_HANDLER_INSTALLED:
        return
    try:
        previous = signal.signal(signal.SIGTERM, _handle_sigterm)
    except (AttributeError, ValueError):
        # signal.signal is only legal on the main thread. Managed media scripts
        # perform atomic writes there; worker-only callers still get normal
        # exception cleanup and the Host janitor covers hard termination.
        return
    _PREVIOUS_SIGTERM_HANDLER = previous
    _SIGTERM_HANDLER_INSTALLED = True


def _restore_sigterm_cleanup_if_idle() -> None:
    global _PREVIOUS_SIGTERM_HANDLER, _SIGTERM_HANDLER_INSTALLED
    if _ACTIVE_TEMP_FILES or not _SIGTERM_HANDLER_INSTALLED:
        return
    try:
        if signal.getsignal(signal.SIGTERM) is _handle_sigterm:
            signal.signal(signal.SIGTERM, _PREVIOUS_SIGTERM_HANDLER)
    except (AttributeError, ValueError):
        return
    _PREVIOUS_SIGTERM_HANDLER = signal.SIG_DFL
    _SIGTERM_HANDLER_INSTALLED = False


def _release_tracked_temp(parent_fd: int, temporary_name: str) -> None:
    _ACTIVE_TEMP_FILES.discard((parent_fd, temporary_name))
    _restore_sigterm_cleanup_if_idle()


def _destination_for_path(output: Path) -> tuple[int, str, str]:
    output = Path(output).expanduser()
    if _ACTIVE_SECURE_OUTPUT is not None:
        parent_fd, final_name = _ACTIVE_SECURE_OUTPUT.destination(output)
        return parent_fd, final_name, _ACTIVE_SECURE_OUTPUT.run_id
    if os.environ.get(MANAGED_CONFIG_ENV) == "1":
        raise SecureOutputError("受管模型脚本必须在网络请求前激活安全输出")

    # Internal/direct callers outside a CLI run still get an fd-relative
    # atomic replace. CLI entry points always install SecureOutput first.
    absolute = Path(os.path.abspath(os.fspath(output)))
    absolute.parent.mkdir(parents=True, exist_ok=True)
    real_parent = os.path.realpath(absolute.parent)
    parent_fd = os.open(real_parent, _DIRECTORY_FLAGS)
    _assert_identity(parent_fd, None, None, "输出目标父目录")
    run_id = os.environ.get(RUN_ID_ENV, "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", run_id):
        run_id = secrets.token_hex(16)
    return parent_fd, _safe_component(absolute.name), run_id


class AtomicOutput:
    """A unique run-labelled partial anchored to an already-open directory."""

    def __init__(self, output: Path, *, temporary_suffix: str = "") -> None:
        if temporary_suffix and not re.fullmatch(r"\.[A-Za-z0-9]{1,16}", temporary_suffix):
            raise SecureOutputError("临时输出扩展名不安全")
        self.output = Path(output)
        self.parent_fd, self.final_name, run_id = _destination_for_path(self.output)
        self.temporary_name = ""
        self.fd: int | None = None
        self.verify_fd: int | None = None
        self.identity: tuple[int, int] | None = None
        self.committed = False
        old_mask = None
        if hasattr(signal, "pthread_sigmask"):
            try:
                old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM})
            except (OSError, ValueError):
                old_mask = None
        try:
            _install_sigterm_cleanup()
            for _attempt in range(128):
                random_part = secrets.token_hex(12)
                temporary_name = f".dsh-mediaops-{run_id}-{random_part}.part{temporary_suffix}"
                try:
                    fd = os.open(
                        temporary_name,
                        _TEMP_FLAGS,
                        0o600,
                        dir_fd=self.parent_fd,
                    )
                except FileExistsError:
                    continue
                self.temporary_name = temporary_name
                self.fd = fd
                self.verify_fd = os.dup(fd)
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode):
                    raise SecureOutputError("临时输出必须是普通文件")
                self.identity = (info.st_dev, info.st_ino)
                _ACTIVE_TEMP_FILES.add((self.parent_fd, self.temporary_name))
                break
            else:
                raise SecureOutputError("无法创建唯一的模型输出临时文件")
        except BaseException:
            self.abort()
            raise
        finally:
            if old_mask is not None:
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)

    def take_fd(self) -> int:
        if self.fd is None:
            raise SecureOutputError("临时输出文件描述符已转移")
        fd = self.fd
        self.fd = None
        return fd

    def fileno(self) -> int:
        if self.fd is None:
            raise SecureOutputError("临时输出文件描述符不可用")
        return self.fd

    def commit(self, *, max_bytes: int | None = None, require_nonempty: bool = False) -> Path:
        if self.committed or self.verify_fd is None or self.identity is None:
            raise SecureOutputError("临时输出不能重复提交")
        if self.fd is not None:
            os.fsync(self.fd)
        info = os.fstat(self.verify_fd)
        linked = os.stat(self.temporary_name, dir_fd=self.parent_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(info.st_mode)
            or not stat.S_ISREG(linked.st_mode)
            or (info.st_dev, info.st_ino) != self.identity
            or (linked.st_dev, linked.st_ino) != self.identity
        ):
            raise SecureOutputError("临时输出在原子替换前发生变化")
        if require_nonempty and info.st_size <= 0:
            raise SecureOutputError("模型输出为空")
        if max_bytes is not None and info.st_size > max_bytes:
            raise ResponseTooLarge(f"模型输出 {info.st_size} 字节超过 {max_bytes} 字节上限")
        os.fsync(self.verify_fd)
        os.replace(
            self.temporary_name,
            self.final_name,
            src_dir_fd=self.parent_fd,
            dst_dir_fd=self.parent_fd,
        )
        try:
            os.fsync(self.parent_fd)
        except OSError:
            pass
        self.committed = True
        _release_tracked_temp(self.parent_fd, self.temporary_name)
        self._close_fds()
        parent_fd = self.parent_fd
        self.parent_fd = None
        os.close(parent_fd)
        return self.output

    def _close_fds(self) -> None:
        for attribute in ("fd", "verify_fd"):
            fd = getattr(self, attribute)
            if fd is not None:
                try:
                    os.close(fd)
                except OSError:
                    pass
                setattr(self, attribute, None)

    def abort(self) -> None:
        parent_fd = self.parent_fd
        if parent_fd is None:
            return
        self._close_fds()
        if self.temporary_name and not self.committed:
            try:
                os.unlink(self.temporary_name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
            except OSError:
                pass
        if self.temporary_name:
            _release_tracked_temp(parent_fd, self.temporary_name)
        try:
            os.close(parent_fd)
        except OSError:
            pass
        self.parent_fd = None

    def __enter__(self) -> "AtomicOutput":
        return self

    def __exit__(self, _type, _value, _traceback) -> None:
        self.abort()


def open_atomic_output(output: Path, *, temporary_suffix: str = "") -> AtomicOutput:
    return AtomicOutput(Path(output), temporary_suffix=temporary_suffix)


def _atomic_stream_to_path(response: BinaryIO, output: Path, max_bytes: int, label: str) -> Path:
    output = Path(output)
    _check_declared_length(response, max_bytes, label)
    total = 0
    atomic = open_atomic_output(output)
    try:
        with os.fdopen(atomic.take_fd(), "wb") as handle:
            while True:
                chunk = response.read(STREAM_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ResponseTooLarge(f"{label} 流式响应超过 {max_bytes} 字节上限")
                handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
        return atomic.commit(max_bytes=max_bytes)
    finally:
        atomic.abort()


def download_atomic(
    url: str,
    output: Path,
    *,
    max_bytes: int,
    timeout: int | float,
    label: str,
    direct: bool = False,
) -> Path:
    request = urllib.request.Request(url, headers={"User-Agent": "DSH-MediaOps/1"})
    # Media downloads carry no provider Authorization header and may follow a
    # short CDN chain. Every Location is still revalidated before the hop.
    with safe_urlopen(
        request, timeout=timeout, direct=direct,
        allow_private=False,
        max_redirects=MAX_DOWNLOAD_REDIRECTS,
    ) as response:
        return _atomic_stream_to_path(response, Path(output), max_bytes, label)


def url_for_log(raw: str) -> str:
    """Return only scheme + authority; signed paths/query values stay secret."""
    try:
        parsed = urllib.parse.urlsplit(raw)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return "[invalid-url]"
        port = f":{parsed.port}" if parsed.port is not None else ""
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        return f"{parsed.scheme.lower()}://{host}{port}/[redacted-path]"
    except (TypeError, ValueError):
        return "[invalid-url]"


def sanitize_log_text(value: object) -> str:
    """Sanitize URLs and temporary-credential objects before stderr/stdout."""
    text = str(value)

    def clean_url(match: re.Match[str]) -> str:
        raw = match.group(0)
        trailing = ""
        while raw and raw[-1] in "),.;]}":
            trailing = raw[-1] + trailing
            raw = raw[:-1]
        try:
            parsed = urllib.parse.urlsplit(raw)
            if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
                return "[redacted-url]" + trailing
            port = f":{parsed.port}" if parsed.port is not None else ""
            host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
            return urllib.parse.urlunsplit((parsed.scheme.lower(), host + port, parsed.path, "", "")) + trailing
        except (TypeError, ValueError):
            return "[redacted-url]" + trailing

    cleaned = _URL_IN_TEXT.sub(clean_url, text)
    lines = []
    for line in cleaned.splitlines():
        if _SENSITIVE_ASSIGNMENT.search(line) and (":" in line or "=" in line):
            lines.append("[sensitive provider detail redacted]")
        else:
            lines.append(re.sub(r"Bearer\s+[^\s,;]+", "Bearer [REDACTED]", line, flags=re.IGNORECASE))
    return "\n".join(lines)


def save_response_atomic(response: BinaryIO, output: Path, *, max_bytes: int, label: str) -> Path:
    return _atomic_stream_to_path(response, Path(output), max_bytes, label)


def save_bytes_atomic(data: bytes, output: Path, *, max_bytes: int, label: str) -> Path:
    if len(data) > max_bytes:
        raise ResponseTooLarge(f"{label} {len(data)} 字节超过 {max_bytes} 字节上限")
    output = Path(output)
    atomic = open_atomic_output(output)
    try:
        with os.fdopen(atomic.take_fd(), "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        return atomic.commit(max_bytes=max_bytes)
    finally:
        atomic.abort()


def bounded_b64decode(value: str, *, max_bytes: int, label: str) -> bytes:
    """Reject oversized base64 before allocating its decoded representation."""
    import base64
    import binascii

    if not isinstance(value, str):
        raise SafeHttpError(f"{label} base64 必须是字符串")
    max_encoded = ((max_bytes + 2) // 3) * 4 + 4
    if len(value) > max_encoded:
        raise ResponseTooLarge(f"{label} base64 超过 {max_bytes} 字节解码上限")
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise SafeHttpError(f"{label} base64 无效: {exc}") from exc
    if len(decoded) > max_bytes:
        raise ResponseTooLarge(f"{label} 超过 {max_bytes} 字节上限")
    return decoded
