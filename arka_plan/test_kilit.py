"""İzleyici kilidinin testleri (kilit.py).

  - yarış: iki izleyici aynı anda kilidi almaya çalışır; gerçek git (geçici bare depo + iki klon) ile
    push'u önce kabul edilen kazanır, diğeri reddedilir ve kaybeder,
  - ilgisiz bir commit yüzünden reddedilen push yeniden kurulur, o commit ezilmez,
  - devir sahipliği yeni çalışmaya geçirir; sahip olmayan devredemez, eski sahip bende_mi'de kaybeder,
  - GitHub API'ye ulaşılamazsa ~2 dk yeniden denenir; hâlâ ulaşılamıyorsa kilit ancak 6 saatten eskiyse alınır,
  - izleyici kilit başkasındayken hiç bildirim göndermez, kilidi kaybedince göndermeyi bırakır.

Çalıştırma:  python arka_plan/test_kilit.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import devir  # noqa: E402
import kilit  # noqa: E402
import ortak  # noqa: E402
from ortak import iso, simdi  # noqa: E402


def git(kok, *args):
    r = subprocess.run(["git", *args], cwd=kok, capture_output=True, text=True)
    assert r.returncode == 0, f"git {' '.join(args)}: {r.stderr}"
    return r.stdout.strip()


class Yama(unittest.TestCase):
    def setUp(self):
        self.eski = {}
        self.eski_ortam = os.environ.get("GITHUB_ACTIONS")
        os.environ["GITHUB_ACTIONS"] = "true"

    def yamala(self, modul, ad, deger):
        self.eski.setdefault((modul, ad), getattr(modul, ad))
        setattr(modul, ad, deger)

    def tearDown(self):
        for (modul, ad), deger in self.eski.items():
            setattr(modul, ad, deger)
        if self.eski_ortam is None:
            os.environ.pop("GITHUB_ACTIONS", None)
        else:
            os.environ["GITHUB_ACTIONS"] = self.eski_ortam


class GitKilitTesti(Yama):
    """Gerçek git: bare depo (GitHub yerine) ve iki izleyicinin klonları."""

    def setUp(self):
        super().setUp()
        self.klasor = Path(tempfile.mkdtemp())
        self.uzak = self.klasor / "uzak.git"
        git(self.klasor, "init", "-q", "--bare", "-b", "main", str(self.uzak))
        self.a = self.klon("a", ilk=True)
        self.b = self.klon("b")
        # sahibin durumu: GitHub API yerine
        self.surenler = set()
        self.yamala(kilit, "sahip_durumu", lambda sahip: "suruyor" if sahip in self.surenler else "bitti")
        self.yamala(kilit.time, "sleep", lambda sn: None)

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.klasor, ignore_errors=True)

    def klon(self, ad, ilk=False):
        kok = self.klasor / ad
        git(self.klasor, "clone", "-q", str(self.uzak), str(kok))
        git(kok, "config", "user.name", "test")
        git(kok, "config", "user.email", "test@example.com")
        if ilk:
            (kok / "veri").mkdir()
            (kok / "veri" / "canli.json").write_text('{"bildirilenler":[]}', encoding="utf-8")
            git(kok, "add", "veri")
            git(kok, "commit", "-q", "-m", "ilk")
            git(kok, "push", "-q", "-u", "origin", "main")
        else:
            git(kok, "branch", "-q", "--set-upstream-to=origin/main", "main")
        return kok

    def uzaktaki(self, yol):
        r = subprocess.run(["git", "show", f"main:{yol}"], cwd=self.uzak, capture_output=True, text=True)
        return json.loads(r.stdout) if r.returncode == 0 else None

    def test_ilk_kilidi_alir_ve_yerel_kopyaya_gelir(self):
        self.assertTrue(kilit.al("A", self.a))
        self.assertEqual(self.uzaktaki(kilit.DOSYA)["sahip"], "A")
        self.assertEqual(json.loads((self.a / kilit.DOSYA).read_text(encoding="utf-8"))["sahip"], "A")
        self.assertTrue(kilit.al("A", self.a), "zaten bende: yeni commit yok")
        self.assertEqual(git(self.uzak, "rev-list", "--count", "main"), "2")

    def test_yaris_yalniz_biri_kazanir(self):
        """B kilidi boş okur ve alınabilir der; o sırada A kilidi alıp push eder. B'nin push'u reddedilir,
        B kilidi yeniden okur, A'yı (çalışıyor) görür ve kaybeder."""
        self.surenler = {"A", "B"}
        gercek = kilit.alinabilir_mi
        araya = {"girdi": False}

        def b_karar(kilit_, ben):
            sonuc = gercek(kilit_, ben)
            if ben == "B" and not araya["girdi"]:
                araya["girdi"] = True
                self.assertTrue(kilit.al("A", self.a))   # A, B'nin okuması ile push'u arasında kazanır
            return sonuc
        self.yamala(kilit, "alinabilir_mi", b_karar)

        self.assertFalse(kilit.al("B", self.b), "B, A'nın kilidini görüp kaybetmeli")
        self.assertEqual(self.uzaktaki(kilit.DOSYA)["sahip"], "A", "A'nın kilidi ezilmemeli")
        self.assertTrue(kilit.bende_mi("A", self.a))
        self.assertFalse(kilit.bende_mi("B", self.b))

    def test_iki_izleyici_ayni_uctan_push_eder_biri_reddedilir(self):
        """Doğrudan karşılaştır-ve-değiştir: ikisi de aynı uç üstüne kurar, yalnız ilk push kabul edilir."""
        uc_a, _ = kilit._uc_ve_kilit(self.a)
        uc_b, _ = kilit._uc_ve_kilit(self.b)
        self.assertEqual(uc_a, uc_b)
        self.assertTrue(kilit._cas_gonder(self.a, uc_a, {kilit.DOSYA: '{"sahip":"A"}'}, "A"))
        self.assertFalse(kilit._cas_gonder(self.b, uc_b, {kilit.DOSYA: '{"sahip":"B"}'}, "B"))
        self.assertEqual(self.uzaktaki(kilit.DOSYA)["sahip"], "A")

    def test_ilgisiz_commit_reddi_yeniden_kurulur_ve_ezilmez(self):
        gercek = kilit.alinabilir_mi
        araya = {"girdi": False}

        def b_karar(kilit_, ben):
            if not araya["girdi"]:
                araya["girdi"] = True   # A ilgisiz bir veri commit'i gönderir (ör. canlı skor)
                (self.a / "veri" / "canli.json").write_text('{"bildirilenler":["m1:basladi"]}', encoding="utf-8")
                git(self.a, "commit", "-qam", "Canlı skor güncellendi")
                git(self.a, "push", "-q")
            return gercek(kilit_, ben)
        self.yamala(kilit, "alinabilir_mi", b_karar)

        self.assertTrue(kilit.al("B", self.b))
        self.assertEqual(self.uzaktaki(kilit.DOSYA)["sahip"], "B")
        self.assertEqual(self.uzaktaki("veri/canli.json"), {"bildirilenler": ["m1:basladi"]}, "ilgisiz commit korunmalı")

    def test_bitmis_sahipten_alinir_yasayandan_alinmaz(self):
        self.surenler = {"A"}
        self.assertTrue(kilit.al("A", self.a))
        self.assertFalse(kilit.al("B", self.b))
        self.surenler = set()   # A bitti
        self.assertTrue(kilit.al("B", self.b))
        self.assertEqual(self.uzaktaki(kilit.DOSYA)["onceki"], "A")
        self.assertFalse(kilit.bende_mi("A", self.a), "eski sahip bir sonraki turda kaybettiğini görür")

    def test_devir_sahipligi_yeniye_gecirir_sahip_olmayan_devredemez(self):
        self.surenler = {"A", "B", "C"}
        self.assertTrue(kilit.al("A", self.a))
        (self.a / "veri" / "canli.json").write_text('{"bildirilenler":["son"]}', encoding="utf-8")
        canli = (self.a / "veri" / "canli.json").read_text(encoding="utf-8")
        self.assertFalse(kilit.devret("C", {"veri/canli.json": "{}"}, "Devir", "B", self.b), "B sahip değil")
        self.assertTrue(kilit.devret("C", {"veri/canli.json": canli, "veri/devir.json": '{"yeni":"C"}'}, "Devir",
                                     "A", self.a))
        self.assertEqual(self.uzaktaki(kilit.DOSYA)["sahip"], "C")
        self.assertEqual(self.uzaktaki("veri/canli.json"), {"bildirilenler": ["son"]}, "durum aynı commit'te")
        self.assertEqual(self.uzaktaki("veri/devir.json"), {"yeni": "C"})
        self.assertFalse(kilit.bende_mi("A", self.a))
        self.assertTrue(kilit.al("C", self.b), "yeni sahip kilidi zaten elinde bulur")
        self.assertFalse(kilit.devret("D", {}, "Devir", "A", self.a), "devreden ikinci kez devredemez")


