"""Dosya yolları, JSON okuma/yazma ve git işlemleri."""
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
VERI = KOK / "veri"


def simdi():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or simdi()).strftime("%Y-%m-%dT%H:%M:%SZ")


def zaman_oku(metin):
    if not metin:
        return None
    metin = metin.replace("Z", "+00:00")
    # ESPN bazen saniyesiz verir: 2026-08-14T18:30+00:00
    try:
        return datetime.fromisoformat(metin)
    except ValueError:
        return None


def json_oku(yol, varsayilan=None):
    try:
        with open(yol, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return varsayilan


def json_yaz(yol, veri):
    yol = Path(yol)
    yol.parent.mkdir(parents=True, exist_ok=True)
    gecici = yol.with_suffix(".tmp")
    with open(gecici, "w", encoding="utf-8") as f:
        json.dump(veri, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(gecici, yol)


def ayarlar():
    return json_oku(KOK / "ayarlar.json", {"ligler": []})


def kisaltma(takim_id, varsayilan="", kaynak="espn"):
    """Takımın kısaltması (kisaltmalar.json, uygulamayla ortak); tabloda yoksa sağlayıcınınki."""
    if not hasattr(kisaltma, "tablo"):
        veri = json_oku(KOK / "kisaltmalar.json", {}) or {}
        kisaltma.tablo = {(k, str(t[k])): t["kisa"] for t in veri.get("takimlar", []) for k in t
                          if k not in ("kisa", "ad")}
    return kisaltma.tablo.get((kaynak, str(takim_id)), varsayilan)


def dakika(metin):
    """Uzatma dakikası "90+4'" biçiminde (ESPN "90'+4'" verir); diğerleri olduğu gibi."""
    return re.sub(r"(\d+)'\s*\+\s*(\d+)'?", r"\g<1>+\g<2>'", metin or "")


def takip_edilenler():
    veri = json_oku(KOK / "takip.json", {}) or {}
    return {str(t["id"]) for t in veri.get("bildirim_takimlari", []) if t.get("id")}


def git_gonder(mesaj):
    """veri/ klasöründeki değişiklikleri depoya gönderir.

    Sadece GitHub Actions içinde (GITHUB_ACTIONS=true) çalışır; bilgisayarda
    deneme yaparken hiçbir şey göndermez.
    """
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return False

    def git(*args, kontrol=True):
        return subprocess.run(["git", *args], cwd=KOK, check=kontrol,
                              capture_output=True, text=True)

    git("add", "veri")
    if git("diff", "--cached", "--quiet", kontrol=False).returncode == 0:
        return False  # değişiklik yok
    git("commit", "-m", mesaj)
    for _ in range(3):
        if git("push", kontrol=False).returncode == 0:
            return True
        git("pull", "--rebase", "-X", "theirs", kontrol=False)
    print("Uyarı: değişiklikler gönderilemedi.")
    return False
