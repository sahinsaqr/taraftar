/* Taraftar — takip edilen takımların maçları, canlı skor ve puan durumu.
   Veriler GitHub'daki Python görevinin ürettiği veri/*.json dosyalarından okunur.
   Hesap, takım eşitleme ve bildirim abonelikleri bulut.js üzerinden. */
import { Bulut, BILDIRIM_TURLERI, VARSAYILAN_BILDIRIM } from './bulut.js';

const DEPO = 'ft_takip';
const BILDIRIM_DEPO = 'ft_bildirim';
const TEMA_DEPO = 'ft_tema';   // index.html'deki ilk çizim betiği de bunu okur
const AZAMI_TAKIM = 50;   // Firestore kuralıyla aynı
// Android'de dosyalar uygulamanın içinden gelir; veri GitHub Pages'ten okunur
const VERI_KOK = Bulut.yerel ? 'https://taraftar.mlkcraft.com/' : '';
// MLK Craft'ın ortak gizlilik politikası (Google Play'e verilen adresle aynı)
const PRIVACY_URL = 'https://mlkcraft.com/privacy#taraftar';
const FEEDBACK_EMAIL = 'info@mlkcraft.com';
// Profil'deki "Gizlilik politikası" penceresinde gösterilen kısa özet
const GIZLILIK_OZETI = [
  ['Hangi verileri saklıyoruz?', 'Takip ettiğin takımlar ve bildirim ayarların cihazında ve Google Firebase sunucularında (Avrupa) saklanır. Uygulamayı kullanmak için hesap açman gerekmez; ilk açılışta anonim bir hesap oluşturulur. Google ile giriş yaparsan adın, e-posta adresin ve profil fotoğrafın yalnızca hesabını tanımak ve takımlarını cihazların arasında eşitlemek için kullanılır.'],
  ['Bildirimler', 'Android uygulamasında bildirimlere izin verirsen cihazın bir bildirim belirteci alır ve takip ettiğin takımların bildirim konularına abone olur. Sunucumuz kimin hangi takımı takip ettiğini bilmez; bildirimler takım konularına gönderilir.'],
  ['Maç verileri', 'Skorlar, fikstür ve puan durumu üçüncü taraf spor veri kaynaklarından alınır. Uygulamada reklam ya da analiz aracı yoktur.'],
  ['Verilerini silme', 'Profil > Hesabımı sil ile buluttaki ve bu cihazdaki takım listeni, bildirim ayarlarını ve hesabını istediğin an kalıcı olarak silebilirsin. Çıkış yapınca takımların bu cihazdan kaldırılır, hesabında kalır.'],
  ['İletişim', `Gizlilikle ilgili soruların için: ${FEEDBACK_EMAIL}`],
];
const TEMA_ADLARI = { sistem: 'Sistem', acik: 'Açık', koyu: 'Koyu' };
const TEMA_RENGI = { acik: '#eef2f8', koyu: '#1b2d4b' };  // --zemin; index.html ile aynı
const BILDIRIM_ADLARI = {
  gol: ['Goller', 'Takımın gol atınca ya da gol yiyince'],
  mac: ['Maç başladı · devre arası', 'Başlama düdüğü ve devre arası skoru'],
  son: ['Maç sonucu', 'Maç bitince skor; ertelenirse haber'],
  hat: ['Maçtan önce hatırlatma', 'Maç başlamadan 15 dakika önce'],
};

const durum = {
  takip: depoOku(DEPO, []),
  ligler: [],
  ligVeri: {},          // kod -> lig_*.json içeriği
  canli: null,
  sekme: 'maclar',      // maclar | takimlar | ekle (Takımlar'ın alt ekranı) | puan | profil
  macSekme: 'yaklasan',  // gecmis | yaklasan | takvim
  gecmisTakim: 'tumu',  // Geçmiş'te seçili takım
  takvimAy: null,       // Takvim'de gösterilen ay (ayın 1'i); null = bu ay
  takvimGun: null,      // Takvim'de seçili gün (gunAnahtari); null = bugün
  puanLig: null,
  ekleLig: 'populer',   // Takım ekle filtresi: populer | lig kodu
  arama: '',
  sonYukleme: null,
  hata: null,
  bildirim: { ...VARSAYILAN_BILDIRIM, ...depoOku(BILDIRIM_DEPO, {}) },
  tema: depoOku(TEMA_DEPO, 'sistem'),  // sistem | acik | koyu
  bulut: 'baglaniyor',  // baglaniyor | hazir | hata
  islem: false,         // giriş/çıkış/silme sürüyor
  onay: null,           // sayfa içi pencere: 'sil' | 'gizlilik'
  hedefMac: null,       // bildirime dokunulunca gidilecek maç
  puanVurgu: null,      // Takımlarım'dan gelince Puan'da vurgulanacak takım
  izin: null,           // bildirim izni: granted | denied | prompt… (web'de null)
  surum: '',            // package.json → version
};
let yenilemeZamanlayici = null;

// ------------------------------------------------------------------ yardımcılar
function depoOku(anahtar, varsayilan) {
  try { const v = localStorage.getItem(anahtar); return v ? JSON.parse(v) : varsayilan; }
  catch { return varsayilan; }
}
function depoYaz(anahtar, deger) {
  try { localStorage.setItem(anahtar, JSON.stringify(deger)); } catch { /* gizli sekme vb. */ }
}
const kacis = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, kok = document) => kok.querySelector(s);

// ESPN'den İngilizce gelen puan tablosu açıklamaları ve tablo adları
const TURKCE_METIN = {
  'Champions League': 'Şampiyonlar Ligi',
  'Champions League qualifying': 'Şampiyonlar Ligi ön eleme',
  'Europa League': 'Avrupa Ligi',
  'Europa League qualifying': 'Avrupa Ligi ön eleme',
  'Conference League qualifying': 'Konferans Ligi ön eleme',
  'Relegation': 'Küme düşme',
  'Relegated': 'Küme düşme',
  'Relegation playoff': 'Küme düşme play-off',
  'Relegation playoffs': 'Küme düşme play-off',
  'Qualifies for round of 16': "Son 16'ya çıkar",
  'Knockout phase playoffs - seeded': 'Play-off (seri başı)',
  'Knockout phase playoffs - unseeded': 'Play-off',
  'Eliminated': 'Elendi',
  'League Phase': 'Lig aşaması',
};
const turkceMetin = (s) => TURKCE_METIN[s] ?? s;

async function jsonGetir(yol) {
  const r = await fetch(`${VERI_KOK}${yol}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${yol}: ${r.status}`);
  return r.json();
}

function tost(mesaj, sure = 2200) {
  const k = $('#tost');
  k.textContent = mesaj;
  k.classList.add('goster');
  clearTimeout(tost.z);
  tost.z = setTimeout(() => k.classList.remove('goster'), sure);
}

const saatBicim = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const gunBicim = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const kisaGunBicim = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' });

function gunAnahtari(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function gunEtiketi(d, kisa = false) {
  const bugun = new Date();
  const fark = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
    new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate())) / 864e5);
  if (fark === 0) return 'Bugün';
  if (fark === 1) return 'Yarın';
  if (fark === -1) return 'Dün';
  return (kisa ? kisaGunBicim : gunBicim).format(d);
}
function geriSayim(d) {
  let dk = Math.round((d - Date.now()) / 60000);
  if (dk <= 0) return 'başlamak üzere';
  const gun = Math.floor(dk / 1440); dk -= gun * 1440;
  const sa = Math.floor(dk / 60); dk -= sa * 60;
  if (gun) return `${gun} gün ${sa} sa sonra`;
  if (sa) return `${sa} sa ${dk} dk sonra`;
  return `${dk} dk sonra`;
}
function goreceliZaman(iso) {
  if (!iso) return 'bilinmiyor';
  const dk = Math.round((Date.now() - new Date(iso)) / 60000);
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.round(dk / 60);
  if (sa < 24) return `${sa} sa önce`;
  return `${Math.round(sa / 24)} gün önce`;
}

