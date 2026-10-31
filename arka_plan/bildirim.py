"""Firebase Cloud Messaging ile takım konularına bildirim gönderir.

Uygulama her takip edilen takım için açık olan bildirim türlerinin konusuna
abone olur: t{takımID}_{tür}, tür = gol | mac | son | hat. Her tür kendi Android
kanalına gider (KANAL): goller, mac_durumu, mac_sonucu, hatirlatma_sesli. Sunucu kimin neyi
takip ettiğini bilmez; olayı iki takımın ilgili konusuna tek mesajla gönderir
(koşul: 't1_gol' in topics || 't2_gol' in topics), böylece iki takımı da takip
eden kişi aynı bildirimi iki kez almaz.

Ortam değişkeni:
  FIREBASE_HESAP : servis hesabı JSON'unun base64 hali (GitHub gizli anahtarı).
                   Yoksa bildirimler sadece konsola yazılır.
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


def gonder(takim_idleri, tur, baslik, govde, mac_id, olay="", kart=None):
    """Olayı takımların `tur` konusuna (sade metin) ve kart verisi varsa `tur`k konusuna (skor kartı,
    yalnız veri) gönderir. Sade metin gönderimi başarılıysa True."""
    assert tur in TURLER, tur
    k = kosul(takim_idleri, tur)
    print(f"[FCM {tur}] {baslik} | {govde.replace(chr(10), ' / ')}  →  {k}")
    if kart is not None and tur in KART_TURLERI:
        kart_gonder(takim_idleri, tur, baslik, govde, mac_id, olay, kart)
    if not k or not _baslat():
        return False
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
    try:
        messaging.send(mesaj)
        return True
    except Exception as h:  # ağ, kota vb.; izlemeyi durdurmasın
        print(f"  FCM gönderilemedi: {h}")
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
        return False
    from firebase_admin import messaging
    mesaj = messaging.Message(condition=k, data=veri, android=messaging.AndroidConfig(priority="high", ttl=3600))
    try:
        messaging.send(mesaj)
        return True
    except Exception as h:
        print(f"  FCM (veri) gönderilemedi: {h}")
        return False
