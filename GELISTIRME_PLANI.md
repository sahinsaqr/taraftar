# Taraftar — Firebase, kullanıcı girişi ve Android uygulaması

Bu plan Claude Code tarafından bu klasörde adım adım uygulanacak. Her aşamanın sonunda
çalıştığını doğrula, commit et ve kullanıcıya kısa bir özet ver. Kullanıcının tarayıcıda
yapması gereken bir adım varsa (Firebase konsolu gibi) dur ve ona tam olarak neye
tıklayacağını Türkçe ve madde madde söyle.

Referans proje: `C:\Users\sahin\Documents\SUDOKU` aynı teknolojileri kullanıyor
(Capacitor 8, @capacitor-firebase eklentileri, Android). Kurulum ayrıntılarında,
sürüm numaralarında ve Gradle ayarlarında oraya bak ve aynı yolu izle.

## Genel yapı

```
ESPN ──► GitHub Actions (Python) ──► veri/*.json (GitHub Pages) ──► Uygulama (web + Android)
                     │
                     └──► Firebase Cloud Messaging (takım konuları) ──► Android bildirimi
Uygulama ──► Firebase Auth (misafir + Google) ──► Firestore: kullanicilar/{uid}
```

Değişmeyecek kurallar:
- Veri kaynağı geliştirme süresince ESPN. ESPN'e özgü her şey `arka_plan/espn.py` içinde
  kalır; uygulama ve bildirim kodu ESPN'i bilmez. (Yayın öncesi lisanslı API'ye geçilecek.)
- Web sürümü (GitHub Pages) çalışmaya devam eder. Aynı kod hem web hem Android'de çalışır.
- Gizli bilgiler (servis hesabı anahtarı, keystore, şifreler) asla depoya girmez.

## Kararlar

| Konu | Karar |
|---|---|
| Uygulama kimliği | `com.sahin.taraftar`, ad: `Taraftar` |
| Firebase projesi | Sudoku'dan **ayrı** yeni proje (ör. `futbol-takip-sahin`) |
| Giriş | İlk açılışta otomatik **misafir (anonymous)** hesabı. İsteyen **Google ile giriş** yapar; misafir hesap Google hesabına bağlanır (link), takımlar kaybolmaz. E-posta/şifre şimdilik yok. |
| Takım listesi | Girişliyken Firestore `kullanicilar/{uid}` belgesinde; cihazda da localStorage'da önbellek |
| Bildirim | FCM **konu (topic)** sistemi. Sunucu kimin neyi takip ettiğini bilmek zorunda değil. |
| Bildirim türleri | Her takım için 4 konu: `t{ID}_gol`, `t{ID}_mac` (başladı + devre arası), `t{ID}_son` (maç sonu, erteleme), `t{ID}_hat` (15 dk kala hatırlatma). Kullanıcı ayarlardan türleri açıp kapatır; uygulama ilgili konulara abone olur/çıkar. |
| Web'de bildirim | Şimdilik yok. Web'de giriş ve takım eşitleme çalışır; bildirim ayarları "Android uygulamasında" der. |
| Sunucu | Geliştirme süresince GitHub Actions'taki Python programı FCM'e gönderir (firebase-admin). Yayın öncesi Firebase Cloud Functions'a taşınacak. |

## Aşama 1 — Firebase projesi

