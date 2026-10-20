"""ESPN'in açık veri adreslerinden futbol verisi çeker ve sadeleştirir.

Sadece Python'un kendi kütüphanelerini kullanır (ek kurulum gerekmez).
"""
import json
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer"
STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (taraftar kisisel proje)",
    "Accept": "application/json",
}

# ESPN takım adlarını Türkçe yazımlarına çevirir
TURKCE_AD = {
    "Besiktas": "Beşiktaş",
    "Fenerbahce": "Fenerbahçe",
    "Goztepe": "Göztepe",
    "Istanbul Basaksehir": "Başakşehir",
    "Basaksehir": "Başakşehir",
    "Genclerbirligi": "Gençlerbirliği",
    "Kasimpasa": "Kasımpaşa",
    "Eyupspor": "Eyüpspor",
    "Caykur Rizespor": "Çaykur Rizespor",
    "Rizespor": "Çaykur Rizespor",
    "Fatih Karagumruk": "Fatih Karagümrük",
    "Karagumruk": "Fatih Karagümrük",
    "Erzurum BB": "Erzurumspor FK",
    "Amed SFK": "Amedspor",
    "Ankaragucu": "Ankaragücü",
    "MKE Ankaragucu": "Ankaragücü",
    "Istanbulspor": "İstanbulspor",
    "Igdir FK": "Iğdır FK",
    "Umraniyespor": "Ümraniyespor",
    "Bandirmaspor": "Bandırmaspor",
    "Manisa FK": "Manisa FK",
    "Sanliurfaspor": "Şanlıurfaspor",
    "Corum FK": "Çorum FK",
    "Sakaryaspor": "Sakaryaspor",
    "Keciorengucu": "Keçiörengücü",
    "Esenler Erokspor": "Esenler Erokspor",
}


def turkce(ad):
    return TURKCE_AD.get(ad, ad)


class VeriHatasi(Exception):
    pass


def getir(url, deneme=3):
    """URL'den JSON çeker; geçici hatalarda birkaç kez yeniden dener."""
    son_hata = None
    for i in range(deneme):
        try:
            istek = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(istek, timeout=25) as yanit:
                return json.loads(yanit.read().decode("utf-8"))
        except urllib.error.HTTPError as h:
            son_hata = h
            if h.code in (400, 404):
                break  # tekrar denemenin anlamı yok
        except Exception as h:  # zaman aşımı, bağlantı hatası vb.
            son_hata = h
        time.sleep(1.5 * (i + 1))
    raise VeriHatasi(f"{url} -> {son_hata}")


# ---------------------------------------------------------------- maçlar

def _skor(c):
    s = c.get("score")
    if isinstance(s, dict):
        s = s.get("displayValue", s.get("value"))
    if s is None or s == "":
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _logo(team):
    if team.get("logo"):
        return team["logo"]
    logos = team.get("logos") or []
    return logos[0].get("href") if logos else ""


def _renk(deger):
    """ESPN rengi ("c8102e") ya da boş; logo yüklenemezse uygulama bu renkte yuvarlak çizer."""
    deger = (deger or "").strip().lstrip("#").lower()
    return deger if len(deger) == 6 and all(c in "0123456789abcdef" for c in deger) else ""


def _takim(c):
    t = c.get("team", {})
    return {
        "id": str(t.get("id", "")),
        "ad": turkce(t.get("displayName") or t.get("name") or ""),
        "kisa": t.get("abbreviation", ""),
        "logo": _logo(t),
        "renk": _renk(t.get("color")),
        "renk2": _renk(t.get("alternateColor")),
    }


def _goller(comp):
    """Golleri (dakika, oyuncu, takım) listeler. ESPN her zaman vermeyebilir."""
    goller = []
    for d in comp.get("details") or []:
        if not d.get("scoringPlay"):
            continue
        oyuncular = d.get("athletesInvolved") or []
        goller.append({
            "dk": (d.get("clock") or {}).get("displayValue", ""),
            "oyuncu": oyuncular[0].get("displayName", "") if oyuncular else "",
            "takim": str((d.get("team") or {}).get("id", "")),
            "kk": bool(d.get("ownGoal")),
            "pen": bool(d.get("penaltyKick")),
        })
    return goller


