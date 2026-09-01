#!/usr/bin/env python3
# Modified by DSH-MediaOps, 2026: adapted for DSH integration and safer operation.
"""bili_upload.py — B站投稿封装（包装 biliup CLI）。

包装成熟的 biliup（Rust 后端）命令行做 B站视频投稿：友好参数、分区名→tid 映射、
cookie 路径管理、dry-run 预览、投稿执行。

⚠️ 环境依赖：投稿/登录需 **biliup CLI + 已登录 cookie（QR 扫码）+ 外网**。当前无头环境可做
   `check` 与命令构造（dry-run），真实登录/投稿需在有网络与账号的环境执行。

子命令：
    check      检查 biliup 是否安装、cookie 是否存在
    login      扫码登录 B站，保存 cookie（biliup login）
    tid        列出常用投稿分区 → tid
    upload     投稿（默认 dry-run 预览命令；--exec 真正执行）
    selftest   自检（命令构造 + 分区映射 + check）

用法举例：
    bili_upload.py check
    bili_upload.py login --cookie cookies.json
    bili_upload.py upload --video out.mp4 --title "标题" --partition 知识 \\
        --tag "AI,教程,效率" --desc "简介" --cover cover.jpg --cookie cookies.json
    bili_upload.py upload ... --exec        # 真正投稿
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

SHARED_SCRIPTS = Path(__file__).resolve().parents[3] / "shared" / "scripts"
sys.path.insert(0, str(SHARED_SCRIPTS))
import content_guard  # noqa: E402
import bili_login  # noqa: E402
from account_identity import opaque_account_identity  # noqa: E402


def _workspace_root() -> Path:
    raw = os.environ.get("DSH_MEDIAOPS_WORKSPACE") or os.environ.get("EASEL_ROOT")
    return Path(raw).expanduser().resolve() if raw else Path.cwd().resolve()


def _data_root() -> Path:
    raw = os.environ.get("DSH_MEDIAOPS_DATA_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    dsh_home = os.environ.get("DSH_HOME")
    return ((Path(dsh_home).expanduser().resolve() / "mediaops") if dsh_home
            else Path.home() / ".dsh" / "mediaops")


def _secure_dir(path: Path) -> Path:
    if path.is_symlink():
        raise RuntimeError(f"敏感目录不能是符号链接：{path}")
    path.mkdir(parents=True, exist_ok=True)
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise RuntimeError(f"敏感目录必须是真实目录：{path}")
    path.chmod(0o700)
    if os.name != "nt" and stat.S_IMODE(path.lstat().st_mode) != 0o700:
        raise RuntimeError(f"敏感目录权限必须是 0700：{path}")
    return path


def _secure_file(path: Path) -> None:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise RuntimeError(f"敏感文件必须是普通文件，不能是符号链接：{path}")
    path.chmod(0o600)
    if os.name != "nt" and stat.S_IMODE(path.lstat().st_mode) != 0o600:
        raise RuntimeError(f"敏感文件权限必须是 0600：{path}")


def _secure_subdirectory(root: Path, *segments: str) -> Path:
    current = _secure_dir(root)
    for segment in segments:
        current = _secure_dir(current / segment)
    return current


WORKSPACE_ROOT = _workspace_root()
DEFAULT_COOKIE = _data_root() / "credentials" / "bilibili" / "cookies.json"


def _workspace_path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else WORKSPACE_ROOT / path


def _cookie_path(value: str | None) -> Path:
    if not value:
        return DEFAULT_COOKIE
    path = Path(value).expanduser()
    return path if path.is_absolute() else _data_root() / path


def _freeze_cookie_file(cookie: Path, directory: Path | None = None) -> Path:
    target_dir = (_secure_dir(directory) if directory is not None else
                  _secure_subdirectory(_data_root(), "credentials", "bilibili", "attempt-cookies"))
    fd, raw_path = tempfile.mkstemp(prefix="attempt-", suffix=".json", dir=target_dir)
    frozen = Path(raw_path)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(cookie.read_bytes())
            handle.flush()
            os.fsync(handle.fileno())
        _secure_file(frozen)
        return frozen
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        frozen.unlink(missing_ok=True)
        raise


def _verify_frozen_cookie_identity(cookie: Path, expected: str | None) -> None:
    if not expected:
        return
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        _die("--expected-account-identity 格式无效", 8)
    raw_cookie, _ = bili_login._load_cookie(cookie)
    if not raw_cookie:
        _die("执行前账号身份复核失败：冻结 Cookie 无有效登录态", 8)
    try:
        nav = (bili_login._api("https://api.bilibili.com/x/web-interface/nav", raw_cookie).get("data") or {})
    except Exception as exc:
        _die(f"执行前账号身份复核失败：{type(exc).__name__}", 8)
    mid = int(nav.get("mid") or 0) if nav.get("isLogin") else 0
    observed = opaque_account_identity("bilibili", mid)
    if not observed or observed != expected:
        _die("执行前账号身份与冻结预览不一致；为避免发错号，已停止投稿", 8)

# 常用投稿分区名 → tid（B站分区，节选常用）
PARTITIONS: dict[str, int] = {
    "动画": 1, "音乐": 3, "游戏": 4, "娱乐": 5, "生活": 160, "日常": 21,
    "科技": 188, "数码": 95, "知识": 36, "科普": 201, "资讯": 202,
    "影视": 181, "美食": 211, "时尚": 155, "美妆": 157, "穿搭": 158,
    "运动": 234, "汽车": 223, "动物": 217, "舞蹈": 129, "鬼畜": 119,
    "绘画": 162, "手工": 161, "摄影": 282, "职场": 253, "校园": 55,
    "母婴": 216, "家居": 239, "旅游": 250, "三农": 251,
}


def _die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def _has_biliup() -> bool:
    return shutil.which("biliup") is not None


def resolve_tid(partition: str | None, tid: int | None) -> int:
    if tid is not None:
        return tid
    if not partition:
        return 36  # 默认 知识
    partition = partition.strip()
    if partition.isdigit():
        return int(partition)
    if partition in PARTITIONS:
        return PARTITIONS[partition]
    _die(f"未知分区：{partition}。用 `tid` 子命令看支持列表，或直接用 --tid 数字。")
    raise AssertionError


def build_cmd(a) -> list[str]:
    """构造 biliup upload 命令（纯函数，供测试）。全局选项在子命令前。"""
    cookie = _cookie_path(a.cookie)
    cmd = ["biliup", "-u", str(cookie)]
    if getattr(a, "proxy", None):
        cmd += ["-p", a.proxy]
    cmd += ["upload", str(_workspace_path(a.video))]
    cmd += ["--title", a.title or Path(a.video).stem]
    cmd += ["--tid", str(resolve_tid(a.partition, a.tid))]
    if a.desc:
        cmd += ["--desc", a.desc]
    if a.tag:
        cmd += ["--tag", a.tag]
    if a.cover:
        cmd += ["--cover", str(_workspace_path(a.cover))]
    cmd += ["--copyright", str(a.copyright)]
    if a.copyright == 2 and a.source:
        cmd += ["--source", a.source]
    if getattr(a, "dtime", None):
        cmd += ["--dtime", str(a.dtime)]
    return cmd


def cmd_check(_a) -> int:
    ok = True
    if _has_biliup():
        try:
            v = subprocess.run(["biliup", "--version"], capture_output=True, text=True)
            print(f"✅ biliup: {(v.stdout or v.stderr).strip()}")
        except Exception:
            print("✅ biliup 已安装")
    else:
        print("❌ 未安装 biliup（pip install biliup）"); ok = False
    print(f"分区映射：内置 {len(PARTITIONS)} 个常用分区，其余用 --tid 数字")
    print(f"cookie：投稿前需 `login` 扫码登录生成（默认 {DEFAULT_COOKIE}）")
    return 0 if ok else 3


def cmd_login(a) -> int:
    if not _has_biliup():
        _die("未安装 biliup（pip install biliup）", 3)
    cookie = _cookie_path(a.cookie)
    cookie.parent.mkdir(parents=True, exist_ok=True)
    try:
        cookie.relative_to(_data_root())
        _secure_dir(_data_root())
        _secure_dir(cookie.parent)
    except ValueError:
        pass
    print(f"启动 B站扫码登录，cookie 将保存到 {cookie} ...", file=sys.stderr)
    print("（需终端可显示二维码 + 手机 B站 App 扫码 + 外网）", file=sys.stderr)
    rc = subprocess.call(["biliup", "-u", str(cookie), "login"])
    if cookie.is_file():
        _secure_file(cookie)
    return rc


def cmd_tid(_a) -> int:
    print("常用投稿分区 → tid：")
    for name, tid in PARTITIONS.items():
        print(f"  {name:6s} {tid}")
    print("\n更多分区见 B站创作中心；也可直接 --tid <数字>。")
    return 0


def cmd_upload(a) -> int:
    video = _workspace_path(a.video)
    if not video.is_file():
        _die(f"视频不存在：{video}")
    if not a.exec:
        cmd = build_cmd(a)
        printable = " ".join(f'"{c}"' if " " in c else c for c in cmd)
        content_guard.guard_or_die(
            [a.title or Path(a.video).stem, a.desc, a.tag, a.source],
            exec_mode=False,
            label="B站投稿内容",
        )
        print("dry-run（加 --exec 真正投稿）：\n" + printable)
        print("\n前置：已 `login` 生成 cookie、biliup 已装、外网可用。", file=sys.stderr)
        return 0
    if not _has_biliup():
        _die("未安装 biliup", 3)
    cookie = _cookie_path(a.cookie)
    if not cookie.is_file():
        _die(f"cookie 不存在：{cookie}，请先 `login`。")
    _secure_file(cookie)
    frozen_cookie = _freeze_cookie_file(cookie)
    try:
        _verify_frozen_cookie_identity(
            frozen_cookie, getattr(a, "expected_account_identity", None))
        a.cookie = str(frozen_cookie)
        cmd = build_cmd(a)
        content_guard.guard_or_die(
            [a.title or Path(a.video).stem, a.desc, a.tag, a.source],
            exec_mode=True,
            label="B站投稿内容",
        )
        print("投稿中 ...", file=sys.stderr)
        rc = subprocess.call(cmd)
    finally:
        frozen_cookie.unlink(missing_ok=True)
    if rc == 0:
        # 投稿成功 → 落统一内容日历（对话页自动；发布页 B 站走 biliup CLI 由 web 记录，路径不同不重复）
        try:
            import calendar_ops
            calendar_ops.record_publish("bilibili", a.title or Path(a.video).stem,
                                        ptype="视频", tags=(a.tag or ""),
                                        note=(a.desc or ""), source="chat")
        except Exception:
            pass
    return rc


def cmd_selftest(_a) -> int:
    print("bili_upload 自检 ...", file=sys.stderr)
    with tempfile.TemporaryDirectory(prefix="bili-upload-selftest-") as raw_dir:
        root = Path(raw_dir)
        source_cookie = root / "source.json"
        source_cookie.write_bytes(b'{"cookie_info":{"cookies":[]}}')
        frozen_cookie = _freeze_cookie_file(source_cookie, root / "copies")
        assert frozen_cookie.read_bytes() == source_cookie.read_bytes(), "Cookie 快照内容不一致"
        if os.name != "nt":
            assert frozen_cookie.stat().st_mode & 0o777 == 0o600, "Cookie 快照权限不是 0600"
            assert frozen_cookie.parent.stat().st_mode & 0o777 == 0o700, "Cookie 快照目录权限不是 0700"
        try:
            _verify_frozen_cookie_identity(frozen_cookie, "invalid")
            raise AssertionError("非法账号身份摘要未被拒绝")
        except SystemExit:
            pass
        outside = root / "outside"
        outside.mkdir()
        linked_root = root / "linked-attempt-root"
        linked_root.symlink_to(outside, target_is_directory=True)
        try:
            _freeze_cookie_file(source_cookie, linked_root)
            raise AssertionError("符号链接 Cookie 快照根目录未被拒绝")
        except RuntimeError:
            pass
    # 分区解析
    assert resolve_tid("知识", None) == 36
    assert resolve_tid("科技", None) == 188
    assert resolve_tid(None, 999) == 999, "显式 tid 应优先"
    assert resolve_tid("21", None) == 21, "数字分区应直通"
    # 命令构造
    a = argparse.Namespace(video="out.mp4", title="标题", partition="知识", tid=None,
                           desc="简介", tag="AI,教程", cover="c.jpg", copyright=1,
                           source="", dtime=None, cookie="ck.json", proxy=None)
    cmd = build_cmd(a)
    assert cmd[0] == "biliup" and "upload" in cmd, "命令头不对"
    assert "-u" in cmd and str(_cookie_path("ck.json")) in cmd, "cookie 未带上"
    assert cmd[cmd.index("--tid") + 1] == "36", "tid 未映射"
    assert cmd[cmd.index("--title") + 1] == "标题"
    assert cmd[cmd.index("--tag") + 1] == "AI,教程"
    # 全局选项在子命令前
    assert cmd.index("-u") < cmd.index("upload"), "全局 -u 应在 upload 前"
    # 转载来源
    a2 = argparse.Namespace(video="v.mp4", title="", partition=None, tid=None, desc="",
                            tag="", cover="", copyright=2, source="https://x",
                            dtime=None, cookie=None, proxy=None)
    c2 = build_cmd(a2)
    assert "--source" in c2 and c2[c2.index("--copyright")+1] == "2", "转载参数缺失"
    assert c2[c2.index("--title")+1] == "v", "无标题应回退文件名"
    # check（此环境已装 biliup）
    assert cmd_check(None) in (0, 3)
    print("✅ selftest 通过（分区映射/命令构造/全局选项顺序/转载/check）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="B站投稿（包装 biliup CLI）",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    sub.add_parser("check", help="检查 biliup/cookie").set_defaults(func=cmd_check)
    sub.add_parser("tid", help="列出常用分区 tid").set_defaults(func=cmd_tid)

    pl = sub.add_parser("login", help="扫码登录保存 cookie")
    pl.add_argument("--cookie", help="cookie 文件路径（默认 DSH MediaOps 数据目录/credentials/bilibili/cookies.json）")
    pl.set_defaults(func=cmd_login)

    pu = sub.add_parser("upload", help="投稿")
    pu.add_argument("--video", required=True, help="视频文件")
    pu.add_argument("--title", help="标题（默认取文件名）")
    pu.add_argument("--partition", help="分区名（如 知识/科技/生活）")
    pu.add_argument("--tid", type=int, help="分区 tid（数字，优先于 --partition）")
    pu.add_argument("--desc", help="简介")
    pu.add_argument("--desc-file", help="UTF-8 简介文件（与 --desc 二选一，受控 adapter 推荐）")
    pu.add_argument("--tag", help="标签，逗号分隔")
    pu.add_argument("--cover", help="封面图")
    pu.add_argument("--copyright", type=int, default=1, choices=[1, 2],
                    help="1-自制(默认) 2-转载")
    pu.add_argument("--source", help="转载来源（copyright=2 时）")
    pu.add_argument("--dtime", type=int, help="定时发布 10 位时间戳（距今>4h）")
    pu.add_argument("--cookie", help="cookie 文件（默认 DSH MediaOps 数据目录/credentials/bilibili/cookies.json）")
    pu.add_argument("--proxy", help="代理")
    pu.add_argument("--expected-account-identity", help="Host 冻结的账号身份 SHA-256；投稿前会验证私有 Cookie 快照")
    pu.add_argument("--exec", action="store_true", help="真正投稿（默认 dry-run 预览）")
    pu.set_defaults(func=cmd_upload)

    sub.add_parser("selftest", help="自检").set_defaults(func=cmd_selftest)

    a = ap.parse_args()
    if not getattr(a, "func", None):
        ap.print_help()
        return 1
    if getattr(a, "desc_file", None):
        if getattr(a, "desc", None):
            ap.error("--desc 与 --desc-file 不能同时使用")
        try:
            a.desc = Path(a.desc_file).read_text(encoding="utf-8")
        except OSError as exc:
            ap.error(f"无法读取 --desc-file: {exc}")
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