1. `firebase` CLI ile giriş yapılmış mı kontrol et (Sudoku'da kullanılıyor). Yeni proje oluştur:
   `firebase projects:create futbol-takip-sahin --display-name "Taraftar"` (ad doluysa sonuna rakam ekle).
2. Projeye Android uygulaması (`com.sahin.taraftar`) ve Web uygulaması ekle
   (`firebase apps:create`). Android için `google-services.json`, web için config nesnesini al.
3. **Kullanıcıya bırakılacak konsol adımları** (CLI ile yapılamayanlar) — dur ve anlat:
   - Authentication → Get started → Sign-in method: **Anonymous** ve **Google**'ı etkinleştir
     (Google için destek e-postası seçilecek).
   - Firestore Database → Create database → konum `eur3 (europe-west)` → production mode.
   - Authentication → Settings → Authorized domains: `sahinsaqr.github.io` ve `taraftar.mlkcraft.com` ekle.
4. `firestore.rules`:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /kullanicilar/{uid} {
         allow read, delete: if request.auth != null && request.auth.uid == uid;
         allow create, update: if request.auth != null && request.auth.uid == uid
           && request.resource.data.keys().hasOnly(['takimlar', 'bildirim', 'guncelleme'])
           && request.resource.data.takimlar is list
           && request.resource.data.takimlar.size() <= 50;
       }
     }
   }
   ```
   `firebase.json`, `.firebaserc` oluştur ve `firebase deploy --only firestore:rules` ile yükle.
5. Belge biçimi `kullanicilar/{uid}`:
   ```json
   {
     "takimlar": [{"id": "432", "ad": "Galatasaray", "kisa": "GAL", "logo": "https://...", "lig": "tur.1"}],
     "bildirim": {"gol": true, "mac": true, "son": true, "hat": true},
     "guncelleme": "<serverTimestamp>"
   }
   ```

## Aşama 2 — Uygulamada giriş ve eşitleme (`bulut.js`)

Yeni dosya `bulut.js`: uygulamanın Firebase ile konuştuğu **tek** yer. Ortama göre iki uygulaması olsun,
dışarıya aynı arayüzü versin:

- **Android (Capacitor native):** `@capacitor-firebase/authentication`, `@capacitor-firebase/firestore`,
  `@capacitor-firebase/messaging` eklentileri (`window.Capacitor.Plugins` üzerinden, Sudoku'daki gibi).
- **Web:** Firebase JS SDK, gstatic CDN'den ES modülü olarak (`https://www.gstatic.com/firebasejs/<sürüm>/firebase-app.js` vb.),
  derleme aracı olmadan. Google girişi `signInWithPopup`.

Arayüz:
```js
Bulut.baslat()                    // misafir oturumu yoksa açar; kullanıcı nesnesini döner
Bulut.kullanici                   // { uid, misafir: bool, ad, eposta, foto }
Bulut.googleIleGiris()            // misafiri Google'a bağlar; hesap zaten varsa o hesaba geçer
Bulut.cikis()                     // çıkış → yeni misafir oturumu
Bulut.hesabiSil()                 // Firestore belgesi + Auth kullanıcısı (Play Store şartı)
Bulut.takimlariOku() / Bulut.takimlariYaz(liste)
Bulut.bildirimAyarlari() / Bulut.bildirimAyarlariYaz(ayar)
Bulut.abonelikleriEsitle(takimlar, ayar)   // sadece native; web'de hiçbir şey yapmaz
Bulut.bildirimIzniIste()          // Android 13+ izin penceresi
```

`app.js` değişiklikleri:
- Açılışta `Bulut.baslat()`; bulut listesi ile yerel liste **birleştirilir** (birleşim), sonra iki yere de yazılır.
- Takım ekle/çıkar → localStorage + `Bulut.takimlariYaz` + `Bulut.abonelikleriEsitle`.
- "Bildirim" sekmesi yerine **"Hesap"** sekmesi:
  - Üstte giriş durumu: misafir ise "Google ile giriş yap" düğmesi ve "Giriş yaparsan takımların tüm cihazlarında görünür" açıklaması; girişliyse ad/e-posta/fotoğraf, "Çıkış yap".
  - Bildirim ayarları: 4 anahtar (Goller, Maç başladı/devre arası, Maç sonucu, Maçtan 15 dk önce hatırlat). Web'de bunların yerine "Bildirimler Android uygulamasında" notu.
  - "Hesabımı sil" (onay penceresiyle; tarayıcı `confirm()` yerine sayfa içi onay kutusu kullan).
  - Gizlilik politikası bağlantısı.
