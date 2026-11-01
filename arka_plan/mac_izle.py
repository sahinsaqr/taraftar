"""Zamanlanmış görevin ana programı.

1. Verileri gerekiyorsa günceller (fikstür, sonuçlar, puan durumu).
2. ayarlar.json'daki liglerin yakında başlayacak ya da oynanmakta olan maçı
   varsa maçlar bitene kadar skoru kontrol eder (oynanan maç varken 20 sn'de, yoksa dakikada bir)
   ve her olayı görür görmez iki takımın FCM konusuna gönderir (bildirim.py); commit/push beklenmez. Maç yoksa kapanır; sıradaki
   maç 4 saat içindeyse kapanmadan onu bekler (zamanlanmış görev seyrek tetikleniyor).
   Sunucu kimin neyi takip ettiğini bilmez; bu yüzden tüm maçlar izlenir.
3. Maç detaylarını (olaylar, istatistik, kadrolar) veri/detay/ altına yazar (detay.py):
   canlı maçlar her gönderimde, biten maçlar bir kez, kadrolar açıklanınca bir kez.

Bildirim önce gönderilir, "gönderildi" işareti ancak başarılı olunca konur. Gidemeyen bildirim
(sade metin ya da skor kartı parçası) bekleyenler kuyruğunda her turda yeniden denenir; maç izlemeden
çıkmış olsa da (ör. bitiş). Kuyruk canli.json'da saklanır, sonraki izleyici devam eder.

5,5 saat sınırından 15 dk önce izlenecek maç varsa izleyici kendi yerine yeni bir çalışma başlatır ve
yenisi hazır olunca durumu devredip kapanır (devir.py). Devir olmazsa sınır dolunca görev biter;
durum canli.json'da saklandığı için sıradaki görev kaldığı yerden devam eder, aynı olayı tekrar
bildirmez.

Ortam değişkenleri:
  FIREBASE_HESAP    : FCM servis hesabı (base64), bkz. bildirim.py
  NTFY_KONU         : isteğe bağlı ntfy konusu; takip.json'daki takımlar için
  UYGULAMA_ADRESI   : ntfy bildirimine tıklayınca açılacak adres (isteğe bağlı)
  KONTROL_ARALIGI   : maç başlamadan kaç saniyede bir kontrol (varsayılan 60)
  KONTROL_CANLI     : oynanan maç varken kaç saniyede bir kontrol (varsayılan 20)
  SADECE_VERI       : "1" ise yalnız veri güncellenir, izlenmez (başka izleyici çalışırken elle güncelleme)
  DEVIR_ONCEKI, DEVIR_TESTI_DK, GH_TOKEN : devir için, bkz. devir.py
"""
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import timedelta

import bildirim
import detay
import devir
import espn
import veri_guncelle
from ortak import (VERI, ayarlar, git_gonder, iso, json_oku, json_yaz, simdi,
                   takip_edilenler, zaman_oku)

ILERI_BAK = timedelta(minutes=80)       # bu süre içinde başlayacak maçları bekle
# GitHub zamanlanmış görevi 30 dk'da bir değil, çoğu zaman 3-5 saatte bir başlatıyor.
# Sıradaki maç bu süre içindeyse görev kapanmaz, bekler; beklerken veriyi de yeniler.
BOSTA_BEKLE = timedelta(hours=4)
HATIRLATMA = timedelta(minutes=15)      # maçtan bu kadar önce hatırlat
AZAMI_SURE = timedelta(hours=5, minutes=30)   # GitHub sınırı 6 saat
KONTROL = int(os.environ.get("KONTROL_ARALIGI", "60"))
# Oynanan maç varken: ESPN golü ~1 dk içinde gösteriyor; 60 sn aralık buna ortalama 30 sn daha ekliyordu.
# Lig+gün başına bir istek: 20 sn'de saatte 180 istek (canlı detaylar 4 dk'da bir, değişmez).
KONTROL_CANLI = int(os.environ.get("KONTROL_CANLI", "20"))
GONDERIM_ARALIGI = timedelta(minutes=4)  # skor değişmese de canlı dakikayı güncelle
# Gidemeyen bildirimden bu kadar sonra vazgeçilir (hatırlatmadaki "N dk sonra" çabuk bayatlar)
VAZGEC = {"gol": timedelta(minutes=10), "hat": timedelta(minutes=3)}
VAZGEC_DIGER = timedelta(minutes=30)

