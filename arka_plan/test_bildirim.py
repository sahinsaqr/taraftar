"""Bir takım konusuna deneme bildirimi gönderir (FCM).

Telefonda uygulamada o takımı takip ediyorsan ve ilgili bildirim türü açıksa
bildirim gelmeli; Profil > Bildirimler'den tür kapatılınca gelmemeli.
Her tür kendi Android kanalına gider (goller, mac_durumu, mac_sonucu, hatirlatma_sesli).

Kullanım:
  python arka_plan/test_bildirim.py <takım_id> [tür]      tür: gol (varsayılan) | mac | son | hat | hepsi

FIREBASE_HESAP ortam değişkeni gerekir (servis hesabı JSON'unun base64 hali)
ya da GitHub'da "Deneme bildirimi" iş akışıyla çalıştırılır.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bildirim  # noqa: E402

ORNEK = {
    "gol": ("⚽ GOL! Galatasaray 2–1 Fenerbahçe", "90+4' Przemysław Frankowski (p) · Galatasaray"),
    "mac": ("Maç başladı: Galatasaray – Fenerbahçe", "Süper Lig"),
    "son": ("Maç sonu: Galatasaray 2–1 Fenerbahçe", "Süper Lig"),
    "hat": ("15 dk sonra: Galatasaray – Fenerbahçe · 20:00", "Süper Lig"),
}
LOGO = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/{}.png&w=120&h=120"
# skor kartı örnekleri (gerçek logolar; olay türüne göre skor/oyuncu)
KART_TABAN = {"lig": "Süper Lig", "ev_ad": "Galatasaray", "dep_ad": "Fenerbahçe", "ev_kisa": "GS", "dep_kisa": "FB",
              "ev_logo": LOGO.format(432), "dep_logo": LOGO.format(436), "ev_renk": "aa0031", "dep_renk": "ffff00"}
KART = {
    "gol": {**KART_TABAN, "ev_skor": 2, "dep_skor": 1, "dk": "90+4'", "oyuncu": "Przemysław Frankowski",
            "atan": "ev", "pen": "1", "kk": ""},   # uzun ad: kartta "⚽ 90+4' Frankowski (p)", sığmazsa "…"
    "mac": {**KART_TABAN, "ev_skor": 0, "dep_skor": 0},
    "son": {**KART_TABAN, "ev_skor": 2, "dep_skor": 1},
}
MAC_ID = "deneme"   # tüm denemeler aynı "maç"
OLAY = {"gol": "gol", "mac": "basladi", "son": "bitti", "hat": "hatirlat"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    takim_id = sys.argv[1]
    tur = sys.argv[2] if len(sys.argv) > 2 else "gol"
    turler = list(ORNEK) if tur == "hepsi" else [tur]
    if any(t not in ORNEK for t in turler):
        sys.exit(f"Bilinmeyen tür: {tur} (gol | mac | son | hat | hepsi)")
    if not bildirim._baslat():
        sys.exit("FIREBASE_HESAP yok; deneme bildirimi gönderilemez.")
    hata = False
    for t in turler:
        baslik, govde = ORNEK[t]
        # gerçek maçtaki gibi tek etiket (maç id): sonraki deneme öncekinin yerine geçer
        # sade metin t{ID}_{tür} konusuna, skor kartı (veri) t{ID}_{tür}k konusuna gider
        istenen = bildirim.parcalar(t, KART.get(t))
        giden = bildirim.gonder((takim_id,), t, baslik, govde, MAC_ID, OLAY[t], kart=KART.get(t))
        if set(giden) == set(istenen):
            print(f"Gönderildi: t{takim_id}_{t} → kanal {bildirim.KANAL[t]}")
        else:
            hata = True
            print(f"Gönderilemedi: {t} ({', '.join(sorted(set(istenen) - set(giden)))})")
    if hata:
        sys.exit("Bazı bildirimler gönderilemedi")
