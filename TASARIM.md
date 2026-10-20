# Taraftar — Tasarım kuralları

Uygulamanın görünümü 4 aşamada yeni tasarıma geçiyor. Her aşama bu dosyadaki kurallara uyar;
bir kural değişirse önce burası güncellenir.

| Aşama | Kapsam |
|---|---|
| 1 | Renkler, yazı tipleri, tema, 4 sekmeli alt menü, Profil ekranı (yapıldı) |
| 2 | Üst başlık kaldırıldı (aşağı çekip yenile), Maçlar ekranı: Geçmiş / Yaklaşan / Takvim (yapıldı) |
| 3–4 | Takımlar, Puan ekranları; takım bazında bildirim zili (3. aşama), takım sıralaması ayarının yeri (3. aşama), maç detayı (4. aşama) |

## Genel

- **Yazı tipleri:** Barlow (metin; 400/500/600/700) ve Barlow Condensed (skor, saat, başlık; 600/700).
  - Google Fonts CDN'den **değil**: woff2 dosyaları `yazitipleri/` klasöründe, `style.css` başındaki
    `@font-face` ile yüklenir. Uygulama internetsiz açılabilmeli ve Google'a istek gitmemeli.
  - Her ağırlık için iki dosya var: `latin` ve `latin-ext` (ğ, ş, ı, İ latin-ext'te); `unicode-range`
    ile tarayıcı yalnızca gerekeni indirir. Kaynak: @fontsource 5.3.0. Lisans: `yazitipleri/OFL.txt`.
  - CSS'te: `var(--yazi-tipi)` metin, `var(--yazi-tipi-dar)` skor/saat/başlık. Sayılar `tabular-nums`.
- **Takım logoları:** gerçek logolar (ESPN) kullanılır. Logo yoksa ya da yüklenemezse yedek:
  kulüp renginde (`renk`, ESPN `color`) yuvarlak + kısaltma (`kisa`, ESPN `abbreviation`).
  Yazı rengi `renk2` (ESPN `alternateColor`) zeminle en az 4.5:1 kontrast veriyorsa odur,
  yoksa beyaz ya da #1B2D4B'den kontrastı yüksek olanı. Renk yoksa ikinci zemin + ikincil metin.
  Bu iş `app.js` → `logoHtml()` içinde; yeni ekranlar logo için hep onu kullanır.
- **Dokunma hedefleri** en az 44×44 px. **Yazı kontrastı** en az 4.5:1 (küçük yazı dahil).
- Simgeler ince çizgili SVG (`stroke="currentColor"`, `stroke-width` 1.75–2, dolgu yok). Emoji simge olarak kullanılmaz.

## Renkler

Hepsi `style.css` başında CSS değişkeni. Ekranlar renk kodu yazmaz, değişken kullanır.
`:root` koyu temadır, `:root[data-tema="acik"]` açık temadır.

| Değişken | Anlamı | Koyu (lacivert) | Açık |
|---|---|---|---|
| `--zemin` | sayfa zemini | #1B2D4B | #EEF2F8 |
| `--yuzey` | kart | #2F4B78 | #FFFFFF |
| `--cizgi` | kart kenarı, ayırıcı çizgi | #46689A | #C9D4E3 |
| `--menu-zemin` | alt menü | #1F3352 | #FFFFFF |
| `--menu-cizgi` | alt menü üst çizgisi | #3D5A86 | #C9D4E3 |
| `--yuzey-2` | ikinci zemin (kart içi kutu, bölmeli seçici) | #24395C | #E3E9F2 |
| `--yazi` | ana metin | #EEF2F7 | #1B2D4B |
| `--yazi-2` | ikincil metin | #B0BED2 | #4A5D7A |
| `--yazi-soluk` | soluk metin | #DCE3EE | #33476A ¹ |
| `--vurgu-zemin` | lime: düğme, seçili sekme/çip, anahtar dolgusu | #C8F04A | #C8F04A |
| `--vurgu-zemin-yazi` | lime üstündeki yazı | #1B2D4B | #1B2D4B |
| `--vurgu` | vurgulu yazı, seçili alt menü sekmesi | #C8F04A | #3F6B00 ² |
| `--canli` | canlı rozet zemini, canlı nokta | #FF6B4A | #FF6B4A |
| `--canli-zemin-yazi` | canlı rozet üstündeki yazı | #1B2D4B | #1B2D4B |
| `--canli-yazi` | canlı yazı | #FFAA96 | #C4391B |
| `--satir-g` | galibiyet satırı | #3B7158 | #DDEFD9 |
| `--satir-m` | mağlubiyet satırı | #5C3A52 | #F5DDE3 |
| `--satir-b` | beraberlik satırı | = kart (#2F4B78) | = kart (#FFFFFF) |
| `--tehlike-yazi` | "Hesabımı sil" gibi yıkıcı işlem yazısı | #FF8B70 | #C4391B |

¹ Açık temada soluk metin tasarımda verilmedi; #33476A seçildi (beyaz üstünde ~9:1).
² Açık zeminde lime **yazı** okunmaz; açıkta vurgulu yazı için hep `--vurgu` (#3F6B00) kullanılır, lime yalnız zemin olur.

**Sonuç rozeti** (iki temada aynı). Sonuç yalnız satır rengine bırakılmaz, rozet de gösterilir.

| Rozet | Zemin | Yazı |
|---|---|---|
| G | #C8F04A (`--rozet-g`) | #1B2D4B |
| B | #4D6890 (`--rozet-b`) | #EEF2F7 |
| M | #FF6B4A (`--rozet-m`) | #1B2D4B |

Kontrast notları (ölçülen):
- Koyu kartta (#2F4B78) ikincil metin #B0BED2 4.65:1, canlı yazı #FFAA96 4.77:1 — sınırda; kartın daha açık bir tonuna koyma.
- #FF8B70 kart üstünde 3.83:1 (geçmez); bu yüzden "Hesabımı sil" kartın içinde değil, sayfa zemininde (6.02:1).
- Koyu temada galibiyet satırında (#3B7158) ikincil metin 3.02:1 (geçmez); bu satırlarda yalnız ana metin kullan (5.06:1).
- Açık temada canlı yazı #C4391B ikinci zeminde (#E3E9F2) 4.36:1 (geçmez); yalnız kart (beyaz, 5.32:1) üstünde kullan.
- Canlı rozet (#1B2D4B / #FF6B4A) 4.89:1, B rozeti 5.05:1.

## Derinlik

Kartlar düz görünmez: gradyan, üst kenarda ışık ve yumuşak gölge. Hepsi `style.css` başında değişken;
yeni bir kart `.kart` sınıfını (ya da `background: var(--yuzey) var(--kart-zemin); box-shadow: var(--kart-golge)`) kullanır.

| Değişken | Koyu | Açık |
|---|---|---|
| `--kart-zemin` | gradyan #304C79 → #283F68 ¹ | düz beyaz (`--yuzey`) |
| `--kart-golge` | `inset 0 1px 0 rgba(255,255,255,.08)`, `0 1px 2px` + `0 8px 18px rgba(5,12,25,.35)` | `0 1px 2px rgba(27,45,75,.08)`, `0 8px 20px rgba(27,45,75,.10)`; ince kenar korunur |
| `--kart-golge-basili` | basılıyken küçülmüş gölge | aynı mantık |
| `--satir-g-zemin` | #3E765C → #346650 | #E4F3E0 → #D3E8CE |
| `--satir-m-zemin` | #62405A → #523348 | #F8E6EA → #EFD3DA |
| `--canli-parlama` | `0 0 0 1px` canlı rengi, `0 6px 18px rgba(255,107,74,.25)` | aynı |
| `--gomuk` | içe gömük seçici zemini (inset gölge) | daha hafif |
| `--kabarik` | seçili lime sekme | daha hafif |
| `--kucuk-golge` | G/B/M rozetleri, takvimde seçili gün | daha hafif |
| `--menu-golge` | alt menünün üstünde yukarı gölge | daha hafif |
| `--logo-kenar` | ince açık kenar + hafif gölge | ince koyu kenar + hafif gölge (beyaz logolar kaybolmasın) |

¹ Örnek olarak verilen #34527F üst ton, koyu kartın üstündeki ikincil metni (#B0BED2) 4.19:1'e düşürüyor.
4.5:1'i koruyan en açık ton #304C79 (4.57:1); derinliği alttaki koyulaşma, üst ışık ve gölge verir.
Galibiyet satırının açık ucu #3E765C'de ana metin 4.73:1.

Kurallar:
- Kart türleri: maç kartları, Geçmiş/Takvim satırları, takvim kartı, Profil kartları, Puan tablosu kutusu, G/B/M kutuları,
  Takım ekle'deki takım düğmeleri. Galibiyet/mağlubiyet satırları da aynı gölgeyi ve kendi renginde gradyanı alır.
- Canlı maç kartı/satırı: turuncu kenar + `--canli-parlama`.
- Basılabilir kart: `.basilabilir` (dokununca `scale(.98)`, gölge `--kart-golge-basili`, 120 ms).
  Şimdilik Takım ekle'deki takım düğmeleri; maç kartı detay açılınca (4. aşama) alır. Basınca bir şey olmayan karta verilmez.
- `prefers-reduced-motion: reduce` açıksa basılma, nokta yanıp sönmesi ve yenileme dönüşü animasyonsuz.
- Kaydırma akıcılığı: büyük blur yok (en fazla 18–20px gölge), `backdrop-filter` yok, kartlara `will-change` verilmez.
- Kontrol: gradyan üzerindeki yazı iki uçta da 4.5:1 (ekran görüntüsü betiği gradyan duraklarını da ölçer).

## Tema

- Profil → Görünüm: **Sistem / Açık / Koyu** (varsayılan Sistem). Seçim `localStorage` `ft_tema`'da.
- `index.html`'deki küçük betik ilk çizimden önce `data-tema`'yı ve `theme-color`'ı ayarlar (yanıp sönmesin);
  `app.js` → `temaUygula()` aynısını yapar ve Android durum çubuğu simge rengini ayarlar.
- Durum çubuğu / web `theme-color` / açılış ekranı zemini: koyu #1B2D4B, açık #EEF2F8.
  - Android açılış ekranı uygulama açılmadan gösterildiği için **cihazın** açık/koyu ayarını izler
    (`values/tema.xml`, `values-night/tema.xml`, `drawable(-night)/splash.png`).
  - Açılış görseli kaynakları: `assets/splash.svg` (açık), `assets/splash-dark.svg` (koyu).
    Android ikon ve açılış ekranları `npx @capacitor/assets generate --android` ile üretilir
    (ikon zemini lime, `assets/icon-background.png`; `values/ic_launcher_background.xml` #C8F04A). Bu komut AndroidManifest.xml'i yeniden biçimlendiriyor;
    `git checkout` ile toptan geri alma, manifest'te bekleyen kendi değişikliklerini de siler — önce `git diff`'e bak.
  - Uygulama ikonu `ikonlar/` (web) ve `assets/` (Android kaynakları); bildirim çubuğu ikonu
    `drawable-*dpi/ic_stat_taraftar.png` (beyaz, saydam zemin), rengi `values/bildirim.xml` → #C8F04A.
  - Uygulama açıldıktan sonra durum/gezinme çubuğu bölgesi pencere zeminini gösterir (Capacitor 8 SystemBars
    pencereye dolgu verir). `temaUygula()` bu zemini `MainActivity`'deki küçük `Zemin` eklentisiyle
    (`ZeminPlugin.java`) uygulamanın seçili temasına çevirir; böylece cihaz koyu, uygulama açık olsa da uyar.

## Alt menü

4 sekme, her ekranda aynı: **Maçlar · Takımlar · Puan · Profil**. Uygulama Maçlar ile açılır.
- Seçili sekme `--vurgu`, diğerleri `--yazi-2`. Simgeler ince çizgili SVG.
- Takım ekle ayrı sekme değil: Takımlar ekranının sağ üstündeki "Takım ekle" düğmesiyle açılır,
  bu sırada alt menüde Takımlar seçili kalır. Geri tuşu Takım ekle'den Takımlar'a döner;
  diğer sekmelerden Maçlar'a, Maçlar'dan uygulamayı arka plana alır.
- Ekran başlıklarında **Ara ve Bildirim düğmesi yok.**

## Üst başlık ve yenileme

- Ortak üst şerit (logo + "Taraftar" + yenile + "Veri: x önce") **yok**; çift başlık olmaz.
- Maçlar'da başlık büyük **TARAFTAR** (Barlow Condensed 700): "TARAF" `--yazi`, "TAR" `--vurgu` (`.logo-baslik`).
  Diğer ekranlarda yalnız ekranın kendi başlığı (`.ekran-baslik`: Takımlarım, Puan durumu, Profil).
- Yenileme: sayfanın en üstündeyken aşağı çek (app.js "Aşağı çekip yenile"; gösterge `#cekYenile`).
  Tarayıcının kendi çek-yenile'si `overscroll-behavior-y: none` ile kapalı. Yatay kaydırma çekme sayılmaz.
- "Veri: x önce" Profil > Hakkında > Veriler satırında. Veri 3 saatten eskiyse Maçlar'ın üstünde
  uyarı şeridi: "Veriler güncel değil · x saat önce" (`.eski-veri`).
- Durum çubuğunun arkası `body::before` ile zemin rengindedir (içerik altından kayarken görünmesin).
- Alt menüde Maçlar simgesi top: daire içinde beşgen, ince çizgi.

## Maçlar ekranı

Başlığın altında 3 sekmeli seçici (`.bolmeli.uc`): **Geçmiş | Yaklaşan (varsayılan) | Takvim** (takvim simgeli).
Seçili sekme lime zemin + koyu yazı. Geri tuşu Geçmiş/Takvim'den önce Yaklaşan'a döner.

- **Yaklaşan:** takip edilen takımların maçları; önce canlı (önce başlayan üstte), sonra başlama saatine göre.
  Biten maç düşer. Her maç ayrı kart (`.mac-kart`): üstte ortada "Lig · N. Hafta"; ev sahibi solda, deplasman sağda
  (logo üstte, ad altta); ortada gün ("Bugün", "Yarın", "Cmt 25 Eki") ve büyük saat. Bugünün saati `--vurgu`.
  Canlı kart: ortada büyük skor "2 : 1", sağ üstte turuncu "● CANLI · 67'" rozeti (nokta yanıp söner),
  altta ilerleme çubuğu (90 dk'ya göre, devre arası %50). Karta basınca şimdilik bir şey olmaz (maç detayı 4. aşamada).
- **Hafta:** ESPN hafta/tur vermiyor. Lig dosyasındaki sezon maçları tarihe göre sıralanıp her takımın o ligdeki
  kaçıncı maçı olduğu sayılır (iki takımdan büyüğü). Ertelenip ileri atılan maçlarda bir kayabilir.
  Lig için en fazla 2×(takım−1), UEFA için 8 (lig aşaması); üstündeyse hafta yazılmaz.
- **Geçmiş:** üstte takım seçici: "Tümü" + takımlar Takımlarım sırasıyla; 5 veya daha az takımda yatay çipler
  (logo + ad), fazlasında açılır liste. Tek takım seçiliyken G/B/M kutuları (zemin: galibiyet satırı / kart /
  mağlubiyet satırı); "Tümü"de görünmez. "SON MAÇLAR" satırları (`.sonuc-satir`): üstte rozet + tarih, sağda lig;
  altta logo · ev sahibi · skor · deplasman · logo (adlar skora yakın). Satır zemini sonuç rengi; bu satırlarda yalnız
  `--yazi`. "Tümü"de takip edilen iki takımın maçı bir kez, normal renkte ve rozetsiz.
- **Takvim:** aylık kart; ay adı ortada büyük harf, iki yanda 44px oklar; hafta pazartesiden (Pt Sa Ça Pe Cu Ct Pz).
  Bugün `--vurgu` çerçeve, seçili gün lime dolgu + koyu yazı, maçlı gün rakamı kalın. Maç başına nokta:
  oynanmış = sonuç rengi (G lime, B açık gri, M turuncu; açık temada lime noktanın koyu yeşil kenarı var),
  oynanacak = içi boş halka, canlı = yanıp sönen turuncu; seçili günde noktalar koyu. Altında açıklama.
  Güne basınca "BUGÜN · 20 EKİM SALI" başlığı ve o günün maçları: bitmiş = skor + rozet + "Bitti · Lig" (sonuç
  renginde), canlı = skor + "CANLI · dk" (turuncu çerçeve), oynanmamış = saat + lig. Maç yoksa
  "Bu gün takımlarının maçı yok". Ay değişince seçili gün o ayın 1'i (bu aysa bugün).

## Profil ekranı

Yukarıdan aşağı kartlar:
1. **Hesap** — avatar (Google fotoğrafı, yoksa lime zeminde baş harf), ad, e-posta,
   "Google ile bağlı · takımların eşitleniyor", Çıkış yap. Misafirde "Google ile giriş yap" + kısa açıklama.
2. **Bildirimler** (yalnız Android) — 4 anahtar (`role="switch"`), her birinin altında bir satır açıklama:
   Goller / Maç başladı · devre arası / Maç sonucu / Maçtan önce hatırlatma.
   Bildirim izni yoksa üstte izin isteme düğmesi. Takım bazında zil notu 3. aşamada eklenecek.
3. **Görünüm** — Sistem / Açık / Koyu (seçili olan lime zemin). Takım sıralaması (Elle/Otomatik/Karışık)
   geçici olarak burada; yeri 3. aşamada belirlenecek.
4. **Hakkında** — Gizlilik politikası (mlkcraft.com/privacy#taraftar), Geri bildirim gönder (info@mlkcraft.com),
   Veriler (son veri zamanı), Sürüm (`package.json` → `version`).
5. En altta, kartın dışında: **Hesabımı sil** (çerçeveli, `--tehlike-yazi`) ve altında
   "Takım listen, bildirim ayarların ve hesabın kalıcı olarak silinir." Onay penceresi aynen kalır.

## Kontrol listesi (her aşamada)

- 390×844'te her ekranın açık ve koyu ekran görüntüsü, kontrast kontrolü.
- Geri tuşu davranışı.
- `sw.js` → `SURUM` artırılır; yeni dosya eklendiyse `sw.js` `KABUK` ve `kopyala.mjs` `DOSYALAR` listelerine de eklenir.
- `npx cap sync`, APK derle, `adb install -r` (veriler silinmez).