BITTI = {"STATUS_FULL_TIME", "STATUS_FINAL", "STATUS_FINAL_AET", "STATUS_FINAL_PEN",
         "STATUS_END_OF_EXTRATIME"}
# ESPN oynanan maçta FIRST/SECOND_HALF ile IN_PROGRESS arasında gidip geliyor: hepsi aynı durum sayılır
OYNANIYOR = {"STATUS_FIRST_HALF", "STATUS_SECOND_HALF", "STATUS_IN_PROGRESS"}
ERTELENDI = {"STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_ABANDONED",
             "STATUS_SUSPENDED", "STATUS_DELAYED", "STATUS_FORFEIT"}


# ------------------------------------------------------------ bildirim

def logo_adresi(url, px=120):
    """ESPN logosu → küçültülmüş PNG (skor kartı için)."""
    if url.startswith("https://a.espncdn.com/i/"):
        return f"https://a.espncdn.com/combiner/i?img={url[len('https://a.espncdn.com'):]}&w={px}&h={px}"
    return url


def kart_bilgisi(m, ayrinti=None):
    """Skor kartı bildiriminin verisi: takımlar, skor ve (golde) dakika/oyuncu/atan taraf."""
    a = ayrinti or {}
    kart = {"lig": lig_adi(m), "ev_skor": m.get("ev_skor") or 0, "dep_skor": m.get("dep_skor") or 0,
            "dk": a.get("dk", ""), "oyuncu": a.get("oyuncu", ""), "atan": a.get("atan", ""),
            "pen": "1" if a.get("pen") else "", "kk": "1" if a.get("kk") else ""}
    for taraf in ("ev", "dep"):
        t = m[taraf]
        kart[f"{taraf}_ad"] = t.get("ad", "")
        kart[f"{taraf}_kisa"] = (t.get("kisa") or t.get("ad", "")[:3]).upper()
        kart[f"{taraf}_logo"] = logo_adresi(t.get("logo") or "")
        kart[f"{taraf}_renk"] = t.get("renk", "")
    return kart