- Veri adresi: native'de `https://taraftar.mlkcraft.com/`, web'de göreli yol. (GitHub Pages CORS'a izin veriyor.)
- `sw.js` sadece web'de kaydedilsin; native'de kaydedilmesin.
- Eski ntfy / `takip.json` arayüz metinleri kaldırılsın.

## Aşama 3 — Sunucu: FCM bildirimleri (`arka_plan/`)

1. `arka_plan/bildirim.py`: firebase-admin ile gönderim. Kimlik bilgisi `FIREBASE_HESAP` ortam değişkeninde
   (servis hesabı JSON'unun base64 hali). Yoksa sadece konsola yazsın.
   - Gönderim: `messaging.Message(topic=..., notification=Notification(title, body),
     android=AndroidConfig(priority='high', notification=AndroidNotification(channel_id='maclar', tag=<mac_id>)),
     data={'mac': id, 'tur': ...})`.
   - Her olay **iki takımın** ilgili konusuna gider (ev sahibi ve deplasman): ör. gol → `t432_gol` ve `t9999_gol`.
     Aynı mesajı iki kez almamak için tek gönderimde `condition="'t432_gol' in topics || 't9999_gol' in topics"` kullan.
2. `mac_izle.py`:
   - `takip.json` yerine **ayarlar.json'daki tüm liglerin tüm maçlarını** izle (sunucu kimin neyi takip ettiğini bilmiyor).
     Aynı lig ve gündeki maçlar zaten tek istekte geliyor; istek sayısı sadece canlı maçı olan lig sayısı kadar.
   - Olay → konu eşlemesi: hatırlatma `_hat`, başladı ve devre arası `_mac`, gol ve gol iptali `_gol`, maç sonu ve erteleme `_son`.
   - ntfy desteği isteğe bağlı kalsın (NTFY_KONU varsa takip.json'daki takımlar için eskisi gibi).
   - Uzun hafta sonlarında 5,5 saat sınırı dolunca görev biter, sıradaki zamanlanmış görev kaldığı yerden devam eder (canli.json durumu bunu sağlıyor). Bunu test et.
3. `futbol.yml`: `pip install firebase-admin` adımı ve `FIREBASE_HESAP: ${{ secrets.FIREBASE_HESAP }}`.
4. **Kullanıcıya bırakılacak adım:** Firebase konsolu → Project settings → Service accounts → Generate new private key.
   Dosyayı indirince Claude Code base64'e çevirip `gh secret set FIREBASE_HESAP` ile yükler ve **indirilen dosyayı siler**.

## Aşama 4 — Android uygulaması (Capacitor)

1. `package.json` oluştur (Sudoku'daki sürümlerle): `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
   `@capacitor/app`, `@capacitor-firebase/app`, `@capacitor-firebase/authentication`, `@capacitor-firebase/firestore`,
   `@capacitor-firebase/messaging`, geliştirme için `@capacitor/assets`.
2. `capacitor.config.json`: `appId: com.sahin.taraftar`, `appName: Taraftar`, `webDir: www`,
   FirebaseAuthentication eklentisinde `providers: ["google.com"]`.
3. `npm run kopyala` betiği: web dosyalarını (`index.html, app.js, bulut.js, style.css, manifest.webmanifest, ikonlar/`) `www/` içine kopyalar.
   `www/`, `node_modules/`, `android/app/google-services.json` dışındaki derleme çıktıları `.gitignore`'a.
4. `npx cap add android`, `google-services.json` → `android/app/`.
5. Bildirim kanalı: açılışta `FirebaseMessaging.createChannel({ id: 'maclar', name: 'Maç bildirimleri', importance: 5 })`.
   Bildirime dokununca uygulama açılsın ve ilgili takım kartına gitsin (data.mac).
6. **İkonlar:** `assets/` klasöründeki hazır dosyalarla `npx @capacitor/assets generate --android
   --iconBackgroundColor '#122a1f' --splashBackgroundColor '#0b1a13'`. Web ikonları (`ikonlar/`) zaten güncel.
7. Google girişi için debug SHA-1 parmak izini (`cd android && gradlew signingReport`) Firebase Android uygulamasına ekle
   (`firebase apps:android:sha:create`). Release/Play imzası yayın aşamasında eklenecek.
8. `cd android && gradlew assembleDebug` ile APK üret. APK'yı `C:\Users\sahin\Documents\Taraftar\cikti\Taraftar-debug.apk`
   olarak kopyala (bu klasör .gitignore'da). Kullanıcıya telefona nasıl kuracağını anlat
   (USB ile `adb install` veya dosyayı telefona atıp açma; "bilinmeyen kaynaklar" izni).

## Aşama 5 — Gizlilik ve Play Store hazırlığı (yayın öncesi, şimdi sadece taslak)

- `gizlilik.html` (Türkçe + İngilizce): toplanan veriler (anonim kimlik, isteğe bağlı Google hesabı adı/e-postası,
  takip edilen takımlar, bildirim belirteci), amaç, saklama, hesap silme yolu, iletişim: info@mlkcraft.com.
- Google Cloud konsolunda Firebase API anahtarlarını kısıtla (Android paket adı + SHA-1, web için `sahinsaqr.github.io` ve `taraftar.mlkcraft.com`).
- Yayından önce noindex ve robots.txt kaldırılacak (`index.html`'deki `<meta name="robots" content="noindex, nofollow">` ve kök dizindeki `robots.txt`).

## Dış tetikleyici (cron-job.org) — bakım

- GitHub zamanlaması seyrek tetiklendiği için cron-job.org 30 dk'da bir `futbol.yml` iş akışını
  `workflow_dispatch` ile başlatıyor (`{"ref":"main","inputs":{"mod":"otomatik"}}`). İzleyici zaten çalışıyorsa
  yeni çalışma `kontrol` işinden sonra hemen biter.
- Kimlik: GitHub fine-grained token, yalnız `sahinsaqr/taraftar`, yalnız "Actions: Read and write".
  Token yalnızca cron-job.org'daki işin `Authorization` başlığında durur; depoda ya da başka yerde yok.
- **Token süresi 1 Kasım 2027'de doluyor. ⏰ HATIRLATMA: 25 Ekim 2027'de (bir hafta önce) yenile:**
  GitHub → Settings → Developer settings → Fine-grained tokens → token → "Regenerate token" (1 yıl),
  yeni değeri cron-job.org'daki işin `Authorization: Bearer ...` başlığına yapıştır, ardından
  cron-job.org'da "Test run" ile 204 yanıtı ve GitHub Actions'ta yeni `workflow_dispatch` çalışmasını gör.
  Yeniledikten sonra bu tarihleri bir yıl ileri al.
- Belirti: cron-job.org geçmişinde 401/403 → token dolmuş/yanlış; 404 → dosya adı ya da izin yanlış; 422 → gövde/girdi yanlış.

## İzleyici devri (5,5 saat sınırı) — bakım

- İzleyici 5 sa 15 dk'da, izlenecek maç varsa `futbol.yml`'yi `mod=devir, onceki=<run id>` ile kendisi tetikler
  (`GITHUB_TOKEN`, `actions: write`). Yenisi hazır olunca `veri/devir.json`'a "hazir" yazar; eskisi son
  `canli.json`'u "devredildi" işaretiyle aynı commit'te gönderip kapanır, yenisi onu çekip devam eder (`arka_plan/devir.py`).
- Logda aranacak satırlar: eski izleyicide `Devir: yeni izleyici istendi → HTTP 204`, `Devir: yeni izleyici hazır`,
  `Devir: durum devredildi → {...}`; yenisinde `Devir: durum alındı (... sn bekledi) → {...}; devredenle AYNI`.
- Devir olmazsa (tetikleme hatası, yeni 3 dk'da hazır olmazsa) eski davranış: sınırda kapanır, sıradaki tetikleme devam eder.
- **Deneme:** Actions → "Taraftar verisi ve maç izleme" → Run workflow → `mod=otomatik`, `devir_testi_dk=10`.
  İzleyici maç olmasa da 10 dk bekleyip devreder; yeni çalışmaya bu girdi aktarılmaz, zincir bir devirden sonra durur.
- Bildirimler: gönderilemeyen olay işaretlenmez, `canli.json` → `bekleyenler` kuyruğunda her turda yeniden denenir
  (gol 10 dk, hatırlatma 3 dk, diğerleri 30 dk sonra vazgeçilir; logda `bildirim sırada` / `vazgeçildi`).
  Her başarılı FCM gönderimi `FCM ok (tür): projects/.../messages/...` satırıyla loglanır.

## Doğrulama listesi (her aşamadan sonra ilgili olanlar)

- [ ] Web: misafir açılış, takım ekleme, Google ile giriş, başka tarayıcıda aynı hesapla takımların görünmesi, çıkış, hesap silme.
- [ ] Firestore kuralları: başka bir uid'nin belgesi okunamıyor/yazılamıyor (emulator veya kurallar testi).
- [ ] Android: APK kuruluyor, ikon ve açılış ekranı doğru, veri geliyor, giriş çalışıyor, bildirim izni isteniyor.
- [ ] Bildirim testi: `arka_plan/` içine `test_bildirim.py` yaz; verilen takım konusuna örnek bir "GOL" bildirimi göndersin.
      Telefonda gelmeli; ayarlardan "Goller" kapatılınca gelmemeli.
- [ ] Gerçek maç: izleyici takip edilen takımın maçında başladı/gol/devre/son bildirimlerini gönderiyor, tekrar göndermiyor.