class ApiTesti(Yama):
    """GitHub API'ye ulaşılamazsa: ~2 dk yeniden deneme, sonra yalnız 6 saatten eski kilit alınır."""

    def setUp(self):
        super().setUp()
        self.beklemeler = []
        self.yanitlar = []      # sırayla (kod, veri); bitince hep (0, None) = ulaşılamadı
        self.istekler = []

        def api(yontem, yol, govde=None):
            self.istekler.append(yol)
            return self.yanitlar.pop(0) if self.yanitlar else (0, None)
        self.yamala(devir, "_api", api)
        self.yamala(kilit.time, "sleep", lambda sn: self.beklemeler.append(sn))

    def kilit_(self, saat_once):
        return {"sahip": "100", "alindi": iso(simdi() - timedelta(hours=saat_once))}

    def test_api_yoksa_yeniden_dener_eski_kilidi_alir(self):
        self.assertTrue(kilit.alinabilir_mi(self.kilit_(7), "200"))
        self.assertEqual(len(self.istekler), len(kilit.API_BEKLE) + 1)
        self.assertEqual(self.beklemeler, list(kilit.API_BEKLE))
        self.assertTrue(60 <= sum(self.beklemeler) <= 150, "1-2 dk boyunca yeniden denenmeli")

    def test_api_yoksa_yeni_kilidi_almaz(self):
        self.assertFalse(kilit.alinabilir_mi(self.kilit_(1), "200"))
        self.assertFalse(kilit.alinabilir_mi(self.kilit_(5.9), "200"), "6 saat dolmadan alınmaz")
        self.assertFalse(kilit.alinabilir_mi({"sahip": "100"}, "200"), "zamanı olmayan kilit eski sayılmaz")

    def test_api_sonradan_yanit_verirse_ona_uyulur(self):
        self.yanitlar = [(0, None), (502, None), (200, {"status": "completed"})]
        self.assertTrue(kilit.alinabilir_mi(self.kilit_(1), "200"))
        self.assertEqual(self.beklemeler, list(kilit.API_BEKLE[:2]))
        self.yanitlar, self.beklemeler = [(0, None), (200, {"status": "in_progress"})], []
        self.assertFalse(kilit.alinabilir_mi(self.kilit_(7), "200"), "API 'sürüyor' derse kilit eski olsa da alınmaz")
        self.assertEqual(self.beklemeler, [kilit.API_BEKLE[0]])

    def test_bos_ya_da_kendi_kilidi_api_sormaz(self):
        self.assertTrue(kilit.alinabilir_mi({}, "200"))
        self.assertTrue(kilit.alinabilir_mi({"sahip": "200"}, "200"))
        self.assertEqual(self.istekler, [])

    def test_yerelde_kilit_yok(self):
        os.environ.pop("GITHUB_ACTIONS")
        self.assertTrue(kilit.al("1"))
        self.assertTrue(kilit.bende_mi("1"))
        self.assertEqual(self.istekler, [])


