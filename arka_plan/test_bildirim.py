"""Bir takım konusuna deneme bildirimi gönderir (FCM).

Telefonda uygulamada o takımı takip ediyorsan ve ilgili bildirim türü açıksa
bildirim gelmeli; Profil > Bildirimler'den tür kapatılınca gelmemeli.
Her tür kendi Android kanalına gider (goller, mac_durumu, mac_sonucu, hatirlatma).

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
    "gol": ("⚽ GOL! Deneme FK 2–1 Örnek SK", "67' Deneme Oyuncu · Deneme FK"),
    "mac": ("Maç başladı: Deneme FK – Örnek SK", "Süper Lig"),
    "son": ("Maç sonu: Deneme FK 2–1 Örnek SK", "Süper Lig"),
    "hat": ("15 dk sonra: Deneme FK – Örnek SK · 20:00", "Süper Lig"),
}

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
        if bildirim.gonder((takim_id,), t, baslik, govde, f"deneme_{t}", "deneme"):
            print(f"Gönderildi: t{takim_id}_{t} → kanal {bildirim.KANAL[t]}")
        else:
            hata = True
            print(f"Gönderilemedi: {t}")
    if hata:
        sys.exit("Bazı bildirimler gönderilemedi (FIREBASE_HESAP var mı?)")
