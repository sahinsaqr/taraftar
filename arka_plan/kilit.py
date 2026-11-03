"""Tek izleyici kilidi: aynı anda yalnız bir izleyici bildirim gönderir.

Kilit depodaki veri/izleyici.json dosyasıdır: {"sahip": <çalışma id>, "alindi": <iso>}.

Neden: futbol.yml'deki "kontrol" işi çalışan izleyiciyi her zaman görmüyor (2026-11-03: 12:30'da başlayan
izleyici 13:00'te görünmedi). İki izleyici çalıştı ve her olay telefona iki kez gitti. Bu kilit
kontrol işi yanılsa da ikinci izleyicinin bildirim göndermesini engeller.

Yarışsız alma (karşılaştır-ve-değiştir): kilidi yazan commit, okunduğu andaki uzak dal ucunun (origin/main)
üstüne doğrudan kurulur (git commit-tree) ve yalnız o uca ileri sarma (fast-forward) olarak push edilir;
-X theirs ile birleştirme yok. Arada başka bir commit gittiyse (başka izleyicinin kilidi ya da ilgisiz bir
veri commit'i) push reddedilir: kilit yeniden okunur ve karar baştan verilir. İki izleyici aynı anda
denerse push'u ilk kabul edilen kazanır; diğeri reddedilir, kilitte yaşayan başka sahibi görür ve kaybeder.

Kilit ne zaman alınabilir:
  - kilit yok, sahip boş ya da sahip zaten bu çalışma,
  - sahip çalışma GitHub'a göre bitmiş (completed),
  - GitHub API'ye ~2 dk boyunca (API_BEKLE) ulaşılamadı ve "alindi" GECERLILIK'ten (6 saat) eski:
    calis işi en fazla 350 dk sürer, o sahip kesin bitmiştir.
Sahip API'ye göre sürüyorsa ya da API'ye ulaşılamadı ama kilit yeniyse alınmaz (çift bildirim, kaçan
bildirimden kötü); izleyici izlemeden kapanır, sıradaki tetikleme yeniden dener.

Devirde (devir.py) eski sahip "devredildi" işaretiyle aynı commit'te sahipliği yeni çalışmaya yazar
(o da karşılaştır-ve-değiştir: yalnız kilit hâlâ eski sahipteyse); yeni sahibin "alindi"si devir anıdır.
Sahip olan izleyici her turda uzaktaki kilide bakar; başkası sahip olmuşsa gönderimi bırakıp kapanır.
Normal kapanışta (son durum gönderildikten sonra) kilit, yalnız hâlâ kendisindeyse boşaltılır (birak);
sıradaki izleyici API'ye sormadan alır. 6 saat kuralı yalnız çöken, kilidi bırakamayan izleyiciler için kalır.

Yerelde (GitHub Actions dışında) kilit yoktur: her zaman sahip sayılır, git'e dokunulmaz.
"""
import json
import os
import subprocess
import time
from datetime import timedelta

import ortak
from ortak import iso, simdi, zaman_oku

DOSYA = "veri/izleyici.json"
GECERLILIK = timedelta(hours=6)          # calis işi en fazla 350 dk: bundan eski kilidin sahibi kesin bitmiş
API_BEKLE = (10, 20, 30, 60)             # API'ye ulaşılamazsa denemeler arası saniye (5 deneme, ~2 dk)
PUSH_DENEME = 8                          # ilgisiz commit yüzünden reddedilen push'u bu kadar kez yeniden kur


def calisma_id():
    return os.environ.get("GITHUB_RUN_ID", "")


def _git(kok, *args, girdi=None, ortam=None):
    return subprocess.run(["git", *args], cwd=kok, capture_output=True, text=True, input=girdi,
                          env={**os.environ, **(ortam or {})})


