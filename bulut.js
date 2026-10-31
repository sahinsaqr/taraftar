/* Bulut — uygulamanın Firebase ile konuştuğu tek yer.

   İki uygulaması var, dışarıya aynı arayüzü verir:
   - Android (Capacitor): @capacitor-firebase eklentileri (window.Capacitor.Plugins)
   - Web: Firebase JS SDK, gstatic CDN'den ES modülü olarak (derleme aracı yok)

   Giriş yalnız Google ile (misafir/anonim oturum yok; Firestore kuralları yalnız sahibin uid'sine izin verir).
   Firestore: kullanicilar/{uid} = { takimlar: [...], bildirim: {gol, mac, son, hat}, guncelleme }
   takimlar[i] = { id, ad, kisa, logo, lig, renk?, renk2?, zil? }  (zil: false = o takımın bildirimleri kapalı)
   Bildirim konuları (yalnız Android): t{takımID}_{tür}, tür = gol | mac | son | hat;
   skor kartı görünümünde gol/mac/son yerine t{takımID}_{tür}k (golk | mack | sonk)
   Her tür kendi kanalına gelir: goller, mac_durumu, mac_sonucu, hatirlatma_sesli (KANALLAR) */

import { FIREBASE_AYAR } from './firebase-ayar.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const ZAMAN_ASIMI = 12000;
const KONU_DEPO = 'ft_konular';   // cihazın abone olduğu konular (fark hesabı için)
export const BILDIRIM_TURLERI = ['gol', 'mac', 'son', 'hat'];
// gorunum: 'metin' (sade metin, FCM bildirim mesajı) | 'kart' (skor kartı: …k konuları, veri mesajı, yerel kod çizer)
export const VARSAYILAN_BILDIRIM = { gol: true, mac: true, son: true, hat: true, gorunum: 'metin' };
const KART_TURLERI = new Set(['gol', 'mac', 'son']);   // hatırlatma her iki görünümde metin
/** Android bildirim kanalları (arka_plan/bildirim.py → KANAL ile aynı kimlikler; TASARIM.md > Bildirimler).
    importance: 4 = yüksek (ekranın üstünde açılır), 3 = normal (varsayılan ses). */
const KANALLAR = [
  { id: 'goller', name: 'Goller', description: 'Takımlarının attığı ve yediği goller, iptal edilen goller',
    importance: 4, sound: 'gol_sesi.ogg', vibration: true, visibility: 1, lights: true, lightColor: '#C8F04A' },
  { id: 'mac_durumu', name: 'Maç başladı · devre arası', description: 'Maçın başlaması ve devre arası skoru',
    importance: 3, vibration: true, visibility: 1 },
  { id: 'mac_sonucu', name: 'Maç sonucu · ertelemeler', description: 'Maç bitince skor; ertelenen ya da durdurulan maçlar',
    importance: 3, vibration: true, visibility: 1 },
  // ilk sürümde 'hatirlatma' düşük önem/sessizdi; kanalın sesi sonradan değişmediği için yeni kimlik
  { id: 'hatirlatma_sesli', name: 'Maçtan önce hatırlatma', description: 'Maç başlamadan 15 dakika önce',
    importance: 3, vibration: true, visibility: 1 },
];
const ESKI_KANALLAR = ['maclar', 'hatirlatma'];   // uygulama açılınca silinir

function zamanAsimi(soz, ms = ZAMAN_ASIMI) {
  let z;
  return Promise.race([soz, new Promise((_, red) => { z = setTimeout(() => red(new Error('zaman aşımı')), ms); })])
    .finally(() => clearTimeout(z));
}
// Android eklentisi hata kodunu cihaz diliyle küçültüyor; Türkçede "auth/credentıal-already-ın-use"
// gelir. Noktasız ı'lar i'ye çevrilmezse aşağıdaki desenler eşleşmez.
const hataMetni = (h) => `${h?.code || ''} ${h?.message || ''}`.replace(/ı/g, 'i').replace(/İ/g, 'I');
const iptalMi = (h) => /cancel|popup-closed|user-cancelled/i.test(hataMetni(h));

function kullaniciBicim(u) {
  if (!u) return null;
  // Ad/fotoğraf kullanıcıda boş kalabiliyor (Android eklentisi); o zaman Google sağlayıcı bilgisinden alınır.
  const google = (u.providerData || []).find((p) => p.providerId === 'google.com') || {};
  return {
    uid: u.uid,
    ad: u.displayName || google.displayName || '',
    eposta: u.email || google.email || '',
    foto: u.photoUrl || u.photoURL || google.photoUrl || google.photoURL || '',
  };
}

function belgeBicim(veri) {
  return {
    bos: !veri,   // belge henüz yok
    takimlar: Array.isArray(veri?.takimlar) ? veri.takimlar : [],
    bildirim: { ...VARSAYILAN_BILDIRIM, ...(veri?.bildirim || {}) },
  };
}