def ntfy_gonder(m, baslik, mesaj, etiketler, oncelik):
    """İsteğe bağlı eski yol: NTFY_KONU varsa takip.json'daki takımlar için."""
    konu = os.environ.get("NTFY_KONU", "").strip()
    if not konu or not ({m["ev"]["id"], m["dep"]["id"]} & takip_edilenler()):
        return
    govde = {"topic": konu, "title": baslik, "message": mesaj,
             "tags": list(etiketler), "priority": oncelik}
    adres = os.environ.get("UYGULAMA_ADRESI", "").strip()
    if adres:
        govde["click"] = adres
    istek = urllib.request.Request(
        "https://ntfy.sh/", data=json.dumps(govde).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(istek, timeout=15).read()
    except Exception as h:
        print(f"  bildirim gönderilemedi: {h}")


def skor_metni(m):
    return f"{m['ev']['ad']} {m['ev_skor'] or 0}–{m['dep_skor'] or 0} {m['dep']['ad']}"


def eslesme(m):
    return f"{m['ev']['ad']} – {m['dep']['ad']}"


def lig_adi(m):
    return next((l["ad"] for l in ayarlar()["ligler"] if l["kod"] == m.get("lig")), "")


def turkiye_saati(dt):
    """Bildirimdeki başlama saati Türkiye saatiyle (UTC+3, yaz saati yok)."""
    return (dt + timedelta(hours=3)).strftime("%H:%M")


def son_gol(m, atan, atan_skor):
    """Golü atan takımın son golü (gol listesi skorla uyuşuyorsa), yoksa None."""
    goller = [g for g in m.get("goller", []) if g["takim"] == atan["id"]]
    if goller and len(goller) == atan_skor and goller[-1].get("oyuncu"):
        return goller[-1]
    return None


def kart_ayrintisi(m, atan, atan_skor):
    """Skor kartının gol alanları; golcü henüz yoksa dakika ESPN saatinden, oyuncu boş."""
    g = son_gol(m, atan, atan_skor) or {}
    return {"atan": "ev" if atan is m["ev"] else "dep", "dk": g.get("dk") or m.get("dakika") or "",
            "oyuncu": g.get("oyuncu", ""), "pen": g.get("pen"), "kk": g.get("kk")}


def gol_ayrintisi(m, atan, atan_skor):
    """"67' Oyuncu · Takım" ("(k.k.)" / "(p)" ekli). Gol listesi skorla uyuşmazsa dakika + takım."""
    g = son_gol(m, atan, atan_skor)
    if g:
        ek = " (k.k.)" if g.get("kk") else " (p)" if g.get("pen") else ""
        return f"{g['dk']} {g['oyuncu']}{ek} · {atan['ad']}"
    return " · ".join(x for x in (m.get("dakika") or "", atan["ad"]) if x)


class Bildirici:
    """Her olayı bir kez bildirir: önce gönderir, anahtarı ancak başarılı olunca işaretler.

    Gidemeyen parçalar (sade / kart) bekleyenlere girer, yeniden_dene() her turda yalnız eksik parçayı
    gönderir (telefona çift bildirim düşmez); VAZGEC süresi geçince vazgeçilir."""

    def __init__(self, gonderilenler, bekleyenler=()):
        self.gonderilenler = set(gonderilenler)
        self.bekleyenler = {i["anahtar"]: i for i in bekleyenler}
        self.degisti = False   # gönderim/vazgeçme oldu: canli.json yeniden yazılmalı

    def bir_kez(self, anahtar, m, tur, olay, baslik, mesaj, etiketler=("soccer",), oncelik=4, ayrinti=None):
        """Bildirildiyse ya da sıradaysa False; gönderildiyse ya da kuyruğa alındıysa True."""
        if anahtar in self.gonderilenler or anahtar in self.bekleyenler:
            return False
        kart = kart_bilgisi(m, ayrinti) if tur in bildirim.KART_TURLERI else None
        is_ = {"anahtar": anahtar, "takimlar": [m["ev"]["id"], m["dep"]["id"]], "mac": m["id"], "tur": tur,
               "olay": olay, "baslik": baslik, "govde": mesaj, "kart": kart, "ilk": iso(simdi()), "deneme": 0}
        ntfy_gonder(m, baslik, mesaj, etiketler, oncelik)
        self._gonder(is_)
        return True

    def _gonder(self, is_, parcalar=None):
        """parcalar None: ilk gönderim (olayın tüm parçaları); yoksa yalnız eksik kalanlar."""
        giden = bildirim.gonder(is_["takimlar"], is_["tur"], is_["baslik"], is_["govde"], is_["mac"],
                                is_["olay"], kart=is_["kart"], parcalar_=parcalar)
        istenen = parcalar if parcalar is not None else bildirim.parcalar(is_["tur"], is_["kart"])
        kalan = [p for p in istenen if p not in (giden or [])]
        is_["deneme"] += 1
        self.degisti = True
        if kalan:
            is_["kalan"] = kalan
            self.bekleyenler[is_["anahtar"]] = is_
            print(f"  bildirim sırada: {is_['anahtar']} ({', '.join(kalan)} gitmedi, {is_['deneme']}. tur)")
        else:
            self.bekleyenler.pop(is_["anahtar"], None)
            self.gonderilenler.add(is_["anahtar"])
            if is_["deneme"] > 1:
                print(f"  bildirim {is_['deneme']}. turda gitti: {is_['anahtar']}")

    def yeniden_dene(self):
        for anahtar, is_ in list(self.bekleyenler.items()):
            if simdi() - zaman_oku(is_["ilk"]) > VAZGEC.get(is_["tur"], VAZGEC_DIGER):
                print(f"  bildirimden vazgeçildi (çok gecikti): {anahtar} ({', '.join(is_['kalan'])})")
                self.bekleyenler.pop(anahtar)
                self.gonderilenler.add(anahtar)   # tekrar tekrar üretilmesin
                self.degisti = True
                continue
            self._gonder(is_, is_["kalan"])

    def unut(self, anahtar):
        """Anahtar yeniden bildirilebilsin (ör. VAR iptali); sıradaysa gönderilmez."""
        self.gonderilenler.discard(anahtar)
        self.bekleyenler.pop(anahtar, None)


def degisiklikleri_bildir(b, eski, yeni):
    """Eski ve yeni maç durumunu karşılaştırıp gereken bildirimleri gönderir.

    Metinler (TASARIM.md > Bildirimler): başlık olayı ve skoru, gövde ayrıntıyı (oyuncu, lig) verir."""
    mid = yeni["id"]
    kod = yeni["durum_kodu"]
    lig = lig_adi(yeni)

    if kod in ERTELENDI:
        b.bir_kez(f"{mid}:ertelendi", yeni, "son", "ertelendi", f"Maç ertelendi: {eslesme(yeni)}",
                  lig or "Maç ertelendi ya da durduruldu", ("warning",))
        return

    if yeni["durum"] == "pre":
        bas = zaman_oku(yeni["tarih"])
        if bas and timedelta(0) < bas - simdi() <= HATIRLATMA:
            dk = int((bas - simdi()).total_seconds() // 60) + 1
            b.bir_kez(f"{mid}:hatirlat", yeni, "hat", "hatirlat",
                      f"{dk} dk sonra: {eslesme(yeni)} · {turkiye_saati(bas)}", lig, ("alarm_clock",), 3)
        return

    b.bir_kez(f"{mid}:basladi", yeni, "mac", "basladi", f"Maç başladı: {eslesme(yeni)}", lig, ("soccer",))

    # Goller: skor arttıysa gol, azaldıysa iptal (VAR)
    eski_ev = (eski or {}).get("ev_skor") or 0
    eski_dep = (eski or {}).get("dep_skor") or 0
    ev, dep = yeni["ev_skor"] or 0, yeni["dep_skor"] or 0
    if (ev, dep) != (eski_ev, eski_dep):
        if ev >= eski_ev and dep >= eski_dep:
            atan = yeni["ev"] if ev > eski_ev else yeni["dep"]
            atan_skor = ev if atan is yeni["ev"] else dep
            ayrinti = kart_ayrintisi(yeni, atan, atan_skor)
            # golcü adı beklenmez: ESPN vermediyse "67' · Takım" gider, ad gelince golcuyu_ekle günceller
            if b.bir_kez(f"{mid}:skor:{ev}-{dep}", yeni, "gol", "gol", f"⚽ GOL! {skor_metni(yeni)}",
                         gol_ayrintisi(yeni, atan, atan_skor), ("soccer", "tada"), 5, ayrinti=ayrinti)                     and not ayrinti["oyuncu"]:
                b.gonderilenler.add(f"{mid}:adsiz:{ev}-{dep}:{ayrinti['atan']}")
        else:
            iptal = yeni["ev"] if ev < eski_ev else yeni["dep"]
            dakika = f" · {yeni['dakika']}" if yeni.get("dakika") else ""
            b.bir_kez(f"{mid}:iptal:{ev}-{dep}", yeni, "gol", "iptal", f"❌ Gol iptal: {iptal['ad']}{dakika}",
                      skor_metni(yeni), ("x",),
                      ayrinti={"atan": "ev" if iptal is yeni["ev"] else "dep", "dk": yeni.get("dakika") or ""})
            # İptal edilen skor tekrar olursa yeniden bildirilebilsin
            b.unut(f"{mid}:skor:{eski_ev}-{eski_dep}")
            b.gonderilenler.discard(f"{mid}:iptal:{ev}-{dep}")   # sıradaysa yine de gönderilsin
    else:
        golcuyu_ekle(b, yeni)

    if kod == "STATUS_HALFTIME":
        b.bir_kez(f"{mid}:devre", yeni, "mac", "devre", f"Devre arası: {skor_metni(yeni)}", lig, ("hourglass",), 3)

    if yeni["durum"] == "post" or kod in BITTI:
        b.bir_kez(f"{mid}:bitti", yeni, "son", "bitti", f"Maç sonu: {skor_metni(yeni)}", lig, ("checkered_flag",))


def golcuyu_ekle(b, m):
    """Son gol bildirimi golcü adı olmadan gittiyse ve ESPN adı artık veriyorsa aynı bildirimi
    (aynı etiket) golcüyle sessizce günceller. Skor bu arada değiştiyse eski gol güncellenmez."""
    ev, dep = m["ev_skor"] or 0, m["dep_skor"] or 0
    for taraf, atan_skor in (("ev", ev), ("dep", dep)):
        anahtar = f"{m['id']}:adsiz:{ev}-{dep}:{taraf}"
        if anahtar not in b.gonderilenler or not son_gol(m, m[taraf], atan_skor):
            continue
        b.gonderilenler.discard(anahtar)
        bildirim.guncelle((m["ev"]["id"], m["dep"]["id"]), "gol", f"⚽ GOL! {skor_metni(m)}",
                          gol_ayrintisi(m, m[taraf], atan_skor), m["id"], "gol",
                          kart_bilgisi(m, kart_ayrintisi(m, m[taraf], atan_skor)))


# ------------------------------------------------------------- izleme

def tum_maclar():
    """ayarlar.json'daki liglerin dosyalarındaki tüm maçları toplar."""
    maclar = {}
    for lig in ayarlar()["ligler"]:
        for m in (json_oku(VERI / f"lig_{lig['kod']}.json", {}) or {}).get("maclar", []):
            maclar[m["id"]] = m
    return maclar


def izlenecek_mi(m, su_an):
    """Maç şu an izlenmeli mi, yoksa yakında mı başlayacak?"""
    bas = zaman_oku(m.get("tarih"))
    if not bas or m.get("durum_kodu") in ERTELENDI:
        return False
    if m.get("durum") == "post":
        return False
    if m.get("durum") == "in":
        return True
    # başlamamış: yakında başlıyorsa ya da başlaması gerekip veri eskiyse
    return bas - ILERI_BAK <= su_an <= bas + timedelta(hours=4)


def sonraki_baslangic(maclar, su_an):
    """Henüz başlamamış en yakın maçın başlama zamanı (yoksa None)."""
    zamanlar = [zaman_oku(m.get("tarih")) for m in maclar.values()
                if m.get("durum") == "pre" and m.get("durum_kodu") not in ERTELENDI]
    zamanlar = [z for z in zamanlar if z and z > su_an]
    return min(zamanlar) if zamanlar else None


def ara_guncelle():
    """Beklerken verinin süresi dolduysa günceller (veri_guncelle'nin 'otomatik' kuralları)."""
    try:
        if veri_guncelle.guncelle("otomatik"):
            git_gonder("Fikstür ve puan durumu güncellendi")
    except veri_guncelle.GuncellemeHatasi as h:
        print(f"Ara güncelleme başarısız: {h}")


def guncel_durum_getir(m):
    """Maçın son durumunu ESPN'den getirir."""
    bas = zaman_oku(m["tarih"])
    for gun in (bas.date(), bas.date() - timedelta(days=1)):
        for yeni in espn.gun_maclari(m["lig"], gun):
            if yeni["id"] == m["id"]:
                return yeni
    return None


def durumu_sabitle(eski, yeni):
    """ESPN'in FIRST/SECOND_HALF ↔ IN_PROGRESS gidip gelmesini yok sayar: oynanırken genel
    IN_PROGRESS gelirse önceki (daha belirgin) kod korunur; canli.json ve commit'ler oynamaz."""
    if eski and yeni.get("durum_kodu") == "STATUS_IN_PROGRESS" and eski.get("durum_kodu") in OYNANIYOR:
        yeni["durum_kodu"] = eski["durum_kodu"]
    return yeni


def _durum_ozeti(m):
    kod = m.get("durum_kodu")
    return (m.get("ev_skor"), m.get("dep_skor"), "oynaniyor" if kod in OYNANIYOR else kod)


def izle():
    canli = json_oku(VERI / "canli.json", {}) or {}
    b = Bildirici(canli.get("bildirilenler", []), canli.get("bekleyenler", []))
    son_durum = {m["id"]: m for m in canli.get("maclar", [])}

    baslangic = simdi()
    son_gonderim = simdi() - GONDERIM_ARALIGI
    izlenen_var = False
    azami = AZAMI_SURE
    test_dk = devir.test_dakikasi()
    if test_dk:
        azami = timedelta(minutes=test_dk) + devir.DEVIR_PAYI
        print(f"Devir denemesi: {test_dk} dk sonra devredilecek (maç yoksa da beklenir), sınır {azami}.")
    devir_ani = baslangic + azami - devir.DEVIR_PAYI
    devirci = devir.Devirci()

    def uyu(sn):
        """Devir anını ve sıradaki bildirimleri kaçırmayacak kadar uyur."""
        if simdi() < devir_ani:
            sn = min(sn, max(1, (devir_ani - simdi()).total_seconds()))
        if b.bekleyenler:
            sn = min(sn, KONTROL_CANLI)
        time.sleep(sn)

    while simdi() - baslangic < azami:
        su_an = simdi()
        b.yeniden_dene()
        maclar = tum_maclar()
        # izleme sırasında öğrendiğimiz en güncel durumu kullan
        for mid, m in son_durum.items():
            if mid in maclar:
                maclar[mid] = m
        adaylar = [m for m in maclar.values() if izlenecek_mi(m, su_an)]

        # süre sınırına yaklaşıldı ve izlenecek maç var: yeni izleyiciyi başlat, hazır olunca devret
        if su_an >= devir_ani and (adaylar or test_dk) and devirci.adim(su_an):
            canli_yaz(son_durum, b)
            if devirci.devret():
                return

        if not adaylar:
            if test_dk:
                if su_an < devir_ani:
                    print(f"Devir denemesi: maç yok, devre {int((devir_ani - su_an).total_seconds())} sn var.")
                uyu(30 if su_an < devir_ani else 5)
                continue
            if b.bekleyenler:   # ör. biten maçın bitiş bildirimi gidemedi: vazgeçene kadar dene
                canli_yaz(son_durum, b)
                uyu(KONTROL_CANLI)
                continue
            sonraki = sonraki_baslangic(maclar, su_an)
            kalan = azami - (su_an - baslangic)
            if not sonraki or sonraki - ILERI_BAK - su_an > min(BOSTA_BEKLE, kalan):
                break
            bekle = max(30, min((sonraki - ILERI_BAK - su_an).total_seconds(), 1800))
            print(f"Sıradaki maç {sonraki:%H:%M} UTC; izlemeye {int(bekle)} sn sonra bakılacak.")
            uyu(bekle)
            ara_guncelle()
            continue

        izlenen_var = True
        aktif = [m for m in adaylar
                 if zaman_oku(m["tarih"]) - HATIRLATMA - timedelta(minutes=2) <= su_an]
        if not aktif:
            ilk = min(zaman_oku(m["tarih"]) for m in adaylar)
            bekle = (ilk - HATIRLATMA - timedelta(minutes=1) - su_an).total_seconds()
            bekle = max(30, min(bekle, 600))
            print(f"Sıradaki maç {ilk:%H:%M} UTC; {int(bekle)} sn bekleniyor.")
            uyu(bekle)
            continue

        degisti = False
        # Aynı lig ve gündeki maçları tek istekte almak için grupla
        gruplar = defaultdict(list)
        for m in aktif:
            gruplar[(m["lig"], zaman_oku(m["tarih"]).date())].append(m)
        for (lig, gun), liste in gruplar.items():
            try:
                gunun = {x["id"]: x for x in espn.gun_maclari(lig, gun)}
            except espn.VeriHatasi as h:
                print(f"Kontrol hatası: {h}")
                continue
            for m in liste:
                yeni = gunun.get(m["id"]) or guncel_durum_getir(m)
                if not yeni:
                    continue
                eski = son_durum.get(m["id"])
                durumu_sabitle(eski, yeni)
                degisiklikleri_bildir(b, eski, yeni)
                if not eski or _durum_ozeti(eski) != _durum_ozeti(yeni):
                    degisti = True
                son_durum[m["id"]] = yeni
                print(f"{yeni['dakika'] or yeni['durum']:>6} {skor_metni(yeni)}")

        canli_yaz(son_durum, b)
        if degisti or simdi() - son_gonderim >= GONDERIM_ARALIGI:
            # maç detayları (canlı + az önce biten + açıklanan kadrolar) aynı commit'e girer
            detay.canli_guncelle([son_durum.get(m["id"], m) for m in aktif])
            detay.eksikleri_yaz(list(maclar.values()), azami=10)
            git_gonder("Canlı skor güncellendi")
            son_gonderim = simdi()
        oynanan = any(son_durum.get(m["id"], m).get("durum") == "in" or zaman_oku(m["tarih"]) <= su_an
                      for m in aktif)
        uyu(KONTROL_CANLI if oynanan else KONTROL)

    if devirci.istendi:
        print("Devir tamamlanamadı; süre doldu, izleyici kapanıyor (sıradaki tetikleme devam eder).")
    if izlenen_var or b.degisti:   # ör. yalnız önceki izleyiciden kalan bildirim gönderildi
        canli_yaz(son_durum, b)
    if izlenen_var:
        try:
            veri_guncelle.guncelle("hizli")
        except veri_guncelle.GuncellemeHatasi as h:
            print(f"Maç sonrası güncelleme başarısız: {h}")
        detay.eksikleri_yaz(list(tum_maclar().values()))
    if izlenen_var or b.degisti:
        git_gonder("Maç sonrası veriler güncellendi")


def canli_yaz(son_durum, b):
    sinir = simdi() - timedelta(hours=12)
    maclar = [m for m in son_durum.values()
              if (zaman_oku(m.get("tarih")) or simdi()) >= sinir]
    ids = {m["id"] for m in maclar}
    # bildirim kayıtlarını son maçlarla sınırlı tut
    bildirilenler = sorted(k for k in b.gonderilenler if k.split(":")[0] in ids)
    bekleyenler = [b.bekleyenler[k] for k in sorted(b.bekleyenler)]
    json_yaz(VERI / "canli.json", {"guncelleme": iso(), "maclar": maclar,
                                   "bildirilenler": bildirilenler, "bekleyenler": bekleyenler})


if __name__ == "__main__":
    hata = None
    try:
        veri_guncelle.guncelle("otomatik")
    except veri_guncelle.GuncellemeHatasi as h:
        hata = h
        print(f"HATA: {h}")
    # maç detayları: 7 günden eskileri sil, eksik (biten / kadrosu açıklanan) maçları yaz
    detay.eskileri_sil()
    detay.eksikleri_yaz(list(tum_maclar().values()))
    git_gonder("Fikstür ve puan durumu güncellendi")  # değişiklik yoksa bir şey yapmaz
    if os.environ.get("SADECE_VERI") == "1":
        print("Başka izleyici çalışıyor; yalnız veri güncellendi, izleme o izleyicide sürüyor.")
    else:
        onceki = os.environ.get("DEVIR_ONCEKI", "").strip()
        if onceki:
            devir.devri_al(onceki)   # önceki izleyici durumu devredene kadar bildirim gönderilmez
        izle()  # veri güncellenemese de canlı maç izleme ve bildirimler sürsün
    if hata:
        sys.exit(1)
