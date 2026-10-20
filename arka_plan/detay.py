"""Maç detayı dosyaları: veri/detay/{maç id}.json (olaylar, istatistik, kadrolar).

Hangi maç için ne zaman istek atılacağına burada karar verilir; ESPN'e özgü ayrıştırma espn.py'de.
- Canlı maç: izleyici her gönderimde günceller.
- Son 7 günde biten maç: bitince bir kez yazılır (dosya "post" ise bir daha istek atılmaz).
- Yaklaşan maç: başlamaya KADRO_ONCESI kala, kadro açıklanınca bir kez yazılır.
- 7 günden eski detay dosyaları silinir.
Dosyalar veri/ altında olduğu için git_gonder() ile mevcut commit'lere girer (ek commit yok).
"""
import time
from datetime import timedelta

import espn
from ortak import VERI, iso, json_oku, json_yaz, simdi, zaman_oku

KLASOR = VERI / "detay"
SAKLA = timedelta(days=7)
KADRO_ONCESI = timedelta(minutes=75)   # kadrolar genelde maçtan ~1 saat önce açıklanır
ERTELENDI = {"STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_ABANDONED"}


def yol(mac_id):
    return KLASOR / f"{mac_id}.json"


def oku(mac_id):
    return json_oku(yol(mac_id))


def yaz(m):
    """Maçın detayını ESPN'den alıp yazar. Başarısızsa False (sonraki turda yeniden denenir)."""
    try:
        d = espn.mac_detayi(m["lig"], m["id"])
    except espn.VeriHatasi as h:
        print(f"  detay alınamadı ({m['id']}): {h}")
        return False
    d["guncelleme"] = iso()
    json_yaz(yol(m["id"]), d)
    return True


def gerekli_mi(m, su_an):
    """Bu maçın detay dosyası şimdi (yeniden) yazılmalı mı? (canlı maçlar ayrıca, canli_guncelle ile)"""
    bas = zaman_oku(m.get("tarih"))
    if not bas or m.get("durum_kodu") in ERTELENDI:
        return False
    var = oku(m["id"])
    if m.get("durum") == "post":
        # son 7 günde bitti ve dosyada bitmiş hâli yok → bir kez
        return su_an - bas <= SAKLA and (not var or var.get("durum") != "post")
    if m.get("durum") == "pre":
        # kadro açıklanmış olabilir ve henüz kadrolu dosya yok → (kadro gelene kadar) dene
        return timedelta(0) <= bas - su_an <= KADRO_ONCESI and not (var and var.get("kadro"))
    return False


def eksikleri_yaz(maclar, azami=150):
    """Biten (son 7 gün) ve kadrosu açıklanmış olabilecek yaklaşan maçların eksik detaylarını yazar."""
    su_an = simdi()
    yazilan = 0
    for m in maclar:
        if yazilan >= azami:
            break
        if gerekli_mi(m, su_an) and yaz(m):
            yazilan += 1
            time.sleep(0.3)
    if yazilan:
        print(f"Detay: {yazilan} maç yazıldı.")
    return yazilan


def canli_guncelle(maclar):
    """İzlenen canlı (ve az önce biten) maçların detayını günceller."""
    for m in maclar:
        if m.get("durum") == "in" or (m.get("durum") == "post" and (oku(m["id"]) or {}).get("durum") != "post"):
            yaz(m)


def eskileri_sil():
    """Maç tarihi 7 günden eski detay dosyalarını siler."""
    if not KLASOR.exists():
        return 0
    sinir = simdi() - SAKLA
    silinen = 0
    for f in KLASOR.glob("*.json"):
        bas = zaman_oku((json_oku(f) or {}).get("tarih"))
        if not bas or bas < sinir - timedelta(hours=6):
            f.unlink()
            silinen += 1
    return silinen
