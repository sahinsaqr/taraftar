"""Maç izleyicinin testleri (ağ ve Firebase gerekmez).

Sahte saat ve sahte ESPN verisiyle bir maçı baştan sona oynatır:
  - her olay doğru konu türüne (gol/mac/son/hat) ve iki takıma gider,
  - süre sınırı maç ortasında dolunca sıradaki görev canli.json'dan devam eder,
    aynı olayı tekrar göndermez ve hiçbir olayı atlamaz,
  - gidemeyen bildirim işaretlenmez, yalnız eksik parçası yeniden denenir (maç bitmiş olsa da),
  - devir: eski izleyici yenisi hazır olunca durumu devredip kapanır, yenisi kaldığı yerden sürer,
  - ESPN'in SECOND_HALF ↔ IN_PROGRESS gidip gelmesi commit üretmez,
  - FCM geçici hatada yeniden denenir, kalıcı hatada denenmez.

Çalıştırma:  python arka_plan/test_izleyici.py
"""
import os
import shutil
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bildirim  # noqa: E402
import detay  # noqa: E402
import devir  # noqa: E402
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
        self.commitler = []
        yamala(mac_izle, "git_gonder", lambda mesaj: (self.commitler.append((self.saat[0], mesaj)), False)[1])
        # devir: varsayılan olarak tetikleme yapılamaz (token yok); devir testleri kendisi yamalar
        yamala(devir, "iste", lambda: False)
        yamala(devir, "VERI", self.klasor)
        self.yamala = yamala
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
        self.metinler = []
        self.kartlar = []
        # her gönderim denemesi (olay, parça) olarak kaydedilir; self.bozuk(olay, parça) True dönerse o parça gitmez
        self.denemeler = []
        self.bozuk = lambda olay, parca: False

        def sahte_gonder(takimlar, tur, baslik, govde, mac_id, olay="", kart=None, parcalar_=None):
            istenen = parcalar_ if parcalar_ is not None else bildirim.parcalar(tur, kart)
            if parcalar_ is None:   # ilk gönderim: olay kaydı (yeniden denemeler ayrıca sayılır)
                self.gonderilen.append((olay, tur, tuple(takimlar), mac_id))
                self.metinler.append((olay, baslik, govde))
                self.kartlar.append((olay, kart))
            giden = []
            for parca in istenen:
                self.denemeler.append((olay, parca))
                if not self.bozuk(olay, parca):
                    giden.append(parca)
            return giden
        yamala(bildirim, "gonder", sahte_gonder)
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

    def test_bildirim_metinleri(self):
        self.calistir(timedelta(hours=5, minutes=30))
        m = {o: (bas, gov) for o, bas, gov in self.metinler if o != "gol"}
        goller = [(bas, gov) for o, bas, gov in self.metinler if o == "gol"]
        self.assertRegex(m["hatirlat"][0], r"^1[45] dk sonra: Ev – Dep · 20:00$")   # 17:00 UTC = 20:00 TSİ
        self.assertEqual(m["basladi"], ("Maç başladı: Ev – Dep", "Test"))
        self.assertEqual(goller, [("⚽ GOL! Ev 1–0 Dep", "1' Golcü · Ev"), ("⚽ GOL! Ev 2–0 Dep", "60' Golcü (p) · Ev")])
        self.assertEqual(m["devre"][0], "Devre arası: Ev 1–0 Dep")
        self.assertEqual(m["bitti"], ("Maç sonu: Ev 2–0 Dep", "Test"))

    def test_gol_iptal_ve_kendi_kalesine(self):
        b = mac_izle.Bildirici([])
        eski = {**mac_durumu(BASLAMA + timedelta(minutes=70))}
        yeni = {**eski, "ev_skor": 1, "dakika": "71'"}
        mac_izle.degisiklikleri_bildir(b, eski, yeni)
        self.assertIn(("iptal", "❌ Gol iptal: Ev · 71'", "Ev 1–0 Dep"), self.metinler)
        kk = {**eski, "dep_skor": 1, "dakika": "75'",
              "goller": eski["goller"] + [{"takim": "2", "dk": "75'", "oyuncu": "Savunmacı", "pen": False, "kk": True}]}
        mac_izle.degisiklikleri_bildir(b, eski, kk)
        self.assertIn(("gol", "⚽ GOL! Ev 2–1 Dep", "75' Savunmacı (k.k.) · Dep"), self.metinler)

    def test_golcu_beklenmez_sonradan_guncellenir(self):
        guncellenen = []
        self.eski.setdefault((bildirim, "guncelle"), bildirim.guncelle)
        bildirim.guncelle = lambda takimlar, tur, baslik, govde, mac_id, olay, kart: \
            guncellenen.append((baslik, govde, mac_id, kart["oyuncu"]))
        b = mac_izle.Bildirici([])
        eski = mac_durumu(BASLAMA + timedelta(minutes=70))
        adsiz = {**eski, "dep_skor": 1, "dakika": "71'"}          # ESPN skoru verdi, golcüyü henüz vermedi
        mac_izle.degisiklikleri_bildir(b, eski, adsiz)
        self.assertIn(("gol", "⚽ GOL! Ev 2–1 Dep", "71' · Dep"), self.metinler)
        mac_izle.degisiklikleri_bildir(b, adsiz, {**adsiz, "dakika": "72'"})
        self.assertEqual(guncellenen, [], "golcü yokken güncelleme gitmemeli")
        adli = {**adsiz, "dakika": "73'", "goller": eski["goller"] + [
            {"takim": "2", "dk": "70'", "oyuncu": "Forvet", "pen": False, "kk": False}]}
        mac_izle.degisiklikleri_bildir(b, adsiz, adli)
        mac_izle.degisiklikleri_bildir(b, adli, adli)
        self.assertEqual(guncellenen, [("⚽ GOL! Ev 2–1 Dep", "70' Forvet · Dep", "m1", "Forvet")], "bir kez güncellenmeli")
        self.assertEqual([o for o, *_ in self.metinler].count("gol"), 1, "güncelleme yeni gol bildirimi değil")

    def test_skor_karti_verisi(self):
        self.calistir(timedelta(hours=5, minutes=30))
        kartlar = dict(reversed([(o, k) for o, k in self.kartlar]))   # her olayın ilk kartı
        self.assertIsNone(kartlar["hatirlat"], "hatırlatma yalnız metin")
        gol = [k for o, k in self.kartlar if o == "gol"][1]          # 60' penaltı golü
        self.assertEqual((gol["ev_kisa"], gol["dep_kisa"], gol["ev_skor"], gol["dep_skor"]), ("EV", "DEP", 2, 0))
        self.assertEqual((gol["atan"], gol["dk"], gol["oyuncu"], gol["pen"], gol["kk"]), ("ev", "60'", "Golcü", "1", ""))
        self.assertEqual((kartlar["basladi"]["atan"], kartlar["bitti"]["ev_skor"]), ("", 2))
        veri = bildirim.kart_verisi("gol", "b", "g", "m1", "gol", gol)
        self.assertTrue(all(isinstance(v, str) for v in veri.values()), "FCM veri değerleri metin olmalı")
        self.assertEqual((veri["kart"], veri["kanal"]), ("1", "goller"))

    def test_dakika_ve_kisaltma(self):
        from ortak import dakika, kisaltma
        self.assertEqual([dakika(x) for x in ("90'+4'", "45'+2'", "67'", "90+4'", "")], ["90+4'", "45+2'", "67'", "90+4'", ""])
        self.assertEqual([kisaltma(i) for i in ("432", "436", "1895", "997", "7914")], ["GS", "FB", "BJK", "TS", "İBFK"])
        self.assertEqual(kisaltma("999", "XYZ"), "XYZ", "tabloda olmayan takım sağlayıcının kısaltmasıyla kalır")

    def test_her_tur_kendi_kanalina(self):
        self.assertEqual(bildirim.KANAL, {"gol": "goller", "mac": "mac_durumu", "son": "mac_sonucu", "hat": "hatirlatma_sesli"})

    def test_fcm_kosulu_iki_takimi_kapsar(self):
        self.assertEqual(self.eski[(bildirim, "gonder")].__module__, "bildirim")
        self.assertEqual(bildirim.kosul(("432", "9999"), "gol"), "'t432_gol' in topics || 't9999_gol' in topics")
        self.assertEqual(bildirim.kosul(("432", "432"), "son"), "'t432_son' in topics")

    # ------------------------------------------------ önce gönder, sonra işaretle

    def test_gidemeyen_bitis_isaretlenmez_mac_bitince_de_denenir(self):
        sayac = {"n": 0}

        def bozuk(olay, parca):
            if olay == "bitti" and parca == "sade":
                sayac["n"] += 1
                return sayac["n"] <= 2          # ilk iki deneme gitmez
            return False
        self.bozuk = bozuk
        self.calistir(timedelta(hours=5, minutes=30))
        self.assertEqual(sorted(p for o, p in self.denemeler if o == "bitti"), ["kart", "sade", "sade", "sade"],
                         "kart bir kez gitmeli, sade metin gidene kadar (3. denemede) yeniden denenmeli")
        canli = json_oku(self.klasor / "canli.json")
        self.assertIn("m1:bitti", canli["bildirilenler"])
        self.assertEqual(canli["bekleyenler"], [])

    def test_hic_gitmeyen_bildirimden_vazgecilir(self):
        self.bozuk = lambda olay, parca: olay == "gol" and parca == "sade"
        self.calistir(timedelta(hours=5, minutes=30))
        gol_sade = [1 for o, p in self.denemeler if o == "gol" and p == "sade"]
        # gol başına ~10 dk boyunca her turda (20 sn) denenir, sonra vazgeçilir; sonsuza kadar değil
        self.assertGreater(len(gol_sade), 20)
        self.assertLess(len(gol_sade), 2 * (10 * 3 + 3))
        canli = json_oku(self.klasor / "canli.json")
        self.assertEqual(canli["bekleyenler"], [])
        self.assertIn("m1:skor:2-0", canli["bildirilenler"], "vazgeçilen olay yeniden üretilmemeli")

    def test_bekleyen_bildirim_sonraki_izleyiciye_gecer(self):
        # 1. izleyici maç bittikten hemen sonra kapanır; bitiş bildirimi o sırada gidemiyor
        self.bozuk = lambda olay, parca: olay == "bitti"
        self.calistir(timedelta(minutes=131))
        canli = json_oku(self.klasor / "canli.json")
        self.assertEqual([i["anahtar"] for i in canli["bekleyenler"]], ["m1:bitti"])
        self.assertNotIn("m1:bitti", canli["bildirilenler"])
        # 2. izleyici: FCM düzeldi; bitiş bir kez gider, başka olay tekrarlanmaz
        self.bozuk = lambda olay, parca: False
        once, once_deneme = len(self.gonderilen), len(self.denemeler)
        self.saat[0] += timedelta(minutes=2)
        self.calistir(timedelta(hours=5, minutes=30))
        self.assertEqual(self.gonderilen[once:], [], "yeni olay üretilmemeli, yalnız bekleyen tamamlanmalı")
        self.assertEqual(sorted(p for o, p in self.denemeler[once_deneme:]), ["kart", "sade"],
                         "2. izleyici bitişin iki parçasını birer kez göndermeli")
        self.assertIn("m1:bitti", json_oku(self.klasor / "canli.json")["bildirilenler"])

    # ------------------------------------------------ ESPN durum gidip gelmesi

    def test_ikinci_yari_in_progress_gidip_gelmesi_commit_uretmez(self):
        cagri = {"n": 0}

        def oynak(lig, gun):
            m = mac_durumu(self.saat[0])
            cagri["n"] += 1
            if m["durum_kodu"] == "STATUS_SECOND_HALF" and cagri["n"] % 2:
                m["durum_kodu"] = "STATUS_IN_PROGRESS"
            return [m]
        self.yamala(mac_izle.espn, "gun_maclari", oynak)
        self.calistir(timedelta(hours=5, minutes=30))
        ikinci_yari = [t for t, msj in self.commitler if msj == "Canlı skor güncellendi"
                       and BASLAMA + timedelta(minutes=61) <= t < BASLAMA + timedelta(minutes=109)]
        # 48 dk'lık değişmeyen ikinci yarı: yalnız 4 dk'lık düzenli gönderimler (~12), her turda değil (~144)
        self.assertLessEqual(len(ikinci_yari), 13)
        kodlar = {m["durum_kodu"] for m in json_oku(self.klasor / "canli.json")["maclar"]}
        self.assertEqual(kodlar, {"STATUS_FULL_TIME"})
        eski = {"durum_kodu": "STATUS_SECOND_HALF", "ev_skor": 1, "dep_skor": 0}
        self.assertEqual(mac_izle.durumu_sabitle(eski, {**eski, "durum_kodu": "STATUS_IN_PROGRESS"})["durum_kodu"],
                         "STATUS_SECOND_HALF")
        self.assertEqual(mac_izle.durumu_sabitle(eski, {**eski, "durum_kodu": "STATUS_HALFTIME"})["durum_kodu"],
                         "STATUS_HALFTIME", "devre arası gibi gerçek geçişler korunmalı")

    # ------------------------------------------------ devir

    def devir_yamala(self, hazir_dk):
        """Tetikleme başarılı; yeni izleyici tetiklemeden `hazir_dk` dk sonra hazır olur."""
        durum = {"istek": None, "itiler": []}

        def iste():
            durum["istek"] = self.saat[0]
            return True

        def uzak_json(yol):
            if durum["istek"] and self.saat[0] - durum["istek"] >= timedelta(minutes=hazir_dk):
                return {"onceki": "100", "yeni": "200", "hazir": iso(self.saat[0])}
            return None
        self.yamala(devir, "iste", iste)
        self.yamala(devir, "uzak_json", uzak_json)
        self.yamala(devir, "calisma_id", lambda: "100")
        self.yamala(devir, "git_gonder", lambda mesaj: (durum["itiler"].append((self.saat[0], mesaj)), True)[1])
        return durum

    def test_devir_el_sikisarak_olur_ve_kaldigi_yerden_surer(self):
        durum = self.devir_yamala(hazir_dk=2)
        # maç 20. dakikadayken (16:40 + 40 dk) sınır; devir 15 dk önce (16:40 + 25 dk = 17:05) başlar
        self.calistir(timedelta(minutes=40))
        devir_ani = BASLAMA - timedelta(minutes=20) + timedelta(minutes=25)
        self.assertEqual(durum["istek"], devir_ani)
        self.assertEqual(len(durum["itiler"]), 1)
        cikis, mesaj = durum["itiler"][0]
        self.assertEqual(mesaj, "Devir: izleme yeni çalışmaya devredildi")
        self.assertTrue(devir_ani + timedelta(minutes=2) <= cikis < devir_ani + timedelta(minutes=3),
                        "yeni hazır olunca bir tur içinde devretmeli, sınırı beklememeli")
        d = json_oku(self.klasor / "devir.json")
        self.assertEqual((d["onceki"], d["yeni"]), ("100", "200"))
        self.assertEqual(d["ozet"], devir.ozet(self.klasor / "canli.json"), "devredilen özet canli.json'la aynı")
        self.assertEqual(d["ozet"]["bildirilen"], 3)
        ilk = [o for o, *_ in self.gonderilen]
        self.assertEqual(ilk, ["hatirlat", "basladi", "gol"])
        self.assertFalse(any("Maç sonrası" in m for _, m in self.commitler), "devreden maç sonrası güncelleme yapmaz")

        # yeni izleyici: aynı canli.json'dan devam eder, hiçbir olay tekrarlanmaz ya da atlanmaz
        self.yamala(devir, "iste", lambda: False)
        self.calistir(timedelta(hours=5, minutes=30))
        self.assertEqual([o for o, *_ in self.gonderilen][len(ilk):], ["devre", "gol", "bitti"])

    def test_devir_hazir_olmazsa_sinirda_kapanir(self):
        durum = self.devir_yamala(hazir_dk=60)
        self.calistir(timedelta(minutes=40))
        self.assertEqual(durum["itiler"], [])
        self.assertGreaterEqual(self.saat[0], BASLAMA + timedelta(minutes=20), "sınıra kadar izlemeyi sürdürmeli")
        self.assertIn("m1:skor:1-0", json_oku(self.klasor / "canli.json")["bildirilenler"])

    def test_devir_denemesi_mac_yokken_bekler_ve_devreder(self):
        json_yaz(self.klasor / "lig_x.json", {"maclar": []})
        self.yamala(mac_izle.espn, "gun_maclari", lambda lig, gun: [])
        durum = self.devir_yamala(hazir_dk=1)
        os.environ["DEVIR_TESTI_DK"] = "10"
        try:
            bas = self.saat[0]
            mac_izle.izle()
        finally:
            del os.environ["DEVIR_TESTI_DK"]
        self.assertEqual(durum["istek"], bas + timedelta(minutes=10))
        self.assertEqual([m for _, m in durum["itiler"]], ["Devir: izleme yeni çalışmaya devredildi"])
        self.assertLess(self.saat[0], bas + timedelta(minutes=12))

    def test_yeni_izleyici_devri_alir(self):
        cekildi = []
        self.yamala(devir, "calisma_id", lambda: "200")
        self.yamala(devir, "git_gonder", lambda mesaj: True)
        self.yamala(devir, "git_cek", lambda: cekildi.append(1) or True)
        json_yaz(self.klasor / "canli.json", {"guncelleme": "x", "maclar": [], "bildirilenler": ["m1:basladi"]})
        oz = devir.ozet(self.klasor / "canli.json")
        self.yamala(devir, "uzak_json", lambda yol: {"onceki": "100", "yeni": "200", "devredildi": "t", "ozet": oz})
        self.assertTrue(devir.devri_al("100"))
        self.assertEqual(cekildi, [1])
        # başka bir yeniye devredilmişse bu çalışma beklemez sayılmaz; önceki bittiyse mevcut durumla başlar
        self.yamala(devir, "uzak_json", lambda yol: {"onceki": "100", "yeni": "999", "devredildi": "t"})
        self.yamala(devir, "onceki_bitti_mi", lambda onceki: True)
        self.assertFalse(devir.devri_al("100"))

    # ------------------------------------------------ FCM yeniden deneme

    def sahte_fcm(self, hatalar):
        """firebase_admin.messaging yerine: send() sırayla `hatalar`daki istisnaları atar, sonra kimlik döner."""
        cagrilar, beklemeler = [], []
        mesajlasma = types.SimpleNamespace(
            Message=lambda **kw: kw, Notification=lambda **kw: kw,
            AndroidConfig=lambda **kw: kw, AndroidNotification=lambda **kw: kw)

        def send(mesaj):
            cagrilar.append(mesaj)
            if hatalar:
                raise hatalar.pop(0)
            return f"projects/x/messages/{len(cagrilar)}"
        mesajlasma.send = send
        paket = types.ModuleType("firebase_admin")
        paket.messaging = mesajlasma
        sys.modules["firebase_admin"] = paket
        sys.modules["firebase_admin.messaging"] = mesajlasma
        self.addCleanup(sys.modules.pop, "firebase_admin", None)
        self.addCleanup(sys.modules.pop, "firebase_admin.messaging", None)
        self.yamala(bildirim, "_baslat", lambda: True)
        self.yamala(bildirim.time, "sleep", lambda sn: beklemeler.append(sn))
        return cagrilar, beklemeler

    def fcm_hatasi(self, kod):
        h = Exception(f"{kod} hatası")
        h.code = kod
        return h

    def test_fcm_gecici_hatada_yeniden_dener(self):
        gonder = self.eski[(bildirim, "gonder")]
        cagrilar, beklemeler = self.sahte_fcm([self.fcm_hatasi("UNAVAILABLE"), OSError("ağ")])
        self.assertEqual(gonder(("1", "2"), "son", "Maç sonu", "Test", "m1", "bitti"), ["sade"])
        self.assertEqual((len(cagrilar), beklemeler), (3, [2, 5]))

    def test_fcm_kalici_hatada_denemez_ve_parca_bildirir(self):
        gonder = self.eski[(bildirim, "gonder")]
        cagrilar, beklemeler = self.sahte_fcm([self.fcm_hatasi("INVALID_ARGUMENT")])
        kart = {"ev_skor": 1, "dep_skor": 0}
        # kart önce gider ve kalıcı hatayla düşer; sade metin gider
        self.assertEqual(gonder(("1", "2"), "son", "Maç sonu", "Test", "m1", "bitti", kart=kart), ["sade"])
        self.assertEqual((len(cagrilar), beklemeler), (2, []))
        # yalnız eksik parça istenebilir
        self.assertEqual(gonder(("1", "2"), "son", "Maç sonu", "Test", "m1", "bitti", kart=kart, parcalar_=["kart"]),
                         ["kart"])
        self.assertEqual(len(cagrilar), 3)
        cagrilar, _ = self.sahte_fcm([self.fcm_hatasi("UNAVAILABLE")] * 3)
        self.assertEqual(gonder(("1",), "gol", "GOL", "x", "m1", "gol"), [], "3 denemede de gitmezse boş")
        self.assertEqual(len(cagrilar), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
