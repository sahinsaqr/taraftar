"""Maç detayının testleri (ağ gerekmez).

test_veri/espn_ozet_*.json: gerçek ESPN summary yanıtlarından küçültülmüş örnekler (20-21 Ekim 2026).
  - ayrıştırma: olay türleri, taraf, asist, değişiklikte giren/çıkan, istatistik, kadro, diziliş
  - kapsam: canlı/biten/yaklaşan maç için ne zaman istek atılır, 7 günden eskiler silinir

Çalıştırma:  python arka_plan/test_detay.py
"""
import json
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import detay  # noqa: E402
import espn  # noqa: E402
from ortak import iso, json_oku, json_yaz  # noqa: E402

ORNEK = Path(__file__).resolve().parent / "test_veri"


def ornek(ad, lig="uefa.champions"):
    with open(ORNEK / f"espn_ozet_{ad}.json", encoding="utf-8") as f:
        return espn.detay_sadele(json.load(f), lig)


class AyristirmaTesti(unittest.TestCase):
    def test_fenerbahce_slavia(self):
        d = ornek("fenerbahce_slavia")
        self.assertEqual((d["id"], d["durum"], d["ev_skor"], d["dep_skor"]), ("401915403", "post", 2, 2))
        self.assertEqual((d["ev"]["ad"], d["dep"]["ad"]), ("Fenerbahçe", "Slavia Prague"))
        self.assertIsNone(d["ev_penalti"], "penaltı atışı yoksa skor yazılmaz")
        self.assertEqual(d["stat"], "Şükrü Saracoğlu Stadium")
        goller = [(o["dk"], o["taraf"], o["oyuncu"], o["asist"]) for o in d["olaylar"] if o["tur"] == "gol"]
        self.assertEqual(goller, [("4'", "ev", "Oguz Aydin", "Milan Skriniar"),
                                  ("11'", "ev", "Mason Greenwood", "Nélson Semedo"),
                                  ("15'", "dep", "Lukás Provod", ""),
                                  ("90'", "dep", "Pavel Kacor", "Emmanuel Dennis Ayaosi")])
        ilk_degisiklik = next(o for o in d["olaylar"] if o["tur"] == "degisiklik")
        self.assertEqual((ilk_degisiklik["giren"], ilk_degisiklik["cikan"]), ("Kojo Peprah Oppong", "Nathan Aké"))
        self.assertEqual(sum(o["tur"] == "sari" for o in d["olaylar"]), 4)
        self.assertEqual([o["metin"] for o in d["olaylar"] if o["tur"] == "ayrac"], ["Devre arası", "Maç sonu"])
        self.assertFalse(any(o.get("tur") is None for o in d["olaylar"]), "başlama/gecikme olayları atılmalı")
        self.assertEqual([s["ad"] for s in d["istatistik"]],
                         ["topa_sahip", "sut", "isabetli_sut", "korner", "faul", "ofsayt", "sari_kart", "kirmizi_kart"])
        self.assertEqual(int(d["istatistik"][0]["ev"]) + int(d["istatistik"][0]["dep"]), 100)
        self.assertEqual(d["kadro"]["ev"]["dizilis"], "4-2-3-1")
        self.assertEqual(d["kadro"]["dep"]["dizilis"], "3-4-2-1")
        self.assertEqual(len(d["kadro"]["ev"]["ilk11"]), 11)
        self.assertEqual(d["kadro"]["ev"]["ilk11"][0]["poz"], "KL")
        self.assertTrue(all(o["poz"] in ("KL", "DF", "OS", "FV") for o in d["kadro"]["ev"]["ilk11"]))
        self.assertTrue(d["kadro"]["ev"]["yedek"])

    def test_kendi_kalesine_golden_yararlanan_takima_yazilir(self):
        d = ornek("kendi_kalesine", "eng.1")
        kk = [o for o in d["olaylar"] if o["tur"] == "kk"]
        self.assertEqual(len(kk), 1)
        self.assertEqual((kk[0]["taraf"], kk[0]["oyuncu"]), ("ev", "Jaydee Canvot"))   # Brighton'a yazıldı

    def test_penalti_ve_kirmizi_kart(self):
        p = ornek("penalti", "eng.1")
        pen = [o for o in p["olaylar"] if o["tur"] == "penalti"]
        self.assertEqual((pen[0]["oyuncu"], pen[0]["taraf"]), ("Zian Flemming", "dep"))
        self.assertNotIn("asist", pen[0])
        k = ornek("kirmizi_kart", "eng.1")
        self.assertTrue(any(o["tur"] == "kirmizi" for o in k["olaylar"]))

    def test_mevki(self):
        self.assertEqual([espn._mevki(x) for x in ("G", "CD-L", "LB", "DM", "AM-R", "CF", "LW", "SUB", "")],
                         ["KL", "DF", "DF", "OS", "OS", "FV", "FV", "", ""])


