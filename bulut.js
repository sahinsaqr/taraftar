/* Bulut — uygulamanın Firebase ile konuştuğu tek yer.

   İki uygulaması var, dışarıya aynı arayüzü verir:
   - Android (Capacitor): @capacitor-firebase eklentileri (window.Capacitor.Plugins)
   - Web: Firebase JS SDK, gstatic CDN'den ES modülü olarak (derleme aracı yok)

   Firestore: kullanicilar/{uid} = { takimlar: [...], bildirim: {gol, mac, son, hat}, guncelleme }
   Bildirim konuları (yalnız Android): t{takımID}_{tür}, tür = gol | mac | son | hat */

import { FIREBASE_AYAR } from './firebase-ayar.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const ZAMAN_ASIMI = 12000;
const KONU_DEPO = 'ft_konular';   // cihazın abone olduğu konular (fark hesabı için)
export const BILDIRIM_TURLERI = ['gol', 'mac', 'son', 'hat'];
export const VARSAYILAN_BILDIRIM = { gol: true, mac: true, son: true, hat: true };

function zamanAsimi(soz, ms = ZAMAN_ASIMI) {
  let z;
  return Promise.race([soz, new Promise((_, red) => { z = setTimeout(() => red(new Error('zaman aşımı')), ms); })])
    .finally(() => clearTimeout(z));
}
// Android eklentisi hata kodunu cihaz diliyle küçültüyor; Türkçede "auth/credentıal-already-ın-use"
// gelir. Noktasız ı'lar i'ye çevrilmezse aşağıdaki desenler eşleşmez.
const hataMetni = (h) => `${h?.code || ''} ${h?.message || ''}`.replace(/ı/g, 'i').replace(/İ/g, 'I');
const iptalMi = (h) => /cancel|popup-closed|user-cancelled/i.test(hataMetni(h));
const hesapVarMi = (h) => /already-in-use|account-exists|credential-already|already associated with a different user/i.test(hataMetni(h));

function kullaniciBicim(u) {
  if (!u) return null;
  // Misafir hesap Google'a bağlanınca ad/fotoğraf kullanıcıda boş kalabiliyor
  // (Android eklentisi); o zaman Google sağlayıcı bilgisinden alınır.
  const google = (u.providerData || []).find((p) => p.providerId === 'google.com') || {};
  return {
    uid: u.uid,
    misafir: !!u.isAnonymous,
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
    if (!user) ({ user } = await zamanAsimi(this.auth.signInAnonymously()));
    this.kullanici = kullaniciBicim(user);
    if (this.mesaj) {
      this.mesaj.createChannel({ id: 'maclar', name: 'Maç bildirimleri', importance: 5 }).catch(() => {});
    }
    return this.kullanici;
  }

  async googleIleGiris() {
    try {
      const { user } = await this.auth.linkWithGoogle();
      this.kullanici = kullaniciBicim(user);
      return { durum: 'baglandi', kullanici: this.kullanici };
    } catch (h) {
      if (iptalMi(h)) return { durum: 'iptal' };
      if (!hesapVarMi(h)) throw h;
    }
    // Bu Google hesabı daha önce kullanılmış: o hesaba geç
    try {
      const { user } = await this.auth.signInWithGoogle();
      this.kullanici = kullaniciBicim(user);
      return { durum: 'gecildi', kullanici: this.kullanici };
    } catch (h) {
      if (iptalMi(h)) return { durum: 'iptal' };
      throw h;
    }
  }

  async cikis() {
    await this.auth.signOut();
    const { user } = await zamanAsimi(this.auth.signInAnonymously());
    this.kullanici = kullaniciBicim(user);
    return this.kullanici;
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
    return this.cikisSonrasi();
  }

  async cikisSonrasi() {
    await this.auth.signOut().catch(() => {});
    const { user } = await zamanAsimi(this.auth.signInAnonymously());
    this.kullanici = kullaniciBicim(user);
    return this.kullanici;
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
    for (const t of takimlar) {
      for (const tur of BILDIRIM_TURLERI) if (ayar[tur]) istenen.add(`t${t.id}_${tur}`);
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
    if (!this.auth.currentUser) await zamanAsimi(auth.signInAnonymously(this.auth));
    this.kullanici = kullaniciBicim(this.auth.currentUser);
    return this.kullanici;
  }

  async googleIleGiris() {
    const { a } = this;
    const saglayici = new a.GoogleAuthProvider();
    try {
      const { user } = await a.linkWithPopup(this.auth.currentUser, saglayici);
      // Bağlamadan hemen sonra ad/fotoğraf boş gelebilir; sağlayıcı bilgisinden tamamla
      await user.reload().catch(() => {});
      this.kullanici = kullaniciBicim(this.auth.currentUser);
      return { durum: 'baglandi', kullanici: this.kullanici };
    } catch (h) {
      if (iptalMi(h)) return { durum: 'iptal' };
      if (!hesapVarMi(h)) throw h;
      // Bu Google hesabı daha önce kullanılmış: aynı kimlikle o hesaba geç
      const kimlik = a.GoogleAuthProvider.credentialFromError(h);
      const { user } = kimlik
        ? await a.signInWithCredential(this.auth, kimlik)
        : await a.signInWithPopup(this.auth, saglayici);
      this.kullanici = kullaniciBicim(user);
      return { durum: 'gecildi', kullanici: this.kullanici };
    }
  }

  async cikis() {
    await this.a.signOut(this.auth);
    return this.cikisSonrasi();
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
    return this.cikisSonrasi();
  }

  async cikisSonrasi() {
    await zamanAsimi(this.a.signInAnonymously(this.auth));
    this.kullanici = kullaniciBicim(this.auth.currentUser);
    return this.kullanici;
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
  /** { uid, misafir, ad, eposta, foto } ya da null (henüz bağlanmadıysa) */
  get kullanici() { return ic.kullanici; },

  /** Oturum yoksa misafir oturumu açar; kullanıcı nesnesini döner */
  baslat: () => ic.baslat(),
  /** Misafiri Google'a bağlar; hesap zaten varsa ona geçer.
      -> { durum: 'baglandi' | 'gecildi' | 'iptal', kullanici } */
  googleIleGiris: () => ic.googleIleGiris(),
  /** Çıkış yapar ve yeni misafir oturumu açar */
  cikis: () => ic.cikis(),
  /** Firestore belgesini ve Auth kullanıcısını siler, yeni misafir oturumu açar */
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