// Göreli parlaklık ve kontrast oranı (WCAG); "1b2d4b" ya da "#1b2d4b"
function parlaklik(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const kontrast = (a, b) => { const [x, y] = [parlaklik(a), parlaklik(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const renkMi = (s) => /^#?[0-9a-f]{6}$/i.test(s || '');

// ligler.json'daki takım bilgisi (kısaltma, kulüp renkleri); takip listesinde ve puan tablosunda eksik olabiliyor
function ligTakimi(id) {
  if (ligTakimi.kaynak !== durum.ligler) {
    ligTakimi.kaynak = durum.ligler;
    ligTakimi.harita = new Map(durum.ligler.flatMap((l) => (l.takimlar || []).map((t) => [t.id, t])));
  }
  return ligTakimi.harita.get(id);
}

/** Logo yoksa ya da yüklenemezse kulüp renginde yuvarlak + kısaltma. Yazı rengi alternateColor
    zeminle 4.5:1 veriyorsa odur, yoksa beyaz ya da lacivertten okunaklı olanı. */
function logoYedek(takim, boyut, px) {
  const lt = ligTakimi(takim.id) || durum.takip.find((t) => t.id === takim.id) || {};
  const bas = kacis((takim.kisa || lt.kisa || takim.ad || '?').slice(0, 3).toLocaleUpperCase('tr'));
  const renk = takim.renk || lt.renk;
  let stil = `width:${px}px;height:${px}px`;
  if (renkMi(renk)) {
    const r2 = takim.renk2 || lt.renk2;
    const yazi = renkMi(r2) && kontrast(renk, r2) >= 4.5 ? r2
      : kontrast(renk, 'ffffff') >= kontrast(renk, '1b2d4b') ? 'ffffff' : '1b2d4b';
    stil += `;background:#${renk.replace('#', '')};color:#${yazi.replace('#', '')}`;
  }
  return `<div class="logo ${boyut} logo-yedek" style="${stil}" aria-hidden="true">${bas}</div>`;
}

function logoHtml(takim, boyut = 'kucuk') {
  const px = { kucuk: 24, orta: 32, buyuk: 44, '': 40 }[boyut] ?? 40;
  let url = takim.logo || '';
  const m = url.match(/^https:\/\/a\.espncdn\.com(\/i\/.+\.png)/);
  if (m) url = `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${px * 2}&h=${px * 2}`;
  const yedek = logoYedek(takim, boyut, px);
  if (!url) return yedek;
  return `<img class="logo ${boyut}" src="${kacis(url)}" alt="" loading="lazy" width="${px}" height="${px}"
    onerror="this.outerHTML=this.dataset.yedek" data-yedek="${kacis(yedek)}">`;
}

const takipIdler = () => new Set(durum.takip.map((t) => t.id));
const ligAdi = (kod) => durum.ligler.find((l) => l.kod === kod)?.ad || kod;

// ------------------------------------------------------------------ veri
function gerekliLigler() {
  const ids = takipIdler();
  const kodlar = new Set(durum.takip.map((t) => t.lig));
  for (const l of durum.ligler) {
    if ((l.takimlar || []).some((t) => ids.has(t.id))) kodlar.add(l.kod);
  }
  if (durum.puanLig) kodlar.add(durum.puanLig);
  return [...kodlar].filter((k) => durum.ligler.some((l) => l.kod === k));
}

async function ligYukle(kod) {
  try { durum.ligVeri[kod] = await jsonGetir(`veri/lig_${kod}.json`); }
  catch (h) { console.warn(h); }
}

async function yukle({ cekme = false } = {}) {
  try {
    const ligler = await jsonGetir('veri/ligler.json');
    durum.ligler = ligler.ligler || [];
    durum.hata = null;
  } catch (h) {
    durum.hata = 'Veriler henüz hazır değil. GitHub görevi ilk kez çalıştıktan sonra burada görünecek.';
  }
  await Promise.all([
    ...gerekliLigler().map(ligYukle),
    jsonGetir('veri/canli.json').then((c) => { durum.canli = c; }).catch(() => {}),
  ]);
  durum.sonYukleme = new Date();
  ciz();
  zamanlayiciKur();
  if (cekme) tost(durum.hata ? 'Veriler alınamadı' : 'Güncellendi');
}

function tumMaclar() {
  const maclar = new Map();
  for (const lig of Object.values(durum.ligVeri)) {
    for (const m of lig.maclar || []) maclar.set(m.id, m);
  }
  for (const m of durum.canli?.maclar || []) {
    const eski = maclar.get(m.id);
    // canlı dosya daha yeniyse onu kullan
    if (!eski || eski.durum !== 'post' || m.durum === 'post') maclar.set(m.id, { ...eski, ...m });
  }
  return [...maclar.values()].sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
}

function takimMaclari(id, maclar) {
  return maclar.filter((m) => m.ev.id === id || m.dep.id === id);
}

const ERTELENDI = new Set(['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_ABANDONED', 'STATUS_SUSPENDED']);
function macDurumu(m) {
  if (ERTELENDI.has(m.durum_kodu)) return { tip: 'ert', yazi: 'ERT', alt: 'ertelendi' };
  if (m.durum === 'in') {
    if (m.durum_kodu === 'STATUS_HALFTIME') return { tip: 'canli', yazi: 'DA', alt: 'devre' };
    return { tip: 'canli', yazi: m.dakika || 'CANLI', alt: 'canlı' };
  }
  if (m.durum === 'post') return { tip: 'bitti', yazi: 'MS', alt: '' };
  // başlama saati geçti ama veri güncellenmemiş olabilir
  return { tip: 'once', yazi: saatBicim.format(new Date(m.tarih)), alt: '' };
}

function sonuc(m, id) {
  if (m.durum !== 'post' || m.ev_skor == null) return null;
  const biz = m.ev.id === id ? m.ev_skor : m.dep_skor;
  const onlar = m.ev.id === id ? m.dep_skor : m.ev_skor;
  return biz > onlar ? 'G' : biz < onlar ? 'M' : 'B';
}

// ------------------------------------------------------------------ çizim
// En yeni veri zamanı: canlı skor (yalnız maç izlenirken yazılır) ya da fikstür/puan dosyaları
function sonVeriZamani() {
  const zamanlar = [durum.canli?.guncelleme, ...Object.values(durum.ligVeri).map((l) => l?.guncelleme)].filter(Boolean);
  return zamanlar.length ? zamanlar.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
}

const ilgili = (m) => { const ids = takipIdler(); return ids.has(m.ev.id) || ids.has(m.dep.id); };

function ciz() {
  if (surukleniyor) { cizBekliyor = true; return; }
  siralayici?.destroy();
  siralayici = null;
  // Takım ekle, Takımlar'ın alt ekranı: menüde Takımlar seçili kalır
  const menuSekme = durum.sekme === 'ekle' ? 'takimlar' : durum.sekme;
  document.querySelectorAll('.alt-menu button').forEach((b) => {
    const secili = b.dataset.sekme === menuSekme;
    b.classList.toggle('aktif', secili);
    if (secili) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const icerik = $('#icerik');
  const ciziciler = { takimlar: cizTakimlar, maclar: cizMaclar, puan: cizPuan, ekle: cizEkle, profil: cizProfil };
  icerik.innerHTML = (durum.hata && durum.sekme !== 'profil' ? `<div class="uyari">${kacis(durum.hata)}</div>` : '') +
    (ciziciler[durum.sekme] || cizMaclar)() + onayKutusu();
  hedefeGit();
  puanaGit();
  if (durum.sekme === 'takimlar') suruklemeKur();
}

function bosEkran(baslik, metin, dugme = true) {
  return `<div class="kart bos">
    <svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" d="m12 7 3.8 2.8-1.5 4.4H9.7L8.2 9.8z"/></svg>
    <h2>${kacis(baslik)}</h2><p>${kacis(metin)}</p>
    ${dugme ? '<button class="dugme" data-git="ekle">Takım ekle</button>' : ''}
  </div>`;
}

// ---- Takımlarım
const ARTI = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/></svg>';
// Zil: açıkken dolu, kapalıyken çizgili ve üstü çizili
const ZIL_ACIK = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5v3.6L3.8 15.5A1 1 0 0 0 4.7 17h14.6a1 1 0 0 0 .9-1.5l-1.7-2.9V9A6.5 6.5 0 0 0 12 2.5zM9.5 18.5a2.5 2.5 0 0 0 5 0z"/></svg>';
const ZIL_KAPALI = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.3 6.8A6.5 6.5 0 0 0 5.5 9v3.6l-1.7 2.9a1 1 0 0 0 .9 1.5H16M18.5 13.3V9a6.5 6.5 0 0 0-9.8-5.6M9.5 19a2.5 2.5 0 0 0 5 0M3.5 3.5l17 17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const KAPAT = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const IPUCU_DEPO = 'ft_ipucu_sirala';   // sıralama ipucu kapatıldıysa true
const zilAcik = (t) => t.zil !== false;

// Sade kart: logo, ad, "Lig · x. sıra · y puan", zil. Maç bilgisi Maçlar sekmesinde.
// Karta dokununca Puan sekmesi takımın liginde açılır (sıralama sırasında değil).
function takimKarti(t) {
  const tablo = sira(t.id, t.lig);
  const alt = [ligAdi(t.lig), tablo && `${tablo.sira}. sıra`, tablo && `${tablo.p} puan`].filter(Boolean).join(' · ');
  const acik = zilAcik(t);
  return `<article class="kart takim-kart" id="takim-${kacis(t.id)}" data-id="${kacis(t.id)}" tabindex="0"
      aria-label="${kacis(t.ad)}, ${kacis(alt)}. Puan durumunu aç" aria-description="Sıralamak için basılı tutup sürükle ya da Alt ve ok tuşlarını kullan">
    ${logoHtml(t, 'buyuk')}
    <div class="tk-bilgi"><div class="ad">${kacis(t.ad)}</div><div class="tk-alt">${kacis(alt)}</div></div>
    <button class="zil${acik ? ' acik' : ''}" data-zil="${kacis(t.id)}" role="switch" aria-checked="${acik}"
      aria-label="${kacis(t.ad)} bildirimleri">${acik ? ZIL_ACIK : ZIL_KAPALI}</button>
  </article>`;
}

// Puan sekmesini takımın liginde aç; satırı görünür yap ve kısa süre vurgula (puanaGit)
function takimPuaninaGit(id) {
  const t = durum.takip.find((x) => x.id === id);
  if (!t || surukleniyor || Date.now() - sonSiralama < 400) return;
  if (durum.ligler.some((l) => l.kod === t.lig)) durum.puanLig = t.lig;
  durum.puanVurgu = t.id;
  sekmeyeGec('puan');
}

function puanaGit() {
  if (!durum.puanVurgu || durum.sekme !== 'puan') return;
  const satir = document.querySelector(`tr[data-takim="${CSS.escape(durum.puanVurgu)}"]`);
  if (!satir) return;   // lig verisi gelince ciz() yeniden dener
  durum.puanVurgu = null;
  // seçili lig düğmesi yatay şeritte ortada görünsün
  const cip = document.querySelector('.secici .cip.aktif');
  if (cip) cip.parentElement.scrollLeft = cip.offsetLeft - (cip.parentElement.clientWidth - cip.offsetWidth) / 2;
  requestAnimationFrame(() => {
    satir.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    satir.classList.add('vurgula');
  });
}

function cizTakimlar() {
  const ust = `<div class="ekran-ust"><h2 class="ekran-baslik">Takımlarım</h2>
    <button class="dugme kucuk" data-git="ekle">${ARTI} Takım ekle</button></div>`;
  if (!durum.takip.length) return ust + bosEkran('Henüz takım eklemedin', 'Takip etmek istediğin takımları ekle; maçları, skorları ve puan durumu burada görünsün.');
  const ipucu = durum.takip.length > 1 && !depoOku(IPUCU_DEPO, false)
    ? `<div class="ipucu" role="note"><span>Sıralamak için karta basılı tut, sonra yukarı aşağı sürükle</span>
        <button class="ipucu-kapat" id="ipucuKapat" aria-label="İpucunu kapat">${KAPAT}</button></div>` : '';
  return `${ust}${ipucu}<div class="kartlar takim-listesi" id="takimListe">${durum.takip.map(takimKarti).join('')}</div>`;
}

function zilDegistir(id) {
  const t = durum.takip.find((x) => x.id === id);
  if (!t) return;
  t.zil = !zilAcik(t);
  depoYaz(DEPO, durum.takip);
  bulutaKaydet();   // takımları yazar ve FCM konularını eşitler (zil kapalı takımın konularından çıkar)
  titret.birak();
  if (t.zil) izinIste();
  tost(`${t.ad} bildirimleri ${t.zil ? 'açıldı' : 'kapandı'}`);
  ciz();
}

// ---- Sıralama: karta ~0,5 sn basılı tut, sonra sürükle (SortableJS, kutuphane/ içinde; internetsiz de açılsın)
// Basılı tutmadan kaydırma normal sayfa kaydırmasıdır; parmak eşikten fazla oynarsa sürükleme başlamaz.
let sortableYukleme = null;
let siralayici = null;
let surukleniyor = false;   // kart seçildi (basılı tutuldu) ya da sürükleniyor
let siralamaIptal = false;  // geri tuşu sürüklemeyi iptal etti
let cizBekliyor = false;    // sürüklerken gelen yenileme, bırakınca çizilir
let sonSiralama = 0;        // basılı tutup bırakınca gelen tıklama kartı açmasın
let secimZamani = 0;        // kart ne zaman seçildi (farede basar basmaz, dokunmada 0,5 sn sonra)
let suruklemeBasladi = false;

// Android titreşimi (@capacitor/haptics): tutunca hafif darbe, bırakınca 12 ms'lik tık
const titret = {
  tut: () => { if (Bulut.yerel) window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' }).catch(() => {}); },
  birak: () => { if (Bulut.yerel) window.Capacitor.Plugins.Haptics.vibrate({ duration: 12 }).catch(() => {}); },
};

function siraKaydet(yeniIdler) {
  const harita = new Map(durum.takip.map((t) => [t.id, t]));
  const yeni = yeniIdler.map((id) => harita.get(id)).filter(Boolean);
  if (yeni.length !== durum.takip.length || yeni.every((t, i) => t === durum.takip[i])) return;
  durum.takip = yeni;
  depoYaz(DEPO, durum.takip);
  bulutaKaydet();
}

// Sortable bırakınca önce 'unchoose' sonra 'end' çağırır; bekleyen çizim ikisinden sonra yapılır
function siralamaBitti() {
  // Sortable kısa dokunmada (kart seçilmeden) de 'unchoose' gönderir: o zaman yapacak bir şey yok, tıklama kartı açar
  if (!surukleniyor) return;
  // gerçekten sürüklendiyse ya da uzun basıldıysa ardından gelen tıklama yok sayılır (farede kısa tık kartı açar)
  if (suruklemeBasladi || Date.now() - secimZamani > 350) sonSiralama = Date.now();
  surukleniyor = false;
  suruklemeBasladi = false;
  document.body.classList.remove('siralaniyor');
  if (cizBekliyor) { cizBekliyor = false; setTimeout(ciz, 0); }
}

async function suruklemeKur() {
  sortableYukleme ??= import('./kutuphane/Sortable.min.js').then(() => self.Sortable);
  const Sortable = await sortableYukleme;
  const liste = $('#takimListe');
  if (!liste || siralayici?.el === liste || durum.takip.length < 2) return;
  siralayici?.destroy();
  siralayici = Sortable.create(liste, {
    draggable: '.takim-kart',
    filter: '.zil',                 // zile basmak sürükleme başlatmaz
    preventOnFilter: false,
    delay: 500,                     // basılı tut
    delayOnTouchOnly: true,         // farede hemen sürüklenir
    touchStartThreshold: 6,         // parmak oynarsa kaydırmadır
    forceFallback: true,            // taşınan kopya yalnız transform ile hareket eder
    fallbackOnBody: true,
    fallbackTolerance: 3,
    animation: 150,
    chosenClass: 'sirala-secili',
    ghostClass: 'sirala-yer',
    fallbackClass: 'sirala-tasinan',
    scrollSensitivity: 80,
    scrollSpeed: 20,
    onChoose: (e) => {
      surukleniyor = true;
      siralamaIptal = false;
      secimZamani = Date.now();
      // dokunmada seçim = 0,5 sn basılı tutuldu; farede şerit sürükleme başlayınca çıkar
      if (/^touch/.test(e.originalEvent?.type || '') || e.originalEvent?.pointerType === 'touch') {
        document.body.classList.add('siralaniyor');
        titret.tut();
      }
    },
    onStart: () => { suruklemeBasladi = true; document.body.classList.add('siralaniyor'); },
    onUnchoose: siralamaBitti,      // basılı tutup sürüklemeden bırakınca da
    onEnd: () => {
      const iptal = siralamaIptal;
      siralamaBitti();
      titret.birak();
      if (iptal) { siralamaIptal = false; siralayici?.destroy(); siralayici = null; ciz(); return; }   // eski sıra geri çizilir
      siraKaydet([...liste.children].map((k) => k.dataset.id).filter(Boolean));
    },
  });
}

// Geri tuşu: sürüklemeyi iptal eder (Sortable bırakmayı touchcancel ile algılar)
function siralamayiIptalEt() {
  siralamaIptal = true;
  document.dispatchEvent(new Event('touchcancel'));
  document.dispatchEvent(new Event('pointercancel'));
  document.dispatchEvent(new MouseEvent('mouseup'));
}

// Klavye: kart odaklıyken Alt + yukarı/aşağı ok
function takimTasi(id, yon) {
  const i = durum.takip.findIndex((t) => t.id === id);
  const j = i + yon;
  if (i < 0 || j < 0 || j >= durum.takip.length) return;
  const idler = durum.takip.map((t) => t.id);
  [idler[i], idler[j]] = [idler[j], idler[i]];
  siraKaydet(idler);
  const kart = () => document.getElementById(`takim-${id}`);
  const once = kart().getBoundingClientRect().top;
  ciz();
  window.scrollBy(0, kart().getBoundingClientRect().top - once);
  kart().focus({ preventScroll: true });
}

function sira(id, kod) {
  for (const tablo of durum.ligVeri[kod]?.tablolar || []) {
    const s = tablo.satirlar.find((x) => x.takim.id === id);
    if (s) return s;
  }
  return null;
}

// ---- Maçlar: Geçmiş | Yaklaşan | Takvim
const MAC_SEKMELERI = { gecmis: 'Geçmiş', yaklasan: 'Yaklaşan', takvim: 'Takvim' };
const ESKI_VERI = 3 * 3600e3;   // bundan eski veri Maçlar'ın üstünde uyarı şeridiyle gösterilir
const TAKVIM_SIMGE = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const OK = (yon) => `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="${yon < 0 ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const HAFTA_GUNLERI = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'];
const SONUC_ADLARI = { G: 'Galibiyet', B: 'Beraberlik', M: 'Mağlubiyet' };

const gunAdKisa = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' });
const ayKisa = new Intl.DateTimeFormat('tr-TR', { month: 'short' });
const ayYil = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
const bugunMu = (d) => gunAnahtari(d) === gunAnahtari(new Date());
const anahtarTarih = (a) => { const [y, ay, g] = a.split('-').map(Number); return new Date(y, ay, g); };

// "Bugün", "Yarın", "Dün" ya da "Cmt 25 Eki"
function kisaGun(d) {
  const e = gunEtiketi(d, true);
  return ['Bugün', 'Yarın', 'Dün'].includes(e) ? e : `${gunAdKisa.format(d)} ${d.getDate()} ${ayKisa.format(d)}`;
}

// "4 saat önce", "2 gün önce" (uyarı şeridi)
function eskiZaman(iso) {
  const sa = (Date.now() - new Date(iso)) / 3600e3;
  return sa < 48 ? `${Math.max(1, Math.round(sa))} saat önce` : `${Math.round(sa / 24)} gün önce`;
}

// Maç kartında yalnız lig adı (gerçek tur bilgisi veri kaynağı değişince eklenecek)
const ligSatiri = (m) => ligAdi(m.lig);

// Canlı maç: dakika yazısı ve ilerleme (90 dakikaya göre; uzatmalarda dolu)
const canliDakika = (m) => (m.durum_kodu === 'STATUS_HALFTIME' ? 'DA' : m.dakika || '');
function canliYuzde(m) {
  if (m.durum_kodu === 'STATUS_HALFTIME') return 50;
  const dk = String(m.dakika || '').match(/\d+/g)?.reduce((a, b) => a + Number(b), 0) || 0;   // 45'+2' → 47
  return Math.min(100, Math.round((dk / 90) * 100));
}

/** Takip edilen takıma göre sonuç; iki takım da takipteyse (ya da maç bitmediyse) null */
function takipSonucu(m, ids, secili) {
  if (secili) return sonuc(m, secili);
  const ev = ids.has(m.ev.id), dep = ids.has(m.dep.id);
  if (ev === dep) return null;
  return sonuc(m, ev ? m.ev.id : m.dep.id);
}

const canliRozet = (m) => `<span class="canli-rozet"><span class="nokta" aria-hidden="true"></span>CANLI · ${kacis(canliDakika(m))}</span>`;

// Yaklaşan: her maç ayrı kart; ev sahibi solda, deplasman sağda
function macKarti(m, ids) {
  const canli = m.durum === 'in';
  const d = new Date(m.tarih);
  const taraf = (t) => `<div class="mk-taraf${ids.has(t.id) ? ' takipte' : ''}">${logoHtml(t, '')}<span class="mk-ad">${kacis(t.ad)}</span></div>`;
  let orta;
  if (canli) {
    orta = `<div class="mk-skor" aria-label="Skor ${m.ev_skor ?? 0} - ${m.dep_skor ?? 0}">${m.ev_skor ?? 0}<span aria-hidden="true">:</span>${m.dep_skor ?? 0}</div>`;
  } else {
    const saat = ERTELENDI.has(m.durum_kodu) ? 'ERT' : saatBicim.format(d);
    orta = `<div class="mk-gun">${kacis(kisaGun(d))}</div><div class="mk-saat${bugunMu(d) ? ' bugun' : ''}">${saat}</div>`;
  }
  const yuzde = canli ? canliYuzde(m) : 0;
  return `<article class="kart mac-kart${canli ? ' canli' : ''}">
    ${canli ? `<div class="mk-rozet">${canliRozet(m)}</div>` : ''}
    <div class="mk-lig">${kacis(ligSatiri(m))}</div>
    <div class="mk-govde">${taraf(m.ev)}<div class="mk-orta">${orta}</div>${taraf(m.dep)}</div>
    ${canli ? `<div class="ilerleme" role="progressbar" aria-label="Maç süresi" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${yuzde}"><span style="width:${yuzde}%"></span></div>` : ''}
  </article>`;
}

function cizYaklasan(maclar, ids) {
  const simdi = Date.now();
  // önce canlı maçlar (önce başlayan üstte), sonra başlama saatine göre; liste zaten tarihe göre sıralı
  const liste = [
    ...maclar.filter((m) => m.durum === 'in'),
    ...maclar.filter((m) => m.durum === 'pre' && new Date(m.tarih) > simdi - 3 * 3600e3),
  ].slice(0, 40);
  if (!liste.length) return '<div class="kart bos">Yaklaşan maç bulunamadı.</div>';
  return `<div class="kartlar sik">${liste.map((m) => macKarti(m, ids)).join('')}</div>`;
}

/** Sonuç satırı (Geçmiş ve Takvim): üstte rozet + tarih / sağda bilgi; altta ev - skor - deplasman */
function sonucSatiri(m, ids, { s = null, ust = kacis(kisaGun(new Date(m.tarih))), sag = kacis(ligAdi(m.lig)), orta, sinif = '' } = {}) {
  const ad = (t, yon) => `<span class="ss-ad ${yon}${ids.has(t.id) ? ' takipte' : ''}">${kacis(t.ad)}</span>`;
  orta ??= `${m.ev_skor ?? 0} - ${m.dep_skor ?? 0}`;
  return `<div class="sonuc-satir${s ? ` s-${s}` : ''}${sinif ? ` ${sinif}` : ''}">
    <div class="ss-ust"><span class="ss-sol">${s ? `<span class="rozet ${s}" title="${SONUC_ADLARI[s]}">${s}</span>` : ''}${ust}</span><span class="ss-sag">${sag}</span></div>
    <div class="ss-alt">${logoHtml(m.ev)}${ad(m.ev, 'ev')}<span class="ss-orta">${orta}</span>${ad(m.dep, 'dep')}${logoHtml(m.dep)}</div>
  </div>`;
}

function gecmisSecici() {
  const sec = durum.gecmisTakim;
  const secenekler = [['tumu', 'Tümü', null], ...durum.takip.map((t) => [t.id, t.ad, t])];
  if (durum.takip.length <= 5) {
    return `<div class="secici" role="group" aria-label="Takım seç">${secenekler.map(([id, ad, t]) =>
      `<button class="cip${sec === id ? ' aktif' : ''}" data-gecmistakim="${kacis(id)}" aria-pressed="${sec === id}">${t ? logoHtml(t) : ''}${kacis(ad)}</button>`).join('')}</div>`;
  }
  return `<label class="acilir"><span class="gorunmez">Takım seç</span>
    <select id="gecmisTakim">${secenekler.map(([id, ad]) => `<option value="${kacis(id)}"${sec === id ? ' selected' : ''}>${kacis(ad)}</option>`).join('')}</select></label>`;
}

function cizGecmis(maclar, ids) {
  if (durum.gecmisTakim !== 'tumu' && !ids.has(durum.gecmisTakim)) durum.gecmisTakim = 'tumu';
  const secili = durum.gecmisTakim === 'tumu' ? null : durum.gecmisTakim;
  const liste = maclar.filter((m) => m.durum === 'post' && m.ev_skor != null &&
    (secili ? m.ev.id === secili || m.dep.id === secili : true)).reverse().slice(0, 60);
  let ozet = '';
  if (secili) {
    const say = { G: 0, B: 0, M: 0 };
    for (const m of liste) say[sonuc(m, secili)]++;
    ozet = `<div class="ozet">${Object.entries(say).map(([s, n]) =>
      `<div class="ozet-kutu s-${s}"><b>${n}</b><span>${SONUC_ADLARI[s]}</span></div>`).join('')}</div>`;
  }
  const satirlar = liste.length
    ? `<div class="satirlar">${liste.map((m) => sonucSatiri(m, ids, { s: takipSonucu(m, ids, secili) })).join('')}</div>`
    : '<div class="kart bos">Henüz sonuç yok.</div>';
  return `${gecmisSecici()}${ozet}<h2 class="bolum-baslik">Son maçlar</h2>${satirlar}`;
}

// Takvim: noktanın sınıfı (oynanmış = sonuç, oynanacak = halka, canlı = yanıp sönen)
function noktaSinifi(m, ids) {
  if (m.durum === 'in') return 'canli';
  if (m.durum === 'post' && m.ev_skor != null) return takipSonucu(m, ids) || 'notr';
  return 'once';
}

function cizTakvim(maclar, ids) {
  const bugun = new Date();
  const ay = durum.takvimAy || new Date(bugun.getFullYear(), bugun.getMonth(), 1);
  const secili = durum.takvimGun || gunAnahtari(bugun);
  const gunler = new Map();
  for (const m of maclar) {
    const a = gunAnahtari(new Date(m.tarih));
    if (!gunler.has(a)) gunler.set(a, []);
    gunler.get(a).push(m);
  }
  const bosluk = (ay.getDay() + 6) % 7;   // hafta pazartesi başlar
  const gunSayisi = new Date(ay.getFullYear(), ay.getMonth() + 1, 0).getDate();
  const hucreler = Array.from({ length: bosluk }, () => '<span class="tg bos" aria-hidden="true"></span>');
  for (let g = 1; g <= gunSayisi; g++) {
    const d = new Date(ay.getFullYear(), ay.getMonth(), g);
    const a = gunAnahtari(d);
    const ms = gunler.get(a) || [];
    const sinif = ['tg', ms.length && 'macli', a === gunAnahtari(bugun) && 'bugun', a === secili && 'secili'].filter(Boolean).join(' ');
    hucreler.push(`<button class="${sinif}" data-takvimgun="${a}" aria-pressed="${a === secili}"
      aria-label="${kacis(gunBicim.format(d))}${ms.length ? `, ${ms.length} maç` : ''}"><span class="tg-no">${g}</span>
      <span class="tg-noktalar" aria-hidden="true">${ms.slice(0, 4).map((m) => `<i class="tn ${noktaSinifi(m, ids)}"></i>`).join('')}</span></button>`);
  }
  const ayAdi = ayYil.format(ay).toLocaleUpperCase('tr');
  const takvim = `<div class="kart takvim">
    <div class="takvim-ust">
      <button class="takvim-ok" data-takvimay="-1" aria-label="Önceki ay">${OK(-1)}</button>
      <h2 class="takvim-ay" aria-live="polite">${kacis(ayAdi)}</h2>
      <button class="takvim-ok" data-takvimay="1" aria-label="Sonraki ay">${OK(1)}</button>
    </div>
    <div class="takvim-izgara">${HAFTA_GUNLERI.map((g) => `<span class="tg-baslik" aria-hidden="true">${g}</span>`).join('')}${hucreler.join('')}</div>
  </div>
  <div class="takvim-aciklama" aria-hidden="true"><span><i class="tn G"></i>Galibiyet</span><span><i class="tn B"></i>Beraberlik</span><span><i class="tn M"></i>Mağlubiyet</span><span><i class="tn once"></i>Oynanacak</span></div>`;

  // Seçili günün maçları
  const sd = anahtarTarih(secili);
  const etiket = gunEtiketi(sd);
  const baslik = (['Bugün', 'Yarın', 'Dün'].includes(etiket) ? `${etiket} · ` : '') + gunBicim.format(sd);
  const gununMaclari = gunler.get(secili) || [];
  const liste = gununMaclari.length ? `<div class="satirlar">${gununMaclari.map((m) => {
    if (m.durum === 'in') {
      return sonucSatiri(m, ids, { ust: kacis(ligAdi(m.lig)), sag: `<span class="canli-yazi">CANLI · ${kacis(canliDakika(m))}</span>`, sinif: 'canli' });
    }
    if (m.durum === 'post' && m.ev_skor != null) {
      return sonucSatiri(m, ids, { s: takipSonucu(m, ids), ust: 'Bitti', sag: kacis(ligAdi(m.lig)) });
    }
    const saat = ERTELENDI.has(m.durum_kodu) ? 'ERT' : saatBicim.format(new Date(m.tarih));
    return sonucSatiri(m, ids, { ust: kacis(ligAdi(m.lig)), sag: '', orta: `<span class="ss-saat">${saat}</span>` });
  }).join('')}</div>` : '<div class="kart bos">Bu gün takımlarının maçı yok</div>';
  return `${takvim}<h2 class="bolum-baslik">${kacis(baslik.toLocaleUpperCase('tr'))}</h2>${liste}`;
}

function takvimAyDegistir(yon) {
  const bugun = new Date();
  const simdiki = durum.takvimAy || new Date(bugun.getFullYear(), bugun.getMonth(), 1);
  const ay = new Date(simdiki.getFullYear(), simdiki.getMonth() + yon, 1);
  durum.takvimAy = ay;
  // ay değişince seçili gün o ayın 1'i; bu aysa bugün
  const buAy = ay.getFullYear() === bugun.getFullYear() && ay.getMonth() === bugun.getMonth();
  durum.takvimGun = gunAnahtari(buAy ? bugun : ay);
  ciz();
}

function cizMaclar() {
  const baslik = '<div class="ekran-ust"><img class="baslik-ikon" src="ikonlar/ikon.svg" width="44" height="44" alt=""><h1 class="logo-baslik">TARAFTAR</h1></div>';
  if (!durum.takip.length) return baslik + bosEkran('Maç listesi boş', 'Önce takip edeceğin takımları ekle.');
  const zaman = sonVeriZamani();
  const uyari = zaman && Date.now() - new Date(zaman) > ESKI_VERI
    ? `<div class="eski-veri" role="status">Veriler güncel değil · ${kacis(eskiZaman(zaman))}</div>` : '';
  const sekmeler = `<div class="bolmeli uc" role="tablist" aria-label="Maçlar">${Object.entries(MAC_SEKMELERI).map(([k, ad]) =>
    `<button role="tab" data-macsekme="${k}" class="${durum.macSekme === k ? 'aktif' : ''}" aria-selected="${durum.macSekme === k}">${ad}${k === 'takvim' ? TAKVIM_SIMGE : ''}</button>`).join('')}</div>`;
  const ids = takipIdler();
  const maclar = tumMaclar().filter(ilgili);
  const govde = { gecmis: cizGecmis, takvim: cizTakvim }[durum.macSekme]?.(maclar, ids) ?? cizYaklasan(maclar, ids);
  return baslik + uyari + sekmeler + govde;
}

// ---- Puan durumu
function cizPuan() {
  if (!durum.ligler.length) return bosEkran('Puan durumu yok', 'Veriler hazır olduğunda burada görünecek.', false);
  const oncelikli = new Set(gerekliLigler());
  const sirali = [...durum.ligler].sort((a, b) => (oncelikli.has(b.kod) - oncelikli.has(a.kod)));
  if (!durum.puanLig) durum.puanLig = durum.takip[0]?.lig || sirali[0].kod;
  const kod = durum.puanLig;
  const secici = `<div class="ekran-ust"><h2 class="ekran-baslik">Puan durumu</h2></div><div class="secici">${sirali.map((l) =>
    `<button class="cip ${l.kod === kod ? 'aktif' : ''}" data-puanlig="${kacis(l.kod)}">${kacis(l.ad)}</button>`).join('')}</div>`;
  const veri = durum.ligVeri[kod];
  if (!veri) {
    ligYukle(kod).then(() => { if (durum.sekme === 'puan') ciz(); });
    return secici + '<div class="kart bos">Yükleniyor…</div>';
  }
  if (!veri.tablolar?.length) return secici + '<div class="kart bos">Bu turnuva için puan tablosu yok.</div>';
  const ids = takipIdler();
  const tablolar = veri.tablolar.map((tablo) => {
    const aciklama = new Map();
    const satirlar = tablo.satirlar.map((s) => {
      if (s.renk && s.not) aciklama.set(turkceMetin(s.not), s.renk);
      return `<tr class="${ids.has(s.takim.id) ? 'takipte' : ''}" data-takim="${kacis(s.takim.id)}">
        <td class="sira" style="--serit:${kacis(s.renk || 'transparent')}">${s.sira}</td>
        <td class="takim-hucre"><div class="ic">${logoHtml(s.takim)}<span class="isim">${kacis(s.takim.ad)}</span></div></td>
        <td>${s.o}</td><td class="gizle-dar">${s.g}</td><td class="gizle-dar">${s.b}</td><td class="gizle-dar">${s.m}</td>
        <td>${s.av > 0 ? '+' : ''}${s.av}</td><td class="puan-h">${s.p}</td></tr>`;
    }).join('');
    const baslik = veri.tablolar.length > 1 && tablo.ad ? `<div class="tablo-baslik">${kacis(turkceMetin(tablo.ad))}</div>` : '';
    const acik = aciklama.size ? `<div class="aciklamalar">${[...aciklama].map(([n, r]) => `<span><i style="background:${kacis(r)}"></i>${kacis(n)}</span>`).join('')}</div>` : '';
    return `<div class="kart">${baslik}<div class="tablo-sar"><table class="puan">
      <thead><tr><th>#</th><th class="takim-hucre">Takım</th><th>O</th><th class="gizle-dar">G</th><th class="gizle-dar">B</th><th class="gizle-dar">M</th><th>AV</th><th>P</th></tr></thead>
      <tbody>${satirlar}</tbody></table></div>${acik}</div>`;
  }).join('<div style="height:12px"></div>');
  return secici + tablolar;
}

// ---- Takım ekle
// Türkçe küçültmede I → ı olur ("Inter" → "ınter"); "inter" ya da "İnter" yazan da bulsun diye ı/i aynı sayılır.
// Harf işaretleri de atılır: "besiktas" Beşiktaş'ı, "munchen" München'i bulur (ş/ç/ğ/ü/ö ve é, ñ gibi).
// İşaret olarak ayrışmayan harfler (ø, æ, ß, ł, đ...) elle sadeleştirilir: "bodo" Bodø'yu bulur.
const OZEL_HARF = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th' };
const isaretsiz = (s) => (s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');
const aramaBicim = (s) => isaretsiz(s).replace(/[øæœßłđðþ]/g, (h) => OZEL_HARF[h]);

// "Popüler" filtresi: büyük kulüpler (ESPN kimlikleri), bu sırayla
const POPULER = ['432', '436', '1895', '997', '86', '83', '382', '360', '364', '359', '363', '132', '124', '111', '110', '103', '160', '1068'];
const BUYUTEC = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15.5 15.5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const TIK = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Takım → ilk göründüğü lig (ayarlar.json sırası: önce ulusal ligler, sonra UEFA)
function tumTakimlar() {
  const gorulen = new Map();
  for (const l of durum.ligler) for (const t of l.takimlar || []) if (!gorulen.has(t.id)) gorulen.set(t.id, { ...t, lig: l.kod });
  return gorulen;
}

function cizEkle() {
  const ust = `<div class="ekran-ust"><button class="geri-dugme" data-git="takimlar" aria-label="Takımlarım'a dön">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <h2 class="ekran-baslik">Takım ekle</h2></div>`;
  if (!durum.ligler.length) return ust + bosEkran('Takım listesi yok', 'Veriler hazır olduğunda takımları buradan ekleyebileceksin.', false);
  const ids = takipIdler();
  const q = aramaBicim(durum.arama.trim());
  const hepsi = tumTakimlar();
  let takimlar;
  if (q) {
    takimlar = [...hepsi.values()].filter((t) => aramaBicim(t.ad).includes(q));
  } else if (durum.ekleLig === 'populer') {
    takimlar = POPULER.map((id) => hepsi.get(id)).filter(Boolean);
  } else {
    const lig = durum.ligler.find((l) => l.kod === durum.ekleLig) || durum.ligler[0];
    takimlar = (lig.takimlar || []).map((t) => ({ ...t, lig: lig.kod }));
  }
  const filtreler = [['populer', 'Popüler'], ...durum.ligler.map((l) => [l.kod, l.ad])];
  return `${ust}
    <label class="arama-kutu">${BUYUTEC}<span class="gorunmez">Takım ara</span>
      <input class="arama" id="arama" type="search" placeholder="Takım ara" value="${kacis(durum.arama)}" autocomplete="off" enterkeyhint="search"></label>
    ${q ? '' : `<div class="secici" role="group" aria-label="Lig">${filtreler.map(([kod, ad]) =>
      `<button class="cip${kod === durum.ekleLig ? ' aktif' : ''}" data-eklelig="${kacis(kod)}" aria-pressed="${kod === durum.ekleLig}">${kacis(ad)}</button>`).join('')}</div>`}
    ${takimlar.length ? `<div class="kart ekle-liste">${takimlar.map((t) => ekleSatiri(t, ids.has(t.id))).join('')}</div>`
      : '<div class="kart bos">Sonuç bulunamadı.</div>'}`;
}

function ekleSatiri(t, takipte) {
  return `<div class="ekle-satir">${logoHtml(t, 'orta')}
    <div class="es-bilgi"><b>${kacis(t.ad)}</b><small>${kacis(ligAdi(t.lig))}</small></div>
    <button class="takip-dugme${takipte ? ' takipte' : ''}" data-takim="${kacis(t.id)}" data-lig="${kacis(t.lig)}" aria-pressed="${takipte}"
      aria-label="${kacis(t.ad)}: ${takipte ? 'takipte, çıkarmak için dokun' : 'takip et'}">${takipte ? `Takipte ${TIK}` : 'Takip et'}</button>
  </div>`;
}

function takimDegistir(id, lig) {
  const i = durum.takip.findIndex((t) => t.id === id);
  if (i >= 0) {
    const [t] = durum.takip.splice(i, 1);
    tost(`${t.ad} listeden çıkarıldı`);
  } else {
    const l = durum.ligler.find((x) => x.kod === lig);
    const t = l?.takimlar.find((x) => x.id === id);
    if (!t) return;
    if (durum.takip.length >= AZAMI_TAKIM) { tost(`En fazla ${AZAMI_TAKIM} takım takip edebilirsin`); return; }
    if (!durum.takip.length) izinIste();
    durum.takip.push({ id: t.id, ad: t.ad, kisa: t.kisa, logo: t.logo, lig, ...(t.renk && { renk: t.renk, renk2: t.renk2 || '' }) });
    tost(`${t.ad} eklendi`);
    // bu takımın liglerini yükle
    Promise.all(gerekliLigler().filter((k) => !durum.ligVeri[k]).map(ligYukle)).then(() => ciz());
  }
  titret.birak();
  depoYaz(DEPO, durum.takip);
  bulutaKaydet();
  ciz();
  const a = $('#arama');
  if (a && durum.arama) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); }
}

// ---- Bulut eşitleme
let kayitZamanlayici = null;
function bulutaKaydet() {
  if (durum.bulut !== 'hazir') return;  // bağlanınca esitle() birleştirir
  clearTimeout(kayitZamanlayici);
  kayitZamanlayici = setTimeout(() => {
    Bulut.takimlariYaz(durum.takip).catch((h) => console.warn('takımlar kaydedilemedi', h));
    Bulut.abonelikleriEsitle(durum.takip, durum.bildirim).catch(() => {});
  }, 800);
}

/** Buluttaki liste ile cihazdaki liste birleştirilir, sonra iki yere de yazılır.
    Sıra buluttan gelir (başka cihazda yapılan sıralama); yalnız bu cihazda olanlar sona eklenir. */
async function esitle() {
  const belge = await Bulut.belgeOku();
  const ids = takipIdler();
  const bulutta = belge.takimlar.filter((t) => t?.id);
  const buluttaIds = new Set(bulutta.map((t) => t.id));
  const eklenen = bulutta.filter((t) => !ids.has(t.id));
  const birlesik = [...bulutta, ...durum.takip.filter((t) => !buluttaIds.has(t.id))].slice(0, AZAMI_TAKIM);
  if (!belge.bos) durum.bildirim = belge.bildirim;
  const degisti = belge.bos || birlesik.length !== belge.takimlar.length;
  durum.takip = birlesik;
  depoYaz(DEPO, durum.takip);
  depoYaz(BILDIRIM_DEPO, durum.bildirim);
  if (degisti) await Bulut.belgeYaz({ takimlar: durum.takip, bildirim: durum.bildirim });
  Bulut.abonelikleriEsitle(durum.takip, durum.bildirim).catch(() => {});
  if (eklenen.length) Promise.all(gerekliLigler().filter((k) => !durum.ligVeri[k]).map(ligYukle)).then(() => ciz());
}

async function bulutBaslat() {
  try {
    await Bulut.baslat();
    await esitle();
    durum.bulut = 'hazir';
    if (durum.takip.length) izinIste(); else izinKontrol();
  } catch (h) {
    console.warn('bulut', h);
    durum.bulut = 'hata';
  }
  ciz();
}

async function hesapIslemi(fn) {
  if (durum.islem) return;
  durum.islem = true;
  ciz();
  try { await fn(); } catch (h) { console.warn(h); tost('İşlem tamamlanamadı, tekrar dene'); }
  durum.islem = false;
  ciz();
}

function cihazdakiHesabiTemizle() {
  durum.takip = [];
  durum.bildirim = { ...VARSAYILAN_BILDIRIM };
  depoYaz(DEPO, durum.takip);
  depoYaz(BILDIRIM_DEPO, durum.bildirim);
}

const googleIleGiris = () => hesapIslemi(async () => {
  const s = await Bulut.googleIleGiris();
  if (s.durum === 'iptal') return;
  durum.bulut = 'hazir';
  await esitle();
  tost(s.durum === 'gecildi' ? 'Hesabına geçildi, takımlar birleştirildi' : 'Google hesabına bağlandı');
});

// Çıkışta takımlar hesapta kalır, bu cihazdan silinir
const cikisYap = () => hesapIslemi(async () => {
  await Bulut.abonelikleriEsitle([], durum.bildirim).catch(() => {});
  await Bulut.cikis();
  cihazdakiHesabiTemizle();
  tost('Çıkış yapıldı');
});

const hesabiSil = () => hesapIslemi(async () => {
  durum.onay = null;
  await Bulut.abonelikleriEsitle([], durum.bildirim).catch(() => {});
  await Bulut.hesabiSil();
  cihazdakiHesabiTemizle();
  tost('Hesabın ve verilerin silindi');
});

function bildirimDegistir(tur) {
  durum.bildirim = { ...durum.bildirim, [tur]: !durum.bildirim[tur] };
  depoYaz(BILDIRIM_DEPO, durum.bildirim);
  if (durum.bildirim[tur]) izinIste();
  if (durum.bulut === 'hazir') {
    Bulut.bildirimAyarlariYaz(durum.bildirim).catch((h) => console.warn(h));
    Bulut.abonelikleriEsitle(durum.takip, durum.bildirim).catch(() => {});
  }
  ciz();
}

// ---- Görünüm modu
const sistemAcik = matchMedia('(prefers-color-scheme: light)');
function temaUygula() {
  const tema = durum.tema === 'sistem' ? (sistemAcik.matches ? 'acik' : 'koyu') : durum.tema;
  document.documentElement.dataset.tema = tema;
  $('meta[name="theme-color"]').content = TEMA_RENGI[tema];
  // Android'de uygulama çubukların arkasına çizilir; zemin sayfadan gelir, simge rengi buradan
  // durum/gezinme çubuğu bölgesi pencere zeminini gösterir (MainActivity'deki Zemin eklentisi)
  if (Bulut.yerel) {
    window.Capacitor.Plugins.SystemBars?.setStyle({ style: tema === 'acik' ? 'LIGHT' : 'DARK' }).catch(() => {});
    window.Capacitor.Plugins.Zemin?.ayarla({ renk: TEMA_RENGI[tema] }).catch(() => {});
  }
}
sistemAcik.addEventListener('change', () => { if (durum.tema === 'sistem') temaUygula(); });

function temaDegistir(tema) {
  durum.tema = tema;
  depoYaz(TEMA_DEPO, tema);
  temaUygula();
  ciz();
}

// ---- Bildirim izni (yalnız Android): Profil'de izin yoksa üstte izin düğmesi
async function izinKontrol() {
  const izin = await Bulut.bildirimIzni().catch(() => null);
  if (izin === durum.izin) return;
  durum.izin = izin;
  if (durum.sekme === 'profil') ciz();
}
const izinIste = () => Bulut.bildirimIzniIste().catch(() => {}).finally(izinKontrol);

async function izinDugmesi() {
  const verildi = await Bulut.bildirimIzniIste().catch(() => false);
  await izinKontrol();
  // Android iki kez reddedilince pencereyi bir daha göstermez
  if (!verildi) tost('İzin verilmedi. Telefonun Ayarlar > Uygulamalar > Taraftar > Bildirimler bölümünden açabilirsin.', 5000);
}

// ---- Profil
const GOOGLE_LOGO = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
const PROFIL_SIMGE = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M4.5 20.5c1-3.8 4-5.5 7.5-5.5s6.5 1.7 7.5 5.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>';
const SAG_OK = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DIS_OK = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Profil'deki seçenek satırı (Görünüm): data-<ad>="<değer>" düğmeleri
function secimSatiri(baslik, aciklama, ad, secenekler, secili) {
  return `<div class="ayar-satir">
      <span><b>${kacis(baslik)}</b>${aciklama ? `<small>${kacis(aciklama)}</small>` : ''}</span>
      <div class="ayar-secici" role="group" aria-label="${kacis(baslik)}">${Object.entries(secenekler).map(([deger, etiket]) =>
        `<button data-${ad}="${deger}" class="${secili === deger ? 'aktif' : ''}" aria-pressed="${secili === deger}">${etiket}</button>`).join('')}</div>
    </div>`;
}

// "Şahiner Solak" → "ŞS"; ad yoksa e-postanın ilk harfi
function basHarfler(k) {
  const parca = (k.ad || '').trim().split(/\s+/).filter(Boolean);
  const h = parca.length > 1 ? parca[0][0] + parca[parca.length - 1][0] : (parca[0] || k.eposta || '?')[0];
  return h.toLocaleUpperCase('tr');
}

function hesapKarti() {
  const k = Bulut.kullanici;
  const bekle = durum.islem ? 'disabled' : '';
  let ic;
  if (durum.bulut === 'baglaniyor') {
    ic = '<p class="kart-not">Hesaba bağlanılıyor…</p>';
  } else if (durum.bulut === 'hata' || !k) {
    ic = `<p class="kart-not">Hesaba bağlanılamadı. Takımların bu cihazda kayıtlı; bağlantı gelince eşitlenir.</p>
      <button class="dugme ikincil genis" id="bulutTekrarBtn">Tekrar dene</button>`;
  } else if (k.misafir) {
    ic = `<div class="profil"><div class="avatar misafir" aria-hidden="true">${PROFIL_SIMGE}</div>
        <div><b>Misafir</b><small>Takımların yalnız bu cihazda</small></div></div>
      <p class="kart-not">Google ile giriş yaparsan takımların hesabına kaydedilir ve tüm cihazlarında görünür.</p>
      <button class="dugme google genis" id="googleBtn" ${bekle}>${GOOGLE_LOGO}Google ile giriş yap</button>`;
  } else {
    const foto = k.foto ? `<img class="avatar" src="${kacis(k.foto)}" alt="" referrerpolicy="no-referrer"
        onerror="this.outerHTML=this.dataset.yedek" data-yedek="${kacis(`<div class="avatar">${kacis(basHarfler(k))}</div>`)}">`
      : `<div class="avatar" aria-hidden="true">${kacis(basHarfler(k))}</div>`;
    ic = `<div class="profil">${foto}<div><b>${kacis(k.ad || 'Google hesabı')}</b><small>${kacis(k.eposta)}</small></div></div>
      <p class="bagli"><span class="bagli-nokta" aria-hidden="true"></span>Google ile bağlı · takımların eşitleniyor</p>
      <button class="dugme ikincil genis" id="cikisBtn" ${bekle}>Çıkış yap</button>`;
  }
  return `<section class="kart profil-kart" aria-labelledby="pHesap"><h2 class="kart-baslik" id="pHesap">Hesap</h2>${ic}</section>`;
}

function bildirimKarti() {
  if (!Bulut.yerel) {
    return `<section class="kart profil-kart" aria-labelledby="pBildirim"><h2 class="kart-baslik" id="pBildirim">Bildirimler</h2>
      <p class="kart-not">Bildirimler Android uygulamasında. Web sürümünde hesabın ve takımların eşitlenir, bildirim gelmez.</p></section>`;
  }
  // izin null: eklenti yok ya da henüz bilinmiyor → düğme gösterilmez
  const izinYok = durum.izin && durum.izin !== 'granted';
  const izin = izinYok ? `<div class="izin-kutu">
      <p><b>Bildirim izni kapalı</b>Gol ve maç bildirimleri için izin vermen gerekiyor.</p>
      <button class="dugme genis" id="izinBtn">Bildirimlere izin ver</button>
    </div>` : '';
  return `<section class="kart profil-kart anahtarlar" aria-labelledby="pBildirim"><h2 class="kart-baslik" id="pBildirim">Bildirimler</h2>
    ${izin}
    ${BILDIRIM_TURLERI.map((tur) => `
      <button class="anahtar-satir" role="switch" aria-checked="${!!durum.bildirim[tur]}" data-bildirim="${tur}">
        <span><b>${kacis(BILDIRIM_ADLARI[tur][0])}</b><small>${kacis(BILDIRIM_ADLARI[tur][1])}</small></span>
        <span class="anahtar" aria-hidden="true"></span>
      </button>`).join('')}
    <p class="kart-not">Bir takımın bildirimlerini tamamen kapatmak için Takımlarım'da o takımın zil simgesine dokun.</p>
  </section>`;
}

function cizProfil() {
  const k = Bulut.kullanici;
  const bekle = durum.islem ? 'disabled' : '';
  const sonVeri = goreceliZaman(sonVeriZamani());
  const sil = k && durum.bulut === 'hazir' ? `<div class="sil-alani">
      <button class="dugme sil-dugme genis" id="silBtn" ${bekle}>Hesabımı sil</button>
      <p>Takım listen, bildirim ayarların ve hesabın kalıcı olarak silinir.</p>
    </div>` : '';

  return `<div class="ekran-ust"><h2 class="ekran-baslik">Profil</h2></div>
    <div class="kartlar">
    ${hesapKarti()}
    ${bildirimKarti()}

    <section class="kart profil-kart" aria-labelledby="pGorunum"><h2 class="kart-baslik" id="pGorunum">Görünüm</h2>
      ${secimSatiri('Tema', 'Sistem, cihazının açık/koyu ayarını izler', 'tema', TEMA_ADLARI, durum.tema)}
    </section>

    <section class="kart profil-kart menu" aria-labelledby="pHakkinda"><h2 class="kart-baslik" id="pHakkinda">Hakkında</h2>
      <button class="menu-satir" id="gizlilikBtn">
        <span><b>Gizlilik politikası</b><small>${kacis(PRIVACY_URL.replace(/^https:\/\//, ''))}</small></span>${SAG_OK}
      </button>
      <a class="menu-satir" href="mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Taraftar geri bildirim')}">
        <span><b>Geri bildirim gönder</b><small>${FEEDBACK_EMAIL}</small></span>${DIS_OK}
      </a>
      <div class="menu-satir">
        <span><b>Veriler</b><small>Skorlar maç sırasında dakikada bir güncellenir; yenilemek için ekranı aşağı çek</small></span>
        <span class="deger">${kacis(sonVeri)}</span>
      </div>
      <div class="menu-satir">
        <span><b>Sürüm</b></span>
        <span class="deger">${kacis(durum.surum || '—')}</span>
      </div>
    </section>
    </div>
    ${sil}`;
}

// Sürüm package.json'dan (web'de sitenin kökünde, Android'de www/ içinde)
fetch('package.json').then((r) => r.json()).then((p) => {
  durum.surum = p.version || '';
  if (durum.sekme === 'profil') ciz();
}).catch(() => {});

function gizlilikPenceresi() {
  const adres = PRIVACY_URL.replace(/^https:\/\//, '');
  return `<div class="onay-perde">
    <div class="kart onay politika" role="dialog" aria-modal="true" aria-labelledby="gizlilikBaslik">
      <h2 id="gizlilikBaslik">Gizlilik Politikası</h2>
      ${GIZLILIK_OZETI.map(([baslik, metin]) => `<h3>${kacis(baslik)}</h3><p>${kacis(metin)}</p>`).join('')}
      <p class="politika-link">Politikanın tam metni: <a href="${PRIVACY_URL}" target="_blank" rel="noopener noreferrer">${adres}</a></p>
      <div class="satir-dugmeler"><button class="dugme ikincil" id="onayIptal">Kapat</button></div>
    </div>
  </div>`;
}

function onayKutusu() {
  if (durum.onay === 'gizlilik') return gizlilikPenceresi();
  if (durum.onay !== 'sil') return '';
  return `<div class="onay-perde">
    <div class="kart onay" role="alertdialog" aria-modal="true" aria-labelledby="onayBaslik">
      <h2 id="onayBaslik">Hesabın silinsin mi?</h2>
      <p>Takım listen ve bildirim ayarların buluttan ve bu cihazdan kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
      <div class="satir-dugmeler">
        <button class="dugme ikincil" id="onayIptal">Vazgeç</button>
        <button class="dugme tehlike" id="onayEvet">Evet, sil</button>
      </div>
    </div>
  </div>`;
}

// ---- Bildirime dokununca ilgili takım kartına git
function hedefeGit() {
  if (!durum.hedefMac || durum.sekme !== 'takimlar') return;
  const m = tumMaclar().find((x) => x.id === durum.hedefMac);
  if (!m) return;  // veri gelince ciz() yeniden dener
  durum.hedefMac = null;
  const t = durum.takip.find((x) => x.id === m.ev.id || x.id === m.dep.id);
  const kart = t && document.getElementById(`takim-${t.id}`);
  if (kart) requestAnimationFrame(() => kart.scrollIntoView({ block: 'start', behavior: 'smooth' }));
}
Bulut.bildirimeDokununca((veri) => {
  if (!veri.mac) return;
  durum.hedefMac = String(veri.mac);
  durum.sekme = 'takimlar';
  yukle();
});
Bulut.bildirimGelince((b) => {
  tost([b.title, b.body?.split('\n')[0]].filter(Boolean).join(' · '), 5000);
  yukle();
});

// ------------------------------------------------------------------ olaylar
function sekmeyeGec(sekme) {
  durum.sekme = sekme;
  ciz();
  window.scrollTo({ top: 0 });
}

// Android geri tuşu: pencere → sürükleme (iptal) → takım araması → Takım ekle'den Takımlarım'a
// → Maçlar'da Geçmiş/Takvim'den Yaklaşan'a → diğer sekmelerden Maçlar'a → arka plan
function geriTusu() {
  if (durum.onay) { durum.onay = null; ciz(); return; }
  if (surukleniyor) { siralamayiIptalEt(); return; }
  if (durum.sekme === 'ekle' && durum.arama) { durum.arama = ''; ciz(); return; }
  if (durum.sekme === 'ekle') { sekmeyeGec('takimlar'); return; }
  if (durum.sekme === 'maclar' && durum.macSekme !== 'yaklasan') { durum.macSekme = 'yaklasan'; ciz(); window.scrollTo({ top: 0 }); return; }
  if (durum.sekme !== 'maclar') { sekmeyeGec('maclar'); return; }
  const App = window.Capacitor.Plugins.App;
  App.minimizeApp().catch(() => App.exitApp());
}
if (Bulut.yerel) window.Capacitor.Plugins.App?.addListener('backButton', geriTusu);

document.addEventListener('click', (e) => {
  const h = e.target.closest('button, a');
  if (!h) {
    const kart = e.target.closest('.takim-kart');
    if (kart) takimPuaninaGit(kart.dataset.id);
    return;
  }
  if (h.dataset.sekme || h.dataset.git) {
    sekmeyeGec(h.dataset.sekme || h.dataset.git);
  } else if (h.dataset.macsekme) { durum.macSekme = h.dataset.macsekme; ciz(); window.scrollTo({ top: 0 }); }
  else if (h.dataset.gecmistakim) { durum.gecmisTakim = h.dataset.gecmistakim; ciz(); }
  else if (h.dataset.takvimgun) { durum.takvimGun = h.dataset.takvimgun; ciz(); }
  else if (h.dataset.takvimay) takvimAyDegistir(Number(h.dataset.takvimay));
  else if (h.dataset.puanlig) { durum.puanLig = h.dataset.puanlig; ciz(); }
  else if (h.dataset.eklelig) { durum.ekleLig = h.dataset.eklelig; ciz(); }
  else if (h.dataset.takim) takimDegistir(h.dataset.takim, h.dataset.lig);
  else if (h.dataset.bildirim) bildirimDegistir(h.dataset.bildirim);
  else if (h.dataset.tema) temaDegistir(h.dataset.tema);
  else if (h.dataset.zil) zilDegistir(h.dataset.zil);
  else if (h.id === 'ipucuKapat') { depoYaz(IPUCU_DEPO, true); ciz(); }
  else if (h.id === 'googleBtn') googleIleGiris();
  else if (h.id === 'cikisBtn') cikisYap();
  else if (h.id === 'izinBtn') izinDugmesi();
  else if (h.id === 'silBtn') { durum.onay = 'sil'; ciz(); $('#onayIptal')?.focus(); }
  else if (h.id === 'onayIptal') { durum.onay = null; ciz(); }
  else if (h.id === 'gizlilikBtn') { durum.onay = 'gizlilik'; ciz(); $('#onayIptal')?.focus(); }
  else if (h.id === 'onayEvet') hesabiSil();
  else if (h.id === 'bulutTekrarBtn') { durum.bulut = 'baglaniyor'; ciz(); bulutBaslat(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && durum.onay) { durum.onay = null; ciz(); }
  else if (e.key === 'Escape' && surukleniyor) siralamayiIptalEt();
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('takim-kart')) { e.preventDefault(); takimPuaninaGit(e.target.dataset.id); }
  else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.classList?.contains('takim-kart')) {
    e.preventDefault();
    takimTasi(e.target.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'gecmisTakim') { durum.gecmisTakim = e.target.value; ciz(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'arama') return;
  durum.arama = e.target.value;
  const kaydir = window.scrollY;
  ciz();
  const a = $('#arama');
  a.focus(); a.setSelectionRange(a.value.length, a.value.length);
  window.scrollTo({ top: kaydir });
});

// Canlı maç varsa dakikada bir, yoksa 15 dakikada bir yenile
function zamanlayiciKur() {
  clearTimeout(yenilemeZamanlayici);
  const simdi = Date.now();
  const sicak = tumMaclar().some((m) => ilgili(m) && (m.durum === 'in' ||
    (m.durum === 'pre' && Math.abs(new Date(m.tarih) - simdi) < 30 * 60e3)));
  yenilemeZamanlayici = setTimeout(() => yukle(), sicak ? 60e3 : 15 * 60e3);
}
document.addEventListener('visibilitychange', () => {
  // izin telefonun ayarlarından açılmış olabilir
  if (document.visibilityState === 'visible' && Bulut.yerel) izinKontrol();
  if (document.visibilityState === 'visible' && (!durum.sonYukleme || Date.now() - durum.sonYukleme > 60e3)) yukle();
});
// geri sayımlar, canlı dakika ve "Bugün" etiketleri için
setInterval(() => {
  if (document.visibilityState === 'visible' && ['takimlar', 'maclar'].includes(durum.sekme) && !surukleniyor && !document.activeElement?.matches('select')) ciz();
}, 60e3);

// ---- Aşağı çekip yenile: sayfanın en üstündeyken parmak aşağı kaydırılınca
const CEK_ESIK = 72;
let cek = null;
const cekKutu = () => $('#cekYenile');
function cekGoster(px) {
  const k = cekKutu();
  k.style.transform = `translate(-50%, ${Math.min(px, 110) - 56}px) rotate(${px * 3}deg)`;
  k.style.opacity = Math.min(1, px / CEK_ESIK);
  k.classList.toggle('hazir', px >= CEK_ESIK);
}
function cekBirak(yenile) {
  const k = cekKutu();
  k.classList.remove('cekiliyor', 'hazir');
  k.style.transform = k.style.opacity = '';
  if (!yenile) return;
  k.classList.add('donuyor');
  titret.birak();
  yukle({ cekme: true }).finally(() => k.classList.remove('donuyor'));
}
document.addEventListener('touchstart', (e) => {
  cek = window.scrollY <= 0 && e.touches.length === 1 && !durum.onay && !surukleniyor && !cekKutu().classList.contains('donuyor')
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY, px: 0, dikey: null } : null;
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!cek) return;
  const dx = e.touches[0].clientX - cek.x;
  const dy = e.touches[0].clientY - cek.y;
  // yatay kaydırma (lig çipleri) ya da yukarı kaydırma çekme sayılmaz
  if (cek.dikey === null && Math.hypot(dx, dy) > 8) cek.dikey = dy > 0 && Math.abs(dy) > Math.abs(dx);
  if (cek.dikey === false || window.scrollY > 0 || surukleniyor) { if (cek.px) cekBirak(false); cek = null; return; }
  if (!cek.dikey) return;
  cek.px = dy * 0.6;
  cekKutu().classList.add('cekiliyor');
  cekGoster(cek.px);
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!cek) return;
  const yenile = cek.px >= CEK_ESIK;
  const cekildi = cek.px > 0;
  cek = null;
  if (cekildi) cekBirak(yenile);
});

if (!Bulut.yerel && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

temaUygula();
ciz();
yukle();
bulutBaslat();