class KapsamTesti(unittest.TestCase):
    def setUp(self):
        self.klasor = Path(tempfile.mkdtemp())
        self.su_an = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
        self.istekler = []
        self.eski = {"KLASOR": detay.KLASOR, "simdi": detay.simdi, "mac_detayi": espn.mac_detayi}
        detay.KLASOR = self.klasor
        detay.simdi = lambda: self.su_an

        def sahte(lig, mac_id):
            self.istekler.append(mac_id)
            m = self.maclar[mac_id]
            return {**m, "kadro": self.kadro.get(mac_id, {})}
        espn.mac_detayi = sahte
        self.kadro = {}

    def tearDown(self):
        detay.KLASOR = self.eski["KLASOR"]
        detay.simdi = self.eski["simdi"]
        espn.mac_detayi = self.eski["mac_detayi"]
        shutil.rmtree(self.klasor, ignore_errors=True)

    def mac(self, i, durum, saat_once):
        return {"id": i, "lig": "x", "durum": durum, "durum_kodu": "", "tarih": iso(self.su_an - timedelta(hours=saat_once))}

    def test_biten_bir_kez_eski_hic_yaklasan_kadroya_kadar(self):
        self.maclar = {m["id"]: m for m in [
            self.mac("dun", "post", 24),        # son 7 gün: bir kez
            self.mac("eski", "post", 24 * 9),   # 7 günden eski: hiç
            self.mac("yakin", "pre", -0.5),     # 30 dk sonra: kadro gelene kadar
            self.mac("uzak", "pre", -5),        # 5 saat sonra: henüz değil
        ]}
        detay.eksikleri_yaz(list(self.maclar.values()))
        self.assertEqual(sorted(self.istekler), ["dun", "yakin"])
        detay.eksikleri_yaz(list(self.maclar.values()))      # kadro henüz yok → yalnız "yakin" tekrar
        self.assertEqual(sorted(self.istekler), ["dun", "yakin", "yakin"])
        self.kadro["yakin"] = {"ev": {"dizilis": "4-4-2", "ilk11": [], "yedek": []}}
        detay.eksikleri_yaz(list(self.maclar.values()))      # kadro geldi → yazıldı (3. istek)
        detay.eksikleri_yaz(list(self.maclar.values()))      # artık istek yok
        self.assertEqual(self.istekler.count("yakin"), 3)
        self.assertEqual(self.istekler.count("dun"), 1)

    def test_canli_her_seferinde_biten_bir_kez_ve_eskiler_silinir(self):
        self.maclar = {"c": self.mac("c", "in", 1)}
        detay.canli_guncelle([self.maclar["c"]])
        detay.canli_guncelle([self.maclar["c"]])
        self.assertEqual(self.istekler, ["c", "c"])
        self.maclar["c"] = {**self.maclar["c"], "durum": "post"}
        detay.canli_guncelle([self.maclar["c"]])
        detay.canli_guncelle([self.maclar["c"]])
        self.assertEqual(self.istekler, ["c", "c", "c"], "biten maç için bir kez")
        json_yaz(self.klasor / "eski.json", {"tarih": iso(self.su_an - timedelta(days=8))})
        self.assertEqual(detay.eskileri_sil(), 1)
        self.assertTrue((self.klasor / "c.json").exists())
        self.assertEqual(json_oku(self.klasor / "c.json")["durum"], "post")


if __name__ == "__main__":
    unittest.main(verbosity=2)
