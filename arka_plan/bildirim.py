"""Firebase Cloud Messaging ile takım konularına bildirim gönderir.

Uygulama her takip edilen takım için açık olan bildirim türlerinin konusuna
abone olur: t{takımID}_{tür}, tür = gol | mac | son | hat. Her tür kendi Android
kanalına gider (KANAL): goller, mac_durumu, mac_sonucu, hatirlatma_sesli. Sunucu kimin neyi
takip ettiğini bilmez; olayı iki takımın ilgili konusuna tek mesajla gönderir
(koşul: 't1_gol' in topics || 't2_gol' in topics), böylece iki takımı da takip
eden kişi aynı bildirimi iki kez almaz.

Her FCM çağrısı geçici hatada (ağ, UNAVAILABLE, INTERNAL, kota…) en fazla 3 kez denenir; kalıcı hatada
(geçersiz istek, yetki) hemen vazgeçilir. Başarıda FCM'nin mesaj kimliği loga yazılır. gonder() hangi
parçaların (sade metin / skor kartı) gittiğini döner; gitmeyenleri mac_izle.Bildirici sonra yeniden dener.

Ortam değişkeni:
  FIREBASE_HESAP : servis hesabı JSON'unun base64 hali (GitHub gizli anahtarı).
                   Yoksa bildirimler sadece konsola yazılır (gönderilmiş sayılır).
"""
import base64
import json
import os
import time

TURLER = ("gol", "mac", "son", "hat")
# Her tür kendi Android kanalına gider (kanallar uygulamada bulut.js'te oluşturulur; ses/önem kanaldadır)
KANAL = {"gol": "goller", "mac": "mac_durumu", "son": "mac_sonucu", "hat": "hatirlatma_sesli"}
RENK = "#C8F04A"          # bildirim vurgusu (lime)
IKON = "ic_stat_taraftar"  # res/drawable-*dpi
GOL_SESI = "gol_sesi"      # res/raw/gol_sesi.ogg (Android 8 öncesi; sonrasında kanalın sesi çalar)
# "Skor kartı" görünümü: bu türler ayrıca t{ID}_{tür}k konularına yalnız veri (data-only) mesajı olarak gider;
# bildirimi uygulamanın yerel kodu çizer (BildirimServisi.java). Hatırlatma yalnız metin.
KART_TURLERI = ("gol", "mac", "son")
DENEME_BEKLE = (2, 5)      # geçici hatada yeniden denemeden önce beklenen saniyeler (toplam 3 deneme)
KALICI_HATALAR = {"INVALID_ARGUMENT", "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND",
                  "FAILED_PRECONDITION", "ALREADY_EXISTS", "OUT_OF_RANGE"}

_uygulama = None
_denendi = False


def _baslat():
    """firebase-admin'i bir kez başlatır; kimlik yoksa None döner."""
    global _uygulama, _denendi
    if _denendi:
        return _uygulama
    _denendi = True
    hesap = os.environ.get("FIREBASE_HESAP", "").strip()
    if not hesap:
        print("FIREBASE_HESAP yok; bildirimler sadece konsola yazılacak.")
        return None
    import firebase_admin
    from firebase_admin import credentials
    bilgi = json.loads(base64.b64decode(hesap))
    _uygulama = firebase_admin.initialize_app(credentials.Certificate(bilgi))
    return _uygulama


def kosul(takim_idleri, tur):
    konular = sorted({f"t{t}_{tur}" for t in takim_idleri if t})
    return " || ".join(f"'{k}' in topics" for k in konular)


def parcalar(tur, kart):
    """Bir olayın gönderilecek parçaları: her zaman sade metin, kart verisi varsa skor kartı."""
    return ["sade"] + (["kart"] if kart is not None and tur in KART_TURLERI else [])


def gonder(takim_idleri, tur, baslik, govde, mac_id, olay="", kart=None, parcalar_=None):
    """Olayı takımların `tur` konusuna (sade metin) ve kart verisi varsa `tur`k konusuna (skor kartı,
    yalnız veri) gönderir. `parcalar_` verilirse yalnız o parçalar ("sade", "kart") gönderilir.
    Başarıyla giden parçaların listesini döner (kimlik yoksa hepsi gitmiş sayılır)."""
    assert tur in TURLER, tur
    istenen = parcalar_ if parcalar_ is not None else parcalar(tur, kart)
    giden = []
    if "kart" in istenen and kart is not None and tur in KART_TURLERI:
        if kart_gonder(takim_idleri, tur, baslik, govde, mac_id, olay, kart):
            giden.append("kart")
    if "sade" in istenen and _sade_gonder(takim_idleri, tur, baslik, govde, mac_id, olay):
        giden.append("sade")
    return giden