def mac_sadele(ev, lig_kodu):
    """ESPN etkinliğini uygulamanın kullandığı sade biçime çevirir."""
    comp = (ev.get("competitions") or [{}])[0]
    durum = comp.get("status") or ev.get("status") or {}
    tip = durum.get("type") or {}
    ev_sahibi = deplasman = None
    for c in comp.get("competitors") or []:
        if c.get("homeAway") == "home":
            ev_sahibi = c
        else:
            deplasman = c
    if not ev_sahibi or not deplasman:
        return None
    asama = tip.get("state", "pre")  # pre / in / post
    oynandi = asama != "pre"
    return {
        "id": str(ev.get("id")),
        "lig": lig_kodu,
        "tarih": ev.get("date") or comp.get("date"),
        "durum": asama,
        "durum_kodu": tip.get("name", ""),
        "dakika": durum.get("displayClock", "") if asama == "in" else "",
        "ev": _takim(ev_sahibi),
        "dep": _takim(deplasman),
        "ev_skor": _skor(ev_sahibi) if oynandi else None,
        "dep_skor": _skor(deplasman) if oynandi else None,
        "goller": _goller(comp) if oynandi else [],
        "stat": (comp.get("venue") or {}).get("fullName", ""),
    }


def gun_maclari(lig_kodu, gun):
    """Tek bir gündeki (UTC) maçları getirir. gun: date nesnesi."""
    veri = getir(f"{SITE}/{lig_kodu}/scoreboard?dates={gun:%Y%m%d}")
    return [m for m in (mac_sadele(e, lig_kodu) for e in veri.get("events", [])) if m]


YEDEK_GUN_SINIRI = 21   # takvim alınamazsa en fazla bu kadar gün tek tek istenir


def _gun(metin):
    """"2026-08-14T07:00Z" gibi bir metnin tarih kısmını date olarak verir."""
    try:
        return date.fromisoformat(str(metin)[:10])
    except ValueError:
        return None


def mac_gunleri(lig_kodu):
    """Ligin takvimindeki günleri verir (tarihsiz scoreboard isteğinden).

    ESPN tarih aralığı isteklerini artık kabul etmediği için maçlar gün gün
    çekilir; takvim (liglerde) sadece maç olan günlere istek atmayı sağlar.
    """
    veri = getir(f"{SITE}/{lig_kodu}/scoreboard")
    takvim = ((veri.get("leagues") or [{}])[0]).get("calendar") or []
    gunler = set()
    for oge in takvim:
        if not isinstance(oge, dict):
            if g := _gun(oge):
                gunler.add(g)
            continue
        # Kupalarda (UEFA) takvim maç günlerini değil tur aralıklarını verir;
        # maç kaçmasın diye aralıklardaki her gün alınır.
        for aralik in oge.get("entries") or [oge]:
            bas, son = _gun(aralik.get("startDate")), _gun(aralik.get("endDate"))
            if bas and son:
                gunler.update(bas + timedelta(days=i) for i in range((son - bas).days + 1))
            elif bas or son:
                gunler.add(bas or son)
    if not gunler:
        raise VeriHatasi(f"{lig_kodu}: takvim boş")
    return gunler


def sezon_maclari(lig_kodu, geri_gun, ileri_gun):
    bugun = date.today()
    bas = bugun - timedelta(days=geri_gun)
    son = bugun + timedelta(days=ileri_gun)
    try:
        gunler = sorted(g for g in mac_gunleri(lig_kodu) if bas <= g <= son)
    except VeriHatasi as h:
        print(f"  takvim alınamadı ({h}); bugün çevresindeki en fazla "
              f"{YEDEK_GUN_SINIRI} gün tek tek isteniyor")
        # Pencereyi bugünün çevresine al: biraz geri, gerisi ileri
        bas = max(bas, bugun - timedelta(days=7))
        son = min(son, bas + timedelta(days=YEDEK_GUN_SINIRI - 1))
        gunler = [bas + timedelta(days=i) for i in range((son - bas).days + 1)]
    maclar = {}
    for gun in gunler:
        for m in gun_maclari(lig_kodu, gun):
            maclar[m["id"]] = m
        time.sleep(0.3)
    return maclar


# --------------------------------------------------------- puan durumu

def _istatistik(stats):
    sonuc = {}
    for s in stats or []:
        ad = s.get("name") or s.get("type")
        deger = s.get("value")
        if deger is None:
            deger = s.get("displayValue")
        sonuc[ad] = deger
    return sonuc