// ------------------------------------------------------------------ Android
class YerelBulut {
  constructor(P) {
    this.auth = P.FirebaseAuthentication;
    this.db = P.FirebaseFirestore;
    this.mesaj = P.FirebaseMessaging || null;
    this.yerel = true;
    this.kullanici = null;
  }

  async baslat() {
    let { user } = await zamanAsimi(this.auth.getCurrentUser());
    // eski sürümlerden kalan misafir oturumu kapatılır; oturum yoksa uygulama Google girişi ister
    if (user?.isAnonymous) { await this.auth.signOut().catch(() => {}); user = null; }
    this.kullanici = kullaniciBicim(user);
    if (this.mesaj) {
      // Kanal ayarları (önem, ses) kanal ilk oluşturulunca sabitlenir; değiştirmek gerekirse yeni kanal kimliği ver
      for (const k of KANALLAR) this.mesaj.createChannel(k).catch(() => {});
      for (const id of ESKI_KANALLAR) this.mesaj.deleteChannel({ id }).catch(() => {});
    }
    return this.kullanici;
  }

  async googleIleGiris() {
    try {
      const { user } = await this.auth.signInWithGoogle();
      this.kullanici = kullaniciBicim(user);
      return { durum: 'girildi', kullanici: this.kullanici };
    } catch (h) {
      if (iptalMi(h)) return { durum: 'iptal' };
      throw h;
    }
  }

  async cikis() {
    await this.auth.signOut();
    this.kullanici = null;
  }

  async hesabiSil() {
    const yol = `kullanicilar/${this.kullanici.uid}`;
    await zamanAsimi(this.db.deleteDocument({ reference: yol }));
    try {
      await zamanAsimi(this.auth.deleteUser());
    } catch (h) {
      // Google hesaplarında yakın zamanda giriş gerekebilir
      if (!/recent-login/i.test(hataMetni(h))) throw h;
      await this.auth.signInWithGoogle();
      await zamanAsimi(this.auth.deleteUser());
    }
    await this.auth.signOut().catch(() => {});
    this.kullanici = null;
  }

  async belgeOku() {
    const { snapshot } = await zamanAsimi(this.db.getDocument({ reference: `kullanicilar/${this.kullanici.uid}` }));
    return belgeBicim(snapshot?.data);
  }

  async belgeYaz(veri) {
    await zamanAsimi(this.db.setDocument({
      reference: `kullanicilar/${this.kullanici.uid}`,
      data: { ...veri, guncelleme: { __type__: 'serverTimestamp' } },
      merge: true,
    }));
  }

  async abonelikleriEsitle(takimlar, ayar) {
    if (!this.mesaj) return;
    const istenen = new Set();
    // zili kapalı takımın (zil: false) hiçbir konusuna abone olunmaz; açılınca türlere göre yeniden abone olur.
    // Skor kartı görünümünde gol/mac/son için t{ID}_{tür}k konuları (görünüm değişince eskilerden çıkılır).
    const ek = (tur) => (ayar.gorunum === 'kart' && KART_TURLERI.has(tur) ? 'k' : '');
    for (const t of takimlar) {
      if (t.zil === false) continue;
      for (const tur of BILDIRIM_TURLERI) if (ayar[tur]) istenen.add(`t${t.id}_${tur}${ek(tur)}`);
    }
    let mevcut;
    try { mevcut = new Set(JSON.parse(localStorage.getItem(KONU_DEPO) || '[]')); } catch { mevcut = new Set(); }
    const islemler = [];
    for (const k of istenen) if (!mevcut.has(k)) islemler.push(this.mesaj.subscribeToTopic({ topic: k }).then(() => mevcut.add(k)));
    for (const k of mevcut) if (!istenen.has(k)) islemler.push(this.mesaj.unsubscribeFromTopic({ topic: k }).then(() => mevcut.delete(k)));
    await Promise.allSettled(islemler);
    try { localStorage.setItem(KONU_DEPO, JSON.stringify([...mevcut])); } catch { /* yok say */ }
  }

  async bildirimIzni() {
    if (!this.mesaj) return null;
    const { receive } = await this.mesaj.checkPermissions();
    return receive;
  }

  async bildirimIzniIste() {
    if (!this.mesaj) return false;
    const { receive } = await this.mesaj.requestPermissions();
    return receive === 'granted';
  }

  bildirimeDokununca(fn) {
    this.mesaj?.addListener('notificationActionPerformed', (e) => fn(e?.notification?.data || {}));
  }

  // Uygulama ön plandayken Android bildirimi çekmeceye koymaz; uygulama kendisi gösterir
  bildirimGelince(fn) {
    this.mesaj?.addListener('notificationReceived', (e) => fn(e?.notification || {}));
  }
}

// ------------------------------------------------------------------ Web
class WebBulut {
  constructor() {
    this.yerel = false;
    this.kullanici = null;
  }

