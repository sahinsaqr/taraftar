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
    "gol": ("⚽ GOL! Galatasaray 2–1 Fenerbahçe", "67' Mauro Icardi (p) · Galatasaray"),
    "mac": ("Maç başladı: Galatasaray – Fenerbahçe", "Süper Lig"),
    "son": ("Maç sonu: Galatasaray 2–1 Fenerbahçe", "Süper Lig"),
    "hat": ("15 dk sonra: Galatasaray – Fenerbahçe · 20:00", "Süper Lig"),
}
LOGO = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/{}.png&w=120&h=120"
# skor kartı örnekleri (gerçek logolar; olay türüne göre skor/oyuncu)
KART_TABAN = {"lig": "Süper Lig", "ev_ad": "Galatasaray", "dep_ad": "Fenerbahçe", "ev_kisa": "GAL", "dep_kisa": "FEN",
              "ev_logo": LOGO.format(432), "dep_logo": LOGO.format(436), "ev_renk": "aa0031", "dep_renk": "ffff00"}
KART = {
    "gol": {**KART_TABAN, "ev_skor": 2, "dep_skor": 1, "dk": "67'", "oyuncu": "Mauro Icardi", "atan": "ev", "pen": "1", "kk": ""},
    "mac": {**KART_TABAN, "ev_skor": 0, "dep_skor": 0},
    "son": {**KART_TABAN, "ev_skor": 2, "dep_skor": 1},
}
OLAY = {"gol": "gol", "mac": "basladi", "son": "bitti", "hat": "hatirlat"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    takim_id = sys.argv[1]
    tur = sys.argv[2] if len(sys.argv) > 2 else "gol"
    turler = list(ORNEK) if tur == "hepsi" else [tur]
    if any(t not in ORNEK for t in turler):
        sys.exit(f"Bilinmeyen tür: {tur} (gol | mac | son | hat | hepsi)")
    hata = False
    for t in turler:
        baslik, govde = ORNEK[t]
        # her denemenin etiketi ayrı: aynı etiket öncekinin yerine geçerdi
        # sade metin t{ID}_{tür} konusuna, skor kartı (veri) t{ID}_{tür}k konusuna gider
        if bildirim.gonder((takim_id,), t, baslik, govde, f"deneme_{t}", OLAY[t], kart=KART.get(t)):
            print(f"Gönderildi: t{takim_id}_{t} → kanal {bildirim.KANAL[t]}")
        else:
            hata = True
            print(f"Gönderilemedi: {t}")
    if hata:
        sys.exit("Bazı bildirimler gönderilemedi (FIREBASE_HESAP var mı?)")