def _sayi(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return 0


def puan_durumu(lig_kodu):
    """Lig tablosunu getirir. Gruplu turnuvalarda birden çok tablo olabilir."""
    veri = getir(f"{STANDINGS}/{lig_kodu}/standings")
    tablolar = []
    gruplar = veri.get("children") or ([veri] if veri.get("standings") else [])
    for g in gruplar:
        satirlar = []
        for e in (g.get("standings") or {}).get("entries") or []:
            t = e.get("team") or {}
            st = _istatistik(e.get("stats"))
            not_ = e.get("note") or {}
            satirlar.append({
                "sira": _sayi(st.get("rank")) or len(satirlar) + 1,
                "takim": {
                    "id": str(t.get("id", "")),
                    "ad": turkce(t.get("displayName") or t.get("name") or ""),
                    "logo": _logo(t),
                },
                "o": _sayi(st.get("gamesPlayed")),
                "g": _sayi(st.get("wins")),
                "b": _sayi(st.get("ties")),
                "m": _sayi(st.get("losses")),
                "a": _sayi(st.get("pointsFor")),
                "y": _sayi(st.get("pointsAgainst")),
                "av": _sayi(st.get("pointDifferential")),
                "p": _sayi(st.get("points")),
                "renk": not_.get("color", ""),
                "not": not_.get("description", ""),
            })
        satirlar.sort(key=lambda s: s["sira"])
        if satirlar:
            tablolar.append({"ad": g.get("name", ""), "satirlar": satirlar})
    return tablolar


# ------------------------------------------------------------- takımlar

def lig_takimlari(lig_kodu):
    veri = getir(f"{SITE}/{lig_kodu}/teams")
    takimlar = []
    for sp in veri.get("sports") or []:
        for lg in sp.get("leagues") or []:
            for x in lg.get("teams") or []:
                t = x.get("team") or x
                takimlar.append({
                    "id": str(t.get("id", "")),
                    "ad": turkce(t.get("displayName") or t.get("name") or ""),
                    "kisa": t.get("abbreviation", ""),
                    "logo": _logo(t),
                    "renk": _renk(t.get("color")),
                    "renk2": _renk(t.get("alternateColor")),
                })
    return takimlar


# ------------------------------------------------------------- maç detayı

# Uygulamanın gösterdiği takım istatistikleri (ESPN adı → kısa anahtar), bu sırayla
DETAY_ISTATISTIK = [
    ("possessionPct", "topa_sahip"),
    ("totalShots", "sut"),
    ("shotsOnTarget", "isabetli_sut"),
    ("wonCorners", "korner"),
    ("foulsCommitted", "faul"),
    ("offsides", "ofsayt"),
    ("yellowCards", "sari_kart"),
    ("redCards", "kirmizi_kart"),
]


def _mevki(kisaltma):
    """ESPN mevki kısaltması (G, CD-L, LB, DM, AM-R, CF...) → KL / DF / OS / FV."""
    k = (kisaltma or "").upper()
    if not k or k == "SUB":
        return ""
    if k.startswith("G"):
        return "KL"
    if k.startswith(("DM", "CM", "AM", "LM", "RM", "M")):   # "DM" defans değil, orta saha
        return "OS"
    if k.startswith(("CD", "LB", "RB", "CB", "D", "LWB", "RWB", "SW")):
        return "DF"
    return "FV"


def _olay(e, ev_id, mac_bitti_ek):
    """keyEvents öğesi → sade olay (gösterilmeyenler None).

    tur: gol | penalti | kk (kendi kalesine) | penalti_kacti | sari | kirmizi | degisiklik | ayrac
    taraf: ev | dep (olayın yazıldığı takım; kendi kalesine golde golden yararlanan takım)."""
    tip = ((e.get("type") or {}).get("type") or "").lower()
    takim = str((e.get("team") or {}).get("id") or "")
    taraf = "ev" if takim == ev_id else ("dep" if takim else "")
    oyuncular = [(p.get("athlete") or {}).get("displayName", "") for p in e.get("participants") or []]
    dk = (e.get("clock") or {}).get("displayValue", "")
    olay = {"dk": dk, "taraf": taraf}
    if tip == "halftime":
        return {"dk": dk, "tur": "ayrac", "metin": "Devre arası"}
    if tip == "end-regular-time":
        return {"dk": dk, "tur": "ayrac", "metin": "Normal süre sonu" if mac_bitti_ek else "Maç sonu"}
    if tip in ("end-extra-time", "end-of-extra-time"):
        return {"dk": dk, "tur": "ayrac", "metin": "Uzatmalar sonu"}
    if tip == "own-goal":
        return {**olay, "tur": "kk", "oyuncu": oyuncular[0] if oyuncular else ""}
    if tip == "penalty---scored":
        return {**olay, "tur": "penalti", "oyuncu": oyuncular[0] if oyuncular else ""}
    if tip.startswith("penalty---"):          # missed / saved / hit-woodwork
        return {**olay, "tur": "penalti_kacti", "oyuncu": oyuncular[0] if oyuncular else ""}
    if tip.startswith("goal") or (e.get("scoringPlay") and not tip.startswith("penalty")):
        return {**olay, "tur": "gol", "oyuncu": oyuncular[0] if oyuncular else "",
                "asist": oyuncular[1] if len(oyuncular) > 1 else ""}
    if "red" in tip or "second-yellow" in tip:
        return {**olay, "tur": "kirmizi", "oyuncu": oyuncular[0] if oyuncular else ""}
    if "yellow" in tip:
        return {**olay, "tur": "sari", "oyuncu": oyuncular[0] if oyuncular else ""}
    if tip == "substitution":
        return {**olay, "tur": "degisiklik", "giren": oyuncular[0] if oyuncular else "",
                "cikan": oyuncular[1] if len(oyuncular) > 1 else ""}
    return None   # başlama, gecikme, ikinci yarı başı vb.


def _kadro(r):
    oyuncular = r.get("roster") or []
    def bicim(p):
        a = p.get("athlete") or {}
        return {"no": str(p.get("jersey") or ""), "ad": a.get("displayName", ""),
                "poz": _mevki((p.get("position") or {}).get("abbreviation")),
                **({"cikti": True} if p.get("subbedOut") else {}),
                **({"girdi": True} if p.get("subbedIn") else {})}
    ilk = sorted((p for p in oyuncular if p.get("starter")),
                 key=lambda p: int(p.get("formationPlace") or 99))
    return {
        "dizilis": r.get("formation") or "",
        "ilk11": [bicim(p) for p in ilk],
        "yedek": [bicim(p) for p in oyuncular if not p.get("starter")],
    }


def detay_sadele(veri, lig_kodu):
    """ESPN summary yanıtı → veri/detay/{id}.json biçimi (ham yanıtla test edilebilsin diye ayrı)."""
    comp = ((veri.get("header") or {}).get("competitions") or [{}])[0]
    durum = comp.get("status") or {}
    tip = durum.get("type") or {}
    rakipler = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    ev, dep = rakipler.get("home") or {}, rakipler.get("away") or {}
    ev_id = str((ev.get("team") or {}).get("id") or "")
    asama = tip.get("state", "pre")
    kod = tip.get("name", "")
    ek_sure = kod in ("STATUS_FINAL_AET", "STATUS_FINAL_PEN", "STATUS_END_OF_EXTRATIME")

    olaylar = [o for o in (_olay(e, ev_id, ek_sure) for e in veri.get("keyEvents") or []) if o]

    istatistik = []
    takimlar = {str((t.get("team") or {}).get("id") or ""): t for t in (veri.get("boxscore") or {}).get("teams") or []}
    ev_st = {s.get("name"): s.get("displayValue") for s in (takimlar.get(ev_id) or {}).get("statistics") or []}
    dep_id = str((dep.get("team") or {}).get("id") or "")
    dep_st = {s.get("name"): s.get("displayValue") for s in (takimlar.get(dep_id) or {}).get("statistics") or []}
    for espn_ad, ad in DETAY_ISTATISTIK:
        if ev_st.get(espn_ad) not in (None, "") and dep_st.get(espn_ad) not in (None, ""):
            istatistik.append({"ad": ad, "ev": ev_st[espn_ad], "dep": dep_st[espn_ad]})

    kadro = {}
    for r in veri.get("rosters") or []:
        taraf = "ev" if str((r.get("team") or {}).get("id") or "") == ev_id else "dep"
        if r.get("roster"):
            kadro[taraf] = _kadro(r)

    bilgi = veri.get("gameInfo") or {}
    hakemler = bilgi.get("officials") or []
    oynandi = asama != "pre"
    return {
        "id": str(comp.get("id") or (veri.get("header") or {}).get("id") or ""),
        "lig": lig_kodu,
        "tarih": comp.get("date", ""),
        "durum": asama,
        "durum_kodu": kod,
        "dakika": durum.get("displayClock", "") if asama == "in" else "",
        "ev": _takim(ev),
        "dep": _takim(dep),
        "ev_skor": _skor(ev) if oynandi else None,
        "dep_skor": _skor(dep) if oynandi else None,
        # ESPN penaltı atışı olmayan maçta da 0 veriyor; yalnız penaltılarla biten maçta yazılır
        "ev_penalti": _sayi(ev.get("shootoutScore")) if kod == "STATUS_FINAL_PEN" else None,
        "dep_penalti": _sayi(dep.get("shootoutScore")) if kod == "STATUS_FINAL_PEN" else None,
        "stat": ((bilgi.get("venue") or {}).get("fullName") or ""),
        "hakem": (hakemler[0].get("displayName") or hakemler[0].get("fullName") or "") if hakemler else "",
        "olaylar": olaylar,
        "istatistik": istatistik,
        "kadro": kadro,
    }


def mac_detayi(lig_kodu, mac_id):
    """Maçın olayları, takım istatistikleri ve kadroları (ESPN summary)."""
    return detay_sadele(getir(f"{SITE}/{lig_kodu}/summary?event={mac_id}"), lig_kodu)
