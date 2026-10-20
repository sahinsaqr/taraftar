"""Gol bildirimi sesi: hakem düdüğü, tamamen sentezle üretilir (kayıt/örnek kullanılmaz → telif yok).

Bezelyeli düdük modeli: ~3 kHz ana ton + harmonikler, içindeki topun yarattığı ~35 Hz titreme
(frekans ve genlik modülasyonu), bant geçiren nefes gürültüsü. Kalıp: kısa · kısa · uzun (~1,3 sn).

Çıktı: android/app/src/main/res/raw/gol_sesi.ogg (Vorbis, mono, 44,1 kHz)
Gerekenler (projede değil, bir kez çalıştırılır):  pip install numpy soundfile
Çalıştırma:  python araclar/gol_sesi.py
"""
from pathlib import Path

import numpy as np
import soundfile as sf

ORNEKLEME = 44100
CIKTI = Path(__file__).resolve().parent.parent / "android/app/src/main/res/raw/gol_sesi.ogg"
rng = np.random.default_rng(1907)   # aynı dosya her seferinde aynı çıksın


def bant(gurultu, merkez, genislik):
    """FFT ile basit bant geçiren süzgeç."""
    spektrum = np.fft.rfft(gurultu)
    f = np.fft.rfftfreq(len(gurultu), 1 / ORNEKLEME)
    spektrum *= np.exp(-(((f - merkez) / genislik) ** 2))
    return np.fft.irfft(spektrum, len(gurultu))


def ufleme(sure, temel=3050.0):
    n = int(sure * ORNEKLEME)
    t = np.arange(n) / ORNEKLEME
    # topun titremesi: 33-38 Hz arasında hafifçe oynayan modülasyon
    titreme_hz = 35 + 2.5 * np.sin(2 * np.pi * 1.3 * t)
    titreme = np.sin(2 * np.pi * np.cumsum(titreme_hz) / ORNEKLEME)
    # başta hafif yükselen perde, titremeyle ±%3 frekans oynaması
    perde = temel * (1 - 0.06 * np.exp(-t / 0.03)) * (1 + 0.03 * titreme)
    faz = 2 * np.pi * np.cumsum(perde) / ORNEKLEME
    ton = np.sin(faz) + 0.22 * np.sin(2 * faz) + 0.07 * np.sin(3 * faz)
    ton *= 0.62 + 0.38 * (0.5 + 0.5 * titreme)          # genlik titremesi
    nefes = bant(rng.standard_normal(n), temel, 900) * 0.9
    nefes /= np.max(np.abs(nefes)) + 1e-9
    sinyal = ton + 0.18 * nefes
    # zarf: 12 ms giriş, 45 ms çıkış
    zarf = np.minimum(1, t / 0.012) * np.minimum(1, (sure - t) / 0.045)
    return sinyal * np.clip(zarf, 0, 1)


def sessizlik(sure):
    return np.zeros(int(sure * ORNEKLEME))


ses = np.concatenate([ufleme(0.15), sessizlik(0.07), ufleme(0.15), sessizlik(0.07), ufleme(0.78), sessizlik(0.05)])
ses = ses / np.max(np.abs(ses)) * 0.7   # tepe ≈ -3 dBFS
CIKTI.parent.mkdir(parents=True, exist_ok=True)
sf.write(CIKTI, ses.astype(np.float32), ORNEKLEME, format="OGG", subtype="VORBIS")
print(f"{CIKTI} · {len(ses) / ORNEKLEME:.2f} sn · {CIKTI.stat().st_size} bayt")