def _sade_gonder(takim_idleri, tur, baslik, govde, mac_id, olay):
    k = kosul(takim_idleri, tur)
    print(f"[FCM {tur}] {baslik} | {govde.replace(chr(10), ' / ')}  →  {k}")
    if not k or not _baslat():
        return True   # gönderilecek konu ya da kimlik yok: tekrar denemenin anlamı yok
    from firebase_admin import messaging
    mesaj = messaging.Message(
        condition=k,
        notification=messaging.Notification(title=baslik, body=govde),
        android=messaging.AndroidConfig(
            priority="high",              # normal öncelik Doze'da dakikalarca bekletilebilir
            notification=messaging.AndroidNotification(
                channel_id=KANAL[tur],
                tag=str(mac_id),          # aynı maçın yeni bildirimi öncekinin yerine geçer
                color=RENK,
                icon=IKON,
                sound=GOL_SESI if tur == "gol" else "default",
            ),
        ),
        data={"mac": str(mac_id), "tur": tur, "olay": olay, "gonderim": _zaman()},
    )
    return _yolla(mesaj, tur)


def _gecici_mi(hata):
    """Yeniden denemeye değer mi? firebase_admin hatalarının `code` alanına bakar; diğerleri (ağ) geçici."""
    if isinstance(hata, (ValueError, TypeError)):
        return False   # mesaj kurulamadı
    return getattr(hata, "code", None) not in KALICI_HATALAR


def _yolla(mesaj, ne):
    """messaging.send; geçici hatada DENEME_BEKLE aralıklarıyla yeniden dener. Başarıda mesaj kimliği loglanır."""
    from firebase_admin import messaging
    for i in range(len(DENEME_BEKLE) + 1):
        try:
            kimlik = messaging.send(mesaj)
            print(f"  FCM ok ({ne}): {kimlik}")
            return True
        except Exception as h:  # ağ, kota vb.; izlemeyi durdurmasın
            gecici = _gecici_mi(h)
            print(f"  FCM gönderilemedi ({ne}, deneme {i + 1}{'' if gecici else ', kalıcı hata'}): "
                  f"{getattr(h, 'code', type(h).__name__)}: {h}")
            if not gecici or i == len(DENEME_BEKLE):
                return False
            time.sleep(DENEME_BEKLE[i])
    return False


def _zaman():
    """Gönderim anı (epoch ms); uygulama varışta gecikmeyi kaydeder (adb logcat -s Taraftar.Kart)."""
    return str(int(time.time() * 1000))


def kart_verisi(tur, baslik, govde, mac_id, olay, kart):
    """Skor kartı veri mesajının alanları (hepsi metin; FCM veri değerleri string olmalı)."""
    veri = {"kart": "1", "mac": str(mac_id), "tur": tur, "olay": olay, "kanal": KANAL[tur],
            "baslik": baslik, "govde": govde, "gonderim": _zaman()}
    for anahtar, deger in kart.items():
        veri[anahtar] = "" if deger is None else str(deger)
    return veri


def kart_gonder(takim_idleri, tur, baslik, govde, mac_id, olay, kart):
    """t{ID}_{tür}k konularına yüksek öncelikli, yalnız veri mesajı (bildirimi uygulama çizer)."""
    k = kosul(takim_idleri, f"{tur}k")
    print(f"[FCM {tur}k] kart: {kart.get('ev_kisa')} {kart.get('ev_skor')}-{kart.get('dep_skor')} {kart.get('dep_kisa')}  →  {k}")
    return _veri_gonder(k, kart_verisi(tur, baslik, govde, mac_id, olay, kart))


def guncelle(takim_idleri, tur, baslik, govde, mac_id, olay, kart):
    """Gönderilmiş bildirimi (aynı etiket = maç id) sessizce günceller, ör. golcü adı sonradan gelince.

    İki görünüme de yalnız veri mesajı gider ("guncelle": sade | kart); uygulama bildirim hâlâ
    duruyorsa yeniden çizer, ses/titreşim olmaz (BildirimServisi.java). 1.0.1 ve öncesi yok sayar."""
    print(f"[FCM {tur} güncelle] {baslik} | {govde}")
    sade = {"guncelle": "sade", "mac": str(mac_id), "tur": tur, "olay": olay, "kanal": KANAL[tur],
            "baslik": baslik, "govde": govde, "gonderim": _zaman()}
    kartli = {**kart_verisi(tur, baslik, govde, mac_id, olay, kart), "kart": "", "guncelle": "kart"}
    a = _veri_gonder(kosul(takim_idleri, tur), sade)
    b = _veri_gonder(kosul(takim_idleri, f"{tur}k"), kartli)
    return a and b


def _veri_gonder(k, veri):
    """Koşula yüksek öncelikli, yalnız veri mesajı (bildirimi uygulama çizer)."""
    if not k or not _baslat():
        return True   # konu ya da kimlik yok: tekrar denemenin anlamı yok
    from firebase_admin import messaging
    mesaj = messaging.Message(condition=k, data=veri, android=messaging.AndroidConfig(priority="high", ttl=3600))
    return _yolla(mesaj, f"{veri.get('tur', '')}k" if veri.get("kart") else f"{veri.get('tur', '')} veri")
