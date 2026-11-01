"""İzleyiciler arası devir: 5,5 saat sınırında boşluk kalmasın, aynı anda tek izleyici bildirim göndersin.

Akış (el sıkışma veri/devir.json üzerinden, ikisi de git ile okunur/yazılır):
  1. Eski izleyici süresinin sonuna DEVIR_PAYI kala, izlenecek maç varsa futbol.yml'yi
     mod=devir, onceki=<kendi run id> ile tetikler (workflow_dispatch; GITHUB_TOKEN buna izinli).
     Tetikleyemezse dakikada bir yeniden dener. Bu arada izlemeyi sürdürür.
  2. Yeni çalışma kurulup ilk veri güncellemesini yapınca devir.json'a {"onceki", "yeni", "hazir"} yazar
     ve push eder, sonra beklemeye geçer (henüz bildirim göndermez).
  3. Eski izleyici her turda devir.json'un uzaktaki haline bakar; "hazir" görünce son durumu
     (canli.json: bildirilenler + bekleyenler) devir.json'daki "devredildi" işaretiyle aynı commit'te
     push eder ve kapanır.
  4. Yeni izleyici "devredildi"yi görünce git pull ile o canli.json'u alır ve izlemeye başlar.
     Önceki çalışma devretmeden biterse (ör. çöktüyse) ya da 3 dk içinde işaret gelmezse
     mevcut canli.json ile başlar.

Ortam değişkenleri (futbol.yml verir):
  GH_TOKEN          : workflow_dispatch ve çalışma durumu için (github.token, actions: write)
  GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_REF_NAME : GitHub Actions'ın kendi değişkenleri
  DEVIR_ONCEKI      : (yeni çalışma) devreden çalışmanın run id'si
  DEVIR_TESTI_DK    : deneme: izleyici bu kadar dakika sonra devretsin, maç yokken de beklesin.
                      Yeni çalışmaya aktarılmaz; zincir bir devirden sonra durur.
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from datetime import timedelta

from ortak import VERI, git_cek, git_gonder, iso, json_yaz, uzak_json

DOSYA = "veri/devir.json"
DEVIR_PAYI = timedelta(minutes=15)       # süre sınırından bu kadar önce devir başlar
ISTEK_ARALIGI = timedelta(minutes=1)     # tetikleme başarısızsa yeniden deneme aralığı
BAKIS_ARALIGI = timedelta(seconds=10)    # eski izleyici devir.json'a en sık bu aralıkla bakar
BEKLEME_SINIRI = 180                     # yeni izleyici "devredildi"yi en fazla bu kadar sn bekler
IS_AKISI = "futbol.yml"


def calisma_id():
    return os.environ.get("GITHUB_RUN_ID", "")


def test_dakikasi():
    try:
        return int(os.environ.get("DEVIR_TESTI_DK", "").strip() or 0)
    except ValueError:
        return 0


def _api(yontem, yol, govde=None):
    """GitHub REST çağrısı → (durum kodu, json ya da None). Token yoksa (0, None)."""
    token = os.environ.get("GH_TOKEN", "").strip()
    depo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not token or not depo:
        return 0, None
    istek = urllib.request.Request(
        f"https://api.github.com/repos/{depo}/{yol}", method=yontem,
        data=json.dumps(govde).encode() if govde is not None else None,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(istek, timeout=20) as y:
            veri = y.read()
            return y.status, (json.loads(veri) if veri else None)
    except urllib.error.HTTPError as h:
        return h.code, None
    except Exception as h:
        print(f"  GitHub API hatası: {h}")
        return 0, None


def iste():
    """Yeni izleyiciyi başlatır (mod=devir). Başarılıysa True."""
    dal = os.environ.get("GITHUB_REF_NAME", "main") or "main"
    durum, _ = _api("POST", f"actions/workflows/{IS_AKISI}/dispatches",
                    {"ref": dal, "inputs": {"mod": "devir", "onceki": calisma_id()}})
    ok = durum == 204
    print(f"Devir: yeni izleyici istendi → HTTP {durum or 'yok (token yok)'}{'' if ok else ', sonra yeniden denenecek'}")
    return ok


def onceki_bitti_mi(onceki):
    durum, veri = _api("GET", f"actions/runs/{onceki}")
    return durum == 200 and (veri or {}).get("status") == "completed"


def ozet(yol=None):
    """canli.json'un devir kontrolü için özeti: sayılar ve içerik özeti (iki taraf da aynısını görmeli)."""
    yol = yol or VERI / "canli.json"
    try:
        with open(yol, "rb") as f:
            ham = f.read()
    except FileNotFoundError:
        return {"sha": "yok"}
    d = json.loads(ham or b"{}")
    return {"sha": hashlib.sha256(ham).hexdigest()[:12], "guncelleme": d.get("guncelleme"),
            "mac": len(d.get("maclar", [])), "bildirilen": len(d.get("bildirilenler", [])),
            "bekleyen": len(d.get("bekleyenler", []))}