def _uzak(kok):
    """(uzak ad, dal) — ör. ("origin", "main"); bulunamazsa None."""
    r = _git(kok, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if r.returncode != 0 or "/" not in r.stdout.strip():
        return None
    uzak, dal = r.stdout.strip().split("/", 1)
    return uzak, dal


def _uc_ve_kilit(kok, cek=True):
    """Uzak dal ucunun commit'i ve o uçtaki kilit (yoksa {}); okunamazsa (None, None)."""
    if cek and _git(kok, "fetch", "-q").returncode != 0:
        return None, None
    uc = _git(kok, "rev-parse", "@{u}")
    if uc.returncode != 0:
        return None, None
    r = _git(kok, "show", f"{uc.stdout.strip()}:{DOSYA}")
    if r.returncode != 0:
        return uc.stdout.strip(), {}   # dosya henüz yok
    try:
        return uc.stdout.strip(), json.loads(r.stdout) or {}
    except json.JSONDecodeError:
        return uc.stdout.strip(), {}


def sahip_durumu(sahip):
    """"bitti" | "suruyor" | "bilinmiyor" (API'ye API_BEKLE boyunca ulaşılamadı)."""
    import devir   # döngüsel içe aktarma olmasın
    for i in range(len(API_BEKLE) + 1):
        kod, veri = devir._api("GET", f"actions/runs/{sahip}")
        if kod == 200 and veri:
            return "bitti" if veri.get("status") == "completed" else "suruyor"
        if i < len(API_BEKLE):
            print(f"Kilit: sahip çalışmanın ({sahip}) durumu alınamadı (HTTP {kod or 'yok'}), "
                  f"{API_BEKLE[i]} sn sonra yeniden denenecek.")
            time.sleep(API_BEKLE[i])
    return "bilinmiyor"


def alinabilir_mi(kilit, ben):
    """Bu kilit `ben` tarafından alınabilir mi? (Gerekirse sahibin durumunu GitHub'a sorar.)"""
    sahip = str((kilit or {}).get("sahip") or "")
    if not sahip or sahip == ben:
        return True
    durum = sahip_durumu(sahip)
    if durum == "bitti":
        print(f"Kilit: önceki sahip {sahip} bitmiş.")
        return True
    if durum == "suruyor":
        print(f"Kilit: sahip {sahip} hâlâ çalışıyor.")
        return False
    alindi = zaman_oku(kilit.get("alindi"))
    if alindi and simdi() - alindi > GECERLILIK:
        print(f"Kilit: GitHub API'ye ulaşılamadı; kilit {alindi:%Y-%m-%d %H:%M} UTC'de alınmış "
              f"({GECERLILIK} sınırından eski), sahip {sahip} kesin bitmiş sayılıyor.")
        return True
    print(f"Kilit: GitHub API'ye ulaşılamadı ve kilit yeni (sahip {sahip}, {kilit.get('alindi')}); alınmıyor.")
    return False


def _cas_gonder(kok, uc, dosyalar, mesaj):
    """`dosyalar` ({depo yolu: metin}) `uc`un üstüne tek commit olarak kurulur ve yalnız ileri sarma
    olarak push edilir. Çalışma kopyasına ve yerel dala dokunmaz. Kabul edildiyse True."""
    hedef = _uzak(kok)
    if not hedef:
        return False
    uzak, dal = hedef
    index = os.path.join(_git(kok, "rev-parse", "--git-dir").stdout.strip(), "kilit_index")
    if not os.path.isabs(index):
        index = os.path.join(kok, index)
    ortam = {"GIT_INDEX_FILE": index}
    try:
        if _git(kok, "read-tree", uc, ortam=ortam).returncode != 0:
            return False
        for yol, metin in dosyalar.items():
            blob = _git(kok, "hash-object", "-w", "--stdin", girdi=metin).stdout.strip()
            if _git(kok, "update-index", "--add", "--cacheinfo", f"100644,{blob},{yol}", ortam=ortam).returncode:
                return False
        agac = _git(kok, "write-tree", ortam=ortam).stdout.strip()
        commit = _git(kok, "commit-tree", agac, "-p", uc, "-m", mesaj)
        if commit.returncode != 0:
            print(f"Kilit: commit kurulamadı: {commit.stderr.strip()}")
            return False
        # ileri sarma değilse (uç değiştiyse) uzak depo reddeder; --force yok
        return _git(kok, "push", "-q", uzak, f"{commit.stdout.strip()}:refs/heads/{dal}").returncode == 0
    finally:
        try:
            os.remove(index)
        except OSError:
            pass


def _yereli_esitle(kok):
    """Kabul edilen kilit commit'ini çalışma kopyasına al (veri/ değişiklikleri korunur)."""
    _git(kok, "pull", "-q", "--rebase", "--autostash", "-X", "theirs")


def _metin(veri):
    return json.dumps(veri, ensure_ascii=False, separators=(",", ":"))


def al(ben=None, kok=None):
    """Kilidi `ben` adına alır. Alındıysa (ya da zaten bendeyse) True; başkası sahipse False."""
    if not ortak.actions_icinde():
        return True
    ben = ben or calisma_id()
    kok = kok or ortak.KOK
    for deneme in range(PUSH_DENEME):
        uc, kilit = _uc_ve_kilit(kok)
        if uc is None:
            print("Kilit: uzak depo okunamadı, yeniden deneniyor.")
            time.sleep(API_BEKLE[min(deneme, len(API_BEKLE) - 1)])
            continue
        if str(kilit.get("sahip") or "") == ben:
            return True
        if not alinabilir_mi(kilit, ben):
            return False
        yeni = {"sahip": ben, "alindi": iso(), "onceki": kilit.get("sahip") or ""}
        if _cas_gonder(kok, uc, {DOSYA: _metin(yeni)}, f"İzleyici kilidi alındı ({ben})"):
            _yereli_esitle(kok)
            print(f"Kilit: alındı ({ben}).")
            return True
        print(f"Kilit: push reddedildi (bu arada başka commit gitti), kilit yeniden okunuyor ({deneme + 1}. deneme).")
    print("Kilit: alınamadı (push sürekli reddedildi).")
    return False


def bende_mi(ben=None, kok=None):
    """Her turda: uzaktaki kilit hâlâ bende mi? Okunamazsa (ağ) True: bilinmeyen durumda izleme kesilmez."""
    if not ortak.actions_icinde():
        return True
    ben = ben or calisma_id()
    uc, kilit = _uc_ve_kilit(kok or ortak.KOK)
    if uc is None:
        return True
    return str(kilit.get("sahip") or "") == ben


def birak(ben=None, kok=None):
    """İzleyici kapanırken: kilit hâlâ bendeyse sahibi boşaltır (karşılaştır-ve-değiştir; bu arada başkası
    sahip olduysa ona dokunulmaz). Böylece sıradaki izleyici API'ye sormadan alır; 6 saat kuralı yalnız
    çöken (bırakamayan) izleyiciler için kalır. Bırakıldıysa True."""
    if not ortak.actions_icinde():
        return True
    ben = ben or calisma_id()
    kok = kok or ortak.KOK
    for _ in range(PUSH_DENEME):
        uc, kilit = _uc_ve_kilit(kok)
        if uc is None:
            print("Kilit: bırakılamadı (uzak depo okunamadı); sıradaki izleyici sahibin bittiğini API'den görür.")
            return False
        if str(kilit.get("sahip") or "") != ben:
            return False   # bende değil (devredildi ya da başkası aldı): dokunma
        bos = {"sahip": "", "birakildi": iso(), "onceki": ben}
        if _cas_gonder(kok, uc, {DOSYA: _metin(bos)}, f"İzleyici kilidi bırakıldı ({ben})"):
            _yereli_esitle(kok)
            print(f"Kilit: bırakıldı ({ben}).")
            return True
    print("Kilit: bırakılamadı (push sürekli reddedildi).")
    return False


def devret(yeni, dosyalar, mesaj, ben=None, kok=None):
    """Devir: sahipliği `yeni`ye yazar; `dosyalar` ({depo yolu: metin}, ör. canli.json + devir.json) aynı
    commit'e girer. Yalnız kilit hâlâ bendeyse (ya da yoksa). Gönderildiyse True."""
    if not ortak.actions_icinde():
        return True
    ben = ben or calisma_id()
    kok = kok or ortak.KOK
    for _ in range(PUSH_DENEME):
        uc, kilit = _uc_ve_kilit(kok)
        if uc is None:
            return False
        if str(kilit.get("sahip") or "") not in ("", ben):
            print(f"Kilit: devredilemez, sahip artık {kilit.get('sahip')}.")
            return False
        hepsi = {**dosyalar, DOSYA: _metin({"sahip": yeni, "alindi": iso(), "onceki": ben})}
        if _cas_gonder(kok, uc, hepsi, mesaj):
            _yereli_esitle(kok)
            return True
    return False