class IzleyiciKilitTesti(unittest.TestCase):
    """mac_izle.izle(): kilit başkasındaysa hiç göndermez; kaybedince bırakır."""

    def setUp(self):
        import test_izleyici
        self.t = test_izleyici.IzleyiciTesti("test_olaylar_dogru_konulara_bir_kez_gider")
        self.t.setUp()
        self.addCleanup(self.t.tearDown)
        self.mac_izle = test_izleyici.mac_izle

    def test_kilit_baskasindaysa_hic_gondermez(self):
        self.t.yamala(self.mac_izle.kilit, "al", lambda: False)
        self.t.calistir(timedelta(hours=5, minutes=30))
        self.assertEqual(self.t.gonderilen, [])
        self.assertEqual(self.t.commitler, [], "kaybeden izleyici durum da yazmaz")

    def test_kilidi_kaybedince_gondermeyi_birakir(self):
        bas = self.t.saat[0]
        self.t.yamala(self.mac_izle.kilit, "al", lambda: True)
        # maç 30. dakikadayken kilit başka izleyiciye geçer
        self.t.yamala(self.mac_izle.kilit, "bende_mi", lambda: self.t.saat[0] < bas + timedelta(minutes=50))
        self.t.calistir(timedelta(hours=5, minutes=30))
        self.assertEqual([o for o, *_ in self.t.gonderilen], ["hatirlat", "basladi", "gol"])
        self.assertLess(self.t.saat[0], bas + timedelta(minutes=52))


if __name__ == "__main__":
    unittest.main()