class Devirci:
    """Eski izleyici tarafı: tetikle, yeni hazır mı diye bak."""

    def __init__(self):
        self.istendi = False
        self.son_istek = None
        self.son_bakis = None
        self.yeni = None

    def adim(self, su_an):
        """Her turda çağrılır. Yeni izleyici hazırsa True."""
        if not self.istendi:
            if self.son_istek and su_an - self.son_istek < ISTEK_ARALIGI:
                return False
            self.son_istek = su_an
            self.istendi = iste()
            return False
        if self.son_bakis and su_an - self.son_bakis < BAKIS_ARALIGI:
            return False
        self.son_bakis = su_an
        d = uzak_json(DOSYA) or {}
        if d.get("onceki") == calisma_id() and d.get("hazir") and not d.get("devredildi"):
            self.yeni = d.get("yeni")
            print(f"Devir: yeni izleyici hazır (çalışma {self.yeni}, {d['hazir']})")
            return True
        return False

    def devret(self):
        """canli.json yazılmış olmalı. Devredildi işaretini aynı commit'te push eder; başarılıysa True."""
        oz = ozet()
        json_yaz(VERI / "devir.json", {"onceki": calisma_id(), "yeni": self.yeni, "devredildi": iso(), "ozet": oz})
        if not git_gonder("Devir: izleme yeni çalışmaya devredildi"):
            print("Devir: durum gönderilemedi; izlemeye devam, sonraki turda yeniden denenecek.")
            return False
        print(f"Devir: durum devredildi → {oz}. Bu izleyici kapanıyor.")
        return True


def devri_al(onceki):
    """Yeni izleyici tarafı: hazır olduğunu bildirir, eskisinin durumu devretmesini bekler."""
    ben = calisma_id()
    json_yaz(VERI / "devir.json", {"onceki": onceki, "yeni": ben, "hazir": iso()})
    if git_gonder("Devir: yeni izleyici hazır"):
        print(f"Devir: hazır işareti gönderildi; önceki çalışma {onceki} bekleniyor.")
    else:
        print("Devir: hazır işareti gönderilemedi; önceki çalışmanın bitmesi beklenecek.")
    bas = time.monotonic()
    son_api = 0.0
    while time.monotonic() - bas < BEKLEME_SINIRI:
        d = uzak_json(DOSYA) or {}
        if d.get("devredildi") and d.get("onceki") == onceki and d.get("yeni") == ben:
            git_cek()
            oz = ozet()
            esit = oz.get("sha") == (d.get("ozet") or {}).get("sha")
            print(f"Devir: durum alındı ({int(time.monotonic() - bas)} sn bekledi) → {oz}; "
                  f"devredenle {'AYNI' if esit else 'FARKLI'} (devreden: {d.get('ozet')})")
            return True
        if time.monotonic() - son_api >= 15:
            son_api = time.monotonic()
            if onceki_bitti_mi(onceki):
                git_cek()
                print(f"Devir: önceki çalışma devretmeden bitti; mevcut durumla başlanıyor → {ozet()}")
                return False
        time.sleep(3)
    git_cek()
    print(f"Devir: {BEKLEME_SINIRI} sn içinde devredilmedi; mevcut durumla başlanıyor → {ozet()}")
    return False
