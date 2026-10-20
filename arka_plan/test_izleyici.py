"""Maç izleyicinin testleri (ağ ve Firebase gerekmez).

Sahte saat ve sahte ESPN verisiyle bir maçı baştan sona oynatır:
  - her olay doğru konu türüne (gol/mac/son/hat) ve iki takıma gider,
  - süre sınırı maç ortasında dolunca sıradaki görev canli.json'dan devam eder,
    aynı olayı tekrar göndermez ve hiçbir olayı atlamaz.

Çalıştırma:  python arka_plan/test_izleyici.py
"""
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bildirim  # noqa: E402
import detay  # noqa: E402
import mac_izle  # noqa: E402
from ortak import iso, json_oku, json_yaz  # noqa: E402

BASLAMA = datetime(2026, 10, 10, 17, 0, tzinfo=timezone.utc)


def takim(i, ad):
    return {"id": i, "ad": ad, "kisa": ad[:3].upper(), "logo": ""}


def mac_durumu(saat):
    """Başlamadan 1 dk sonra 1-0, 45'te devre, 60'ta 2-0, 110'da biter."""
    dk = (saat - BASLAMA).total_seconds() / 60
    m = {"id": "m1", "lig": "x", "tarih": iso(BASLAMA), "ev": takim("1", "Ev"), "dep": takim("2", "Dep"),
         "ev_skor": None, "dep_skor": None, "durum": "pre", "durum_kodu": "STATUS_SCHEDULED",
         "dakika": "", "goller": []}
    if dk < 0:
        return m
    m.update(durum="in", durum_kodu="STATUS_FIRST_HALF", ev_skor=0, dep_skor=0, dakika=f"{int(dk)}'")
    if dk >= 1:
        m["ev_skor"] = 1
        m["goller"] = [{"takim": "1", "dk": "1'", "oyuncu": "Golcü", "pen": False, "kk": False}]
    if 45 <= dk < 60:
        m.update(durum_kodu="STATUS_HALFTIME", dakika="DA")
    if dk >= 60:
        m.update(durum_kodu="STATUS_SECOND_HALF", ev_skor=2)
        m["goller"] = m["goller"] + [{"takim": "1", "dk": "60'", "oyuncu": "Golcü", "pen": True, "kk": False}]
    if dk >= 110:
        m.update(durum="post", durum_kodu="STATUS_FULL_TIME", dakika="MS")
    return m


class IzleyiciTesti(unittest.TestCase):
    def setUp(self):
        self.klasor = Path(tempfile.mkdtemp())
        self.saat = [BASLAMA - timedelta(minutes=20)]
        self.gonderilen = []
        self.eski = {}

        def yamala(modul, ad, deger):
            self.eski.setdefault((modul, ad), getattr(modul, ad))
            setattr(modul, ad, deger)

        yamala(mac_izle, "VERI", self.klasor)
        yamala(mac_izle, "simdi", lambda: self.saat[0])
        yamala(mac_izle, "ayarlar", lambda: {"ligler": [{"kod": "x", "ad": "Test"}]})
        yamala(mac_izle, "git_gonder", lambda mesaj: False)
        yamala(mac_izle.time, "sleep", lambda sn: self.saat.__setitem__(0, self.saat[0] + timedelta(seconds=sn)))
        yamala(mac_izle.veri_guncelle, "guncelle", lambda mod: True)
        yamala(mac_izle.espn, "gun_maclari", lambda lig, gun: [mac_durumu(self.saat[0])])
        yamala(mac_izle, "takip_edilenler", lambda: set())
        # maç detayı: ağ yok, geçici klasör; her istek kaydedilir
        self.detay_istekleri = []

        def sahte_detay(lig, mac_id):
            m = mac_durumu(self.saat[0])
            self.detay_istekleri.append((m["durum"], m["dakika"]))
            return {**m, "olaylar": [], "istatistik": [], "kadro": {}}
        yamala(detay, "KLASOR", self.klasor / "detay")
        yamala(detay, "simdi", lambda: self.saat[0])
        yamala(detay.espn, "mac_detayi", sahte_detay)
        yamala(bildirim, "gonder", lambda takimlar, tur, baslik, govde, mac_id, olay="":
               self.gonderilen.append((olay, tur, tuple(takimlar), mac_id)))
        json_yaz(self.klasor / "lig_x.json", {"maclar": [mac_durumu(self.saat[0])]})

    def tearDown(self):
        for (modul, ad), deger in self.eski.items():
            setattr(modul, ad, deger)
        shutil.rmtree(self.klasor, ignore_errors=True)

    def calistir(self, sure):
        self.eski.setdefault((mac_izle, "AZAMI_SURE"), mac_izle.AZAMI_SURE)
        mac_izle.AZAMI_SURE = sure
        mac_izle.izle()

    def test_olaylar_dogru_konulara_bir_kez_gider(self):
        self.calistir(timedelta(hours=5, minutes=30))
        olaylar = [(o, t) for o, t, _, _ in self.gonderilen]
        self.assertEqual(olaylar, [("hatirlat", "hat"), ("basladi", "mac"), ("gol", "gol"),
                                   ("devre", "mac"), ("gol", "gol"), ("bitti", "son")])
        self.assertTrue(all(tk == ("1", "2") and mid == "m1" for _, _, tk, mid in self.gonderilen))

    def test_sure_dolunca_kaldigi_yerden_devam(self):
        # 1. görev: 17:00'deki maçı 16:40'ta başlar, 40 dk sonra (maç 20. dakikadayken) süresi dolar
        self.calistir(timedelta(minutes=40))
        ilk = [o for o, *_ in self.gonderilen]
        self.assertEqual(ilk, ["hatirlat", "basladi", "gol"])
        self.assertLess(self.saat[0], BASLAMA + timedelta(minutes=45), "devreden önce bitmeliydi")

        # 2. görev: birkaç dakika sonra zamanlanmış görev başlar
        self.saat[0] += timedelta(minutes=7)
        self.calistir(timedelta(hours=5, minutes=30))
        ikinci = [o for o, *_ in self.gonderilen][len(ilk):]
        self.assertEqual(ikinci, ["devre", "gol", "bitti"], "tekrar ya da eksik bildirim var")

    def test_detay_canliyken_guncellenir_bitince_bir_kez_yazilir(self):
        self.calistir(timedelta(hours=5, minutes=30))
        canli = [i for i in self.detay_istekleri if i[0] == "in"]
        biten = [i for i in self.detay_istekleri if i[0] == "post"]
        self.assertGreater(len(canli), 5, "canlı maç detayı gönderimlerde güncellenmeli")
        self.assertEqual(len(biten), 1, "biten maç detayı bir kez yazılmalı")
        self.assertEqual(json_oku(self.klasor / "detay" / "m1.json")["durum"], "post")
        # sonraki görev aynı biten maç için tekrar istek atmaz
        once = len(self.detay_istekleri)
        detay.eksikleri_yaz([mac_durumu(self.saat[0])])
        self.assertEqual(len(self.detay_istekleri), once)

    def test_fcm_kosulu_iki_takimi_kapsar(self):
        self.assertEqual(self.eski[(bildirim, "gonder")].__module__, "bildirim")
        self.assertEqual(bildirim.kosul(("432", "9999"), "gol"), "'t432_gol' in topics || 't9999_gol' in topics")
        self.assertEqual(bildirim.kosul(("432", "432"), "son"), "'t432_son' in topics")


if __name__ == "__main__":
    unittest.main(verbosity=2)