  async baslat() {
    const [app, auth, fs] = await zamanAsimi(Promise.all([
      import(`${SDK}firebase-app.js`), import(`${SDK}firebase-auth.js`), import(`${SDK}firebase-firestore.js`),
    ]));
    this.a = auth;
    this.f = fs;
    const uygulama = app.initializeApp(FIREBASE_AYAR);
    this.auth = auth.getAuth(uygulama);
    this.db = fs.getFirestore(uygulama);
    await zamanAsimi(this.auth.authStateReady());
    // eski sürümlerden kalan misafir oturumu kapatılır; oturum yoksa uygulama Google girişi ister
    if (this.auth.currentUser?.isAnonymous) await auth.signOut(this.auth).catch(() => {});
    this.kullanici = kullaniciBicim(this.auth.currentUser);
    return this.kullanici;
  }

  async googleIleGiris() {
    const { a } = this;
    try {
      const { user } = await a.signInWithPopup(this.auth, new a.GoogleAuthProvider());
      this.kullanici = kullaniciBicim(user);
      return { durum: 'girildi', kullanici: this.kullanici };
    } catch (h) {
      if (iptalMi(h)) return { durum: 'iptal' };
      throw h;
    }
  }

  async cikis() {
    await this.a.signOut(this.auth);
    this.kullanici = null;
  }

  async hesabiSil() {
    const { a, f } = this;
    await zamanAsimi(f.deleteDoc(f.doc(this.db, 'kullanicilar', this.kullanici.uid)));
    const u = this.auth.currentUser;
    try {
      await a.deleteUser(u);
    } catch (h) {
      if (!/recent-login/i.test(hataMetni(h))) throw h;
      await a.reauthenticateWithPopup(u, new a.GoogleAuthProvider());
      await a.deleteUser(u);
    }
    await a.signOut(this.auth).catch(() => {});
    this.kullanici = null;
  }

  async belgeOku() {
    const { f } = this;
    const s = await zamanAsimi(f.getDoc(f.doc(this.db, 'kullanicilar', this.kullanici.uid)));
    return belgeBicim(s.exists() ? s.data() : null);
  }

  async belgeYaz(veri) {
    const { f } = this;
    await zamanAsimi(f.setDoc(f.doc(this.db, 'kullanicilar', this.kullanici.uid),
      { ...veri, guncelleme: f.serverTimestamp() }, { merge: true }));
  }

  async abonelikleriEsitle() { /* web'de bildirim yok */ }
  async bildirimIzni() { return null; }
  async bildirimIzniIste() { return false; }
  bildirimeDokununca() { /* web'de bildirim yok */ }
  bildirimGelince() { /* web'de bildirim yok */ }
}

// ------------------------------------------------------------------ dış arayüz
function olustur() {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.() && cap.isPluginAvailable?.('FirebaseAuthentication')) {
    return new YerelBulut(cap.Plugins);
  }
  return new WebBulut();
}
const ic = olustur();

export const Bulut = {
  /** Uygulama Android'de mi çalışıyor */
  get yerel() { return ic.yerel; },
  /** { uid, ad, eposta, foto } ya da null (oturum yok ya da henüz bağlanmadı) */
  get kullanici() { return ic.kullanici; },

  /** Var olan Google oturumunu yükler; oturum yoksa null döner (misafir oturumu açılmaz) */
  baslat: () => ic.baslat(),
  /** Google ile giriş -> { durum: 'girildi' | 'iptal', kullanici } */
  googleIleGiris: () => ic.googleIleGiris(),
  /** Çıkış yapar; kullanıcı null olur */
  cikis: () => ic.cikis(),
  /** Firestore belgesini ve Auth kullanıcısını siler, oturumu kapatır */
  hesabiSil: () => ic.hesabiSil(),

  takimlariOku: async () => (await ic.belgeOku()).takimlar,
  takimlariYaz: (liste) => ic.belgeYaz({ takimlar: liste }),
  bildirimAyarlari: async () => (await ic.belgeOku()).bildirim,
  bildirimAyarlariYaz: (ayar) => ic.belgeYaz({ bildirim: ayar }),
  /** Tek okumada ikisi birden: { bos, takimlar, bildirim } */
  belgeOku: () => ic.belgeOku(),
  /** { takimlar?, bildirim? } alanlarını birlikte yazar */
  belgeYaz: (veri) => ic.belgeYaz(veri),

  /** Takım × açık bildirim türü konularına abone olur, fazlalardan çıkar (sadece Android) */
  abonelikleriEsitle: (takimlar, ayar) => ic.abonelikleriEsitle(takimlar, ayar),
  /** Bildirim izni: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'; web'de null */
  bildirimIzni: () => ic.bildirimIzni(),
  /** Android 13+ bildirim izni penceresi; izin verildiyse true */
  bildirimIzniIste: () => ic.bildirimIzniIste(),
  /** Bildirime dokunulunca fn(data) çağrılır (data.mac = maç kimliği) */
  bildirimeDokununca: (fn) => ic.bildirimeDokununca(fn),
  /** Uygulama açıkken bildirim gelince fn({ title, body, data }) çağrılır */
  bildirimGelince: (fn) => ic.bildirimGelince(fn),
};
