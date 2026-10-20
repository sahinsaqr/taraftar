"""Fikstür, sonuçlar, puan durumu ve takım listelerini günceller.

İki çalışma biçimi var:
  tam   : sezonun tamamını ve takım listelerini çeker (günde bir kez yeterli)
  hizli : sadece son 3 ve önümüzdeki 10 günün maçlarını + puan durumunu çeker

Kullanım:  python arka_plan/veri_guncelle.py [tam|hizli|otomatik]
"""
import sys
import time
from datetime import timedelta

import espn
from ortak import VERI, ayarlar, iso, json_oku, json_yaz, simdi, zaman_oku

TAM_ARALIK = 20 * 3600       # tam güncelleme en az bu kadar saniyede bir
HIZLI_ARALIK = 3 * 3600      # hızlı güncelleme en az bu kadar saniyede bir


class GuncellemeHatasi(Exception):
    """Hiçbir lig güncellenemediğinde atılır."""


def lig_dosyasi(kod):
    return VERI / f"lig_{kod}.json"


def lig_guncelle(lig, tam):
    kod = lig["kod"]
    eski = json_oku(lig_dosyasi(kod), {}) or {}
    maclar = {m["id"]: m for m in eski.get("maclar", [])}

    if tam:
        yeni = espn.sezon_maclari(kod, geri_gun=150, ileri_gun=240)
    else:
        yeni = espn.sezon_maclari(kod, geri_gun=3, ileri_gun=10)
    maclar.update(yeni)

    # Çok eski maçları at (dosya büyümesin)
    sinir = simdi() - timedelta(days=200)
    maclar = {i: m for i, m in maclar.items()
              if (zaman_oku(m.get("tarih")) or simdi()) >= sinir}

    try:
        tablolar = espn.puan_durumu(kod)
    except espn.VeriHatasi as h:
        print(f"  puan durumu alınamadı: {h}")
        tablolar = eski.get("tablolar", [])

    json_yaz(lig_dosyasi(kod), {
        "kod": kod,
        "ad": lig["ad"],
        "guncelleme": iso(),
        "maclar": sorted(maclar.values(), key=lambda m: m.get("tarih") or ""),
        "tablolar": tablolar,
    })
    return maclar, tablolar


def takim_listesi(lig, maclar, tablolar, eski_takimlar, tam):
    takimlar = {t["id"]: t for t in eski_takimlar}
    if tam or not takimlar:
        try:
            for t in espn.lig_takimlari(lig["kod"]):
                takimlar[t["id"]] = t
        except espn.VeriHatasi as h:
            print(f"  takım listesi alınamadı: {h}")
    # Maçlardan ve tablodan gelen takımları da ekle (eksik kalmasın)
    for m in maclar.values():
        for t in (m["ev"], m["dep"]):
            kayit = takimlar.setdefault(t["id"], dict(t))
            # takım listesi yalnız tam güncellemede yenilenir; kulüp renkleri eksikse maçtan tamamla
            for alan in ("renk", "renk2"):
                if t.get(alan) and not kayit.get(alan):
                    kayit[alan] = t[alan]
    for tablo in tablolar:
        for s in tablo["satirlar"]:
            takimlar.setdefault(s["takim"]["id"], dict(s["takim"]))
    return sorted((t for t in takimlar.values() if t.get("id")),
                  key=lambda t: t["ad"].lower())


def guncelle(mod="otomatik"):
    durum = json_oku(VERI / "durum.json", {}) or {}
    son_tam = zaman_oku(durum.get("son_tam"))
    son_hizli = zaman_oku(durum.get("son_hizli"))
    su_an = simdi()

    if mod == "otomatik":
        if not son_tam or (su_an - son_tam).total_seconds() > TAM_ARALIK:
            mod = "tam"
        elif not son_hizli or (su_an - son_hizli).total_seconds() > HIZLI_ARALIK:
            mod = "hizli"
        else:
            print("Veriler güncel, güncelleme gerekmiyor.")
            return False

    tam = mod == "tam"
    print(f"Veri güncelleme başlıyor ({mod})")
    eski_ligler = {l["kod"]: l for l in (json_oku(VERI / "ligler.json", {}) or {}).get("ligler", [])}
    ligler = []
    basarili = 0
    for lig in ayarlar()["ligler"]:
        print(f"- {lig['ad']} ({lig['kod']})")
        try:
            maclar, tablolar = lig_guncelle(lig, tam)
        except espn.VeriHatasi as h:
            print(f"  atlandı: {h}")
            if lig["kod"] in eski_ligler:
                ligler.append(eski_ligler[lig["kod"]])
            continue
        basarili += 1
        eski_takimlar = eski_ligler.get(lig["kod"], {}).get("takimlar", [])
        ligler.append({
            **lig,
            "takimlar": takim_listesi(lig, maclar, tablolar, eski_takimlar, tam),
        })
        print(f"  {len(maclar)} maç, {sum(len(t['satirlar']) for t in tablolar)} tablo satırı")
        time.sleep(0.5)

    if not basarili:
        # durum.json'a yazma: sonraki çalışma güncellemeyi yeniden denesin
        raise GuncellemeHatasi("Hiçbir lig güncellenemedi")

    json_yaz(VERI / "ligler.json", {"guncelleme": iso(), "ligler": ligler})
    durum["son_hizli"] = iso()
    if tam:
        durum["son_tam"] = iso()
    json_yaz(VERI / "durum.json", durum)
    return True


if __name__ == "__main__":
    try:
        guncelle(sys.argv[1] if len(sys.argv) > 1 else "otomatik")
    except GuncellemeHatasi as h:
        print(f"HATA: {h}")
        sys.exit(1)
