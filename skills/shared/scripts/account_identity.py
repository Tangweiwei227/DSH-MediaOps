"""Non-secret, fail-closed account identity helpers for MediaOps probes."""
from __future__ import annotations

import hashlib


def opaque_account_identity(platform: str, stable_id: object) -> str:
    value = str(stable_id or "").strip()
    if not value:
        return ""
    return hashlib.sha256(f"{platform}\0{value}".encode("utf-8")).hexdigest()


def browser_account_identity(context, platform: str, *, stable_id: str = "", name: str = "", avatar: str = "") -> str:
    """Hash only a platform-owned stable self-account id.

    Nicknames, avatars and auth cookies are intentionally not accepted as a
    fallback: they are ambiguous or rotate, so a missing id must fail closed.
    """
    del context, name, avatar
    stable_id = (stable_id or "").strip()
    return opaque_account_identity(platform, stable_id) if stable_id else ""
