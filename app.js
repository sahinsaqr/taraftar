/* Taraftar — takip edilen takımların maçları, canlı skor ve puan durumu.
   Veriler GitHub'daki Python görevinin ürettiği veri/*.json dosyalarından okunur.
   Hesap, takım eşitleme ve bildirim abonelikleri bulut.js üzerinden. */
import { Bulut, BILDIRIM_TURLERI, VARSAYILAN_BILDIRIM } from './bulut.js';

const DEPO = 'ft_takip';
const BILDIRIM_DEPO = 'ft_bildirim';
const TEMA_DEPO = 'ft_tema';   // index.html'deki ilk çizim betiği de bunu okur
const SIRALAMA_DEPO = 'ft_siralama';
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
const SIRALAMA_ADLARI = { elle: 'Elle', otomatik: 'Otomatik', karisik: 'Karışık' };
const SIRALAMA_ACIKLAMA = {
  elle: 'Takımlar senin belirlediğin sırada durur',
  otomatik: 'Canlı maçı olanlar üstte, sonra sıradaki maçı en yakın olanlar',
  karisik: 'Senin sıran geçerli; maçı canlı olanlar geçici olarak üste çıkar',
};
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
  macSekme: 'yaklasan',
  puanLig: null,
  ekleLig: null,
  arama: '',
  sonYukleme: null,
  hata: null,
  bildirim: { ...VARSAYILAN_BILDIRIM, ...depoOku(BILDIRIM_DEPO, {}) },
  tema: depoOku(TEMA_DEPO, 'sistem'),  // sistem | acik | koyu
  siralama: depoOku(SIRALAMA_DEPO, 'karisik'),  // elle | otomatik | karisik
  sirala: false,        // Takımlarım'da elle sıralama (oklar) açık
  bulut: 'baglaniyor',  // baglaniyor | hazir | hata
  islem: false,         // giriş/çıkış/silme sürüyor
  onay: null,           // sayfa içi pencere: 'sil' | 'gizlilik'
  hedefMac: null,       // bildirime dokunulunca gidilecek maç
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
  const px = { kucuk: 24, orta: 32, '': 40 }[boyut] ?? 40;
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

async function yukle({ sessiz = false } = {}) {
  const btn = $('#yenileBtn');
  btn.classList.add('donuyor');
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
  btn.classList.remove('donuyor');
  ciz();
  zamanlayiciKur();
  if (!sessiz) durumSatiri();
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

function durumSatiri() {
  const s = $('#durumSatiri');
  const verisi = sonVeriZamani();
  const canliSay = tumMaclar().filter((m) => m.durum === 'in' && ilgili(m)).length;
  const parcalar = [];
  if (canliSay) parcalar.push(`<span class="nokta"></span>${canliSay} canlı maç`);
  parcalar.push(`Veri: ${goreceliZaman(verisi)}`);
  s.innerHTML = parcalar.join(' · ');
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
  durumSatiri();
  hedefeGit();
  if (durum.sirala && durum.sekme === 'takimlar') suruklemeKur();
}

function bosEkran(baslik, metin, dugme = true) {
  return `<div class="kart bos">
    <svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" d="m12 7 3.8 2.8-1.5 4.4H9.7L8.2 9.8z"/></svg>
    <h2>${kacis(baslik)}</h2><p>${kacis(metin)}</p>
    ${dugme ? '<button class="dugme" data-git="ekle">Takım ekle</button>' : ''}
  </div>`;
}

function takimSatiri(t, skor, sinif) {
  return `<div class="taraf ${sinif}">${logoHtml(t)}<span class="isim">${kacis(t.ad)}</span>${skor == null ? '' : `<span class="skor">${skor}</span>`}</div>`;
}

function macHtml(m, { ligGoster = true } = {}) {
  const d = macDurumu(m);
  const ids = takipIdler();
  const oynandi = m.durum !== 'pre';
  let evS = '', depS = '';
  if (m.durum === 'post' && m.ev_skor != null) {
    evS = m.ev_skor > m.dep_skor ? 'kazandi' : m.ev_skor < m.dep_skor ? 'kaybetti' : '';
    depS = m.dep_skor > m.ev_skor ? 'kazandi' : m.dep_skor < m.ev_skor ? 'kaybetti' : '';
  }
  if (ids.has(m.ev.id)) evS += ' takipte';
  if (ids.has(m.dep.id)) depS += ' takipte';
  const goller = (m.goller || []).filter((g) => g.oyuncu)
    .map((g) => `${kacis(g.dk)} ${kacis(g.oyuncu)}${g.pen ? ' (P)' : ''}${g.kk ? ' (KK)' : ''}`).join(', ');
  return `<div class="mac ${d.tip === 'canli' ? 'canli' : ''}">
    <div class="saat">${d.tip === 'canli' ? '<span class="nokta"></span>' : ''}${kacis(d.yazi)}${d.alt && d.tip !== 'canli' ? `<small>${d.alt}</small>` : ''}</div>
    <div class="taraflar">
      ${takimSatiri(m.ev, oynandi ? m.ev_skor ?? 0 : null, evS)}
      ${takimSatiri(m.dep, oynandi ? m.dep_skor ?? 0 : null, depS)}
      ${goller ? `<div class="goller">⚽ ${goller}</div>` : ''}
      ${ligGoster ? `<div class="lig-etiket">${kacis(ligAdi(m.lig))}</div>` : ''}
    </div>
  </div>`;
}

function gunlereGore(maclar, ters = false) {
  const gruplar = [];
  let son = null;
  const liste = ters ? [...maclar].reverse() : maclar;
  for (const m of liste) {
    const d = new Date(m.tarih);
    const a = gunAnahtari(d);
    if (a !== son) { gruplar.push(`<div class="gun-baslik">${kacis(gunEtiketi(d))}</div>`); son = a; }
    gruplar.push(macHtml(m));
  }
  return `<div class="kart mac-listesi">${gruplar.join('')}</div>`;
}

// ---- Takımlarım
function takimDurumu(t, maclar) {
  const tm = takimMaclari(t.id, maclar);
  return {
    tm,
    canli: tm.find((m) => m.durum === 'in'),
    sonraki: tm.find((m) => m.durum === 'pre' && !ERTELENDI.has(m.durum_kodu) && new Date(m.tarih) > Date.now() - 3 * 3600e3),
  };
}

/** Kartların gösterim sırası. Yalnızca takımların canlı/sıradaki maçına bakar; bunlar
    değişmedikçe (maç başlamadıkça/bitmedikçe) skor yenilemesinde kartlar yer değiştirmez. */
function siraliTakimlar(maclar) {
  const liste = durum.takip.map((t, elle) => ({ t, elle, ...takimDurumu(t, maclar) }));
  if (durum.siralama === 'elle') return liste;
  const canliOnce = (a, b) => !!b.canli - !!a.canli;
  if (durum.siralama === 'karisik') return liste.sort((a, b) => canliOnce(a, b) || a.elle - b.elle);
  const zaman = (x) => (x.canli || !x.sonraki ? Infinity : new Date(x.sonraki.tarih).getTime());
  // Infinity - Infinity = NaN (yanlış) → elle sıraya düşer
  return liste.sort((a, b) => canliOnce(a, b) || zaman(a) - zaman(b) || a.elle - b.elle);
}
const siralanabilir = () => durum.siralama !== 'otomatik' && durum.takip.length > 1;

function cizTakimlar() {
  if (!durum.takip.length) return bosEkran('Henüz takım eklemedin', 'Takip etmek istediğin takımları ekle; maçları, skorları ve puan durumu burada görünsün.');
  if (durum.sirala) return cizSiralama();
  const maclar = tumMaclar();
  const kartlar = siraliTakimlar(maclar).map(({ t, tm, canli, sonraki }) => {
    const bitenler = tm.filter((m) => m.durum === 'post');
    const son = bitenler[bitenler.length - 1];
    const form = bitenler.slice(-5).map((m) => sonuc(m, t.id)).filter(Boolean);
    const tablo = sira(t.id, t.lig);
    const parcalar = [];
    if (canli) {
      parcalar.push(`<div class="mini-mac canli"><div class="etiket"><span><span class="nokta"></span>Canlı · ${kacis(macDurumu(canli).yazi)}</span><span>${kacis(ligAdi(canli.lig))}</span></div>${macHtmlIc(canli)}</div>`);
    }
    if (sonraki && sonraki !== canli) {
      const d = new Date(sonraki.tarih);
      parcalar.push(`<div class="mini-mac"><div class="etiket"><span>Sıradaki · ${kacis(gunEtiketi(d, true))} ${saatBicim.format(d)}</span><span class="geri-sayim">${geriSayim(d)}</span></div>${macHtmlIc(sonraki)}</div>`);
    }
    if (son) {
      parcalar.push(`<div class="mini-mac"><div class="etiket"><span>Son maç · ${kacis(gunEtiketi(new Date(son.tarih), true))}</span><span>${kacis(ligAdi(son.lig))}</span></div>${macHtmlIc(son)}</div>`);
    }
    if (!parcalar.length) parcalar.push('<div class="mini-mac"><div class="etiket"><span>Yakın zamanda maç bulunamadı</span></div></div>');
    return `<article class="kart takim-kart" id="takim-${kacis(t.id)}">
      <div class="takim-ust">${logoHtml(t, '')}
        <div><div class="ad">${kacis(t.ad)}</div><div class="lig">${kacis(ligAdi(t.lig))}${tablo ? ` · ${tablo.sira}. sıra, ${tablo.p} puan` : ''}</div></div>
        <div class="form" title="Son maçlar">${form.map((f) => `<span class="${f}">${f}</span>`).join('')}</div>
      </div>
      ${parcalar.join('')}
    </article>`;
  });
  const ust = `<div class="ekran-ust"><h2 class="ekran-baslik">Takımlarım</h2>
    ${siralanabilir() ? '<button class="dugme ikincil kucuk" id="siralaBtn">⇅ Sırala</button>' : ''}
    <button class="dugme kucuk" data-git="ekle">${ARTI} Takım ekle</button></div>`;
  return `${ust}<div class="kartlar iki">${kartlar.join('')}</div>`;
}

const ARTI = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"/></svg>';
const TUTAMAC = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 7h16v2H4zm0 4h16v2H4zm0 4h16v2H4z"/></svg>';

// Elle sıralama: sağdaki tutamaçtan (≡) sürükle-bırak; satırın geri kalanında sayfa kayar.
// Klavyede tutamaç odaklıyken yukarı/aşağı ok tuşları da taşır.
function cizSiralama() {
  return `<div class="sirala-cubuk"><span>≡ tutamaçtan tutup sürükle</span><button class="dugme kucuk" id="siralaBitti">Bitti</button></div>
    <div class="kartlar sik" id="siraListe">${durum.takip.map((t) => `<div class="kart sirala-kart" id="sira-${kacis(t.id)}">
      ${logoHtml(t, 'orta')}<div class="ad">${kacis(t.ad)}<small>${kacis(ligAdi(t.lig))}</small></div>
      <button class="tutamac" data-id="${kacis(t.id)}" aria-label="${kacis(t.ad)}: sürükle ya da ok tuşlarıyla taşı">${TUTAMAC}</button>
    </div>`).join('')}</div>`;
}

// SortableJS (kutuphane/, internetsiz de açılsın diye projede) yalnızca sıralama açılınca yüklenir
let sortableYukleme = null;
let siralayici = null;
let surukleniyor = false;
let cizBekliyor = false;   // sürüklerken gelen yenileme, bırakınca çizilir

// Android titreşimi (@capacitor/haptics): tutunca hafif darbe, bırakınca 12 ms'lik tık
const titret = {
  tut: () => { if (Bulut.yerel) window.Capacitor.Plugins.Haptics.impact({ style: 'LIGHT' }).catch(() => {}); },
  birak: () => { if (Bulut.yerel) window.Capacitor.Plugins.Haptics.vibrate({ duration: 12 }).catch(() => {}); },
};

async function suruklemeKur() {
  sortableYukleme ??= import('./kutuphane/Sortable.min.js').then(() => self.Sortable);
  const Sortable = await sortableYukleme;
  const liste = $('#siraListe');
  if (!liste || siralayici?.el === liste) return;
  siralayici = Sortable.create(liste, {
    handle: '.tutamac',
    forceFallback: true,        // dokunmatik ve farede aynı davranış
    fallbackOnBody: true,
    fallbackTolerance: 3,
    animation: 180,
    ghostClass: 'sirala-yer',
    fallbackClass: 'sirala-tasinan',
    scrollSensitivity: 120,     // alt menü ve üst başlık kenarı örtüyor
    scrollSpeed: 14,
    onChoose: titret.tut,
    onStart: () => { surukleniyor = true; },
    onEnd: ({ oldIndex, newIndex }) => {
      surukleniyor = false;
      titret.birak();
      if (oldIndex !== newIndex) {
        const [t] = durum.takip.splice(oldIndex, 1);
        durum.takip.splice(newIndex, 0, t);
        depoYaz(DEPO, durum.takip);
        bulutaKaydet();
      }
      if (cizBekliyor) { cizBekliyor = false; ciz(); }
    },
  });
}

function takimTasi(id, yon) {
  const i = durum.takip.findIndex((t) => t.id === id);
  const j = i + yon;
  if (i < 0 || j < 0 || j >= durum.takip.length) return;
  [durum.takip[i], durum.takip[j]] = [durum.takip[j], durum.takip[i]];
  depoYaz(DEPO, durum.takip);
  bulutaKaydet();
  // taşınan kart parmağın altında kalsın, diğerleri onun etrafında kaysın
  const kart = () => document.getElementById(`sira-${id}`);
  const once = kart().getBoundingClientRect().top;
  ciz();
  window.scrollBy(0, kart().getBoundingClientRect().top - once);
  $(`.tutamac[data-id="${CSS.escape(id)}"]`).focus({ preventScroll: true });
}

function siralamaModu(acik) {
  durum.sirala = acik;
  ciz();
  window.scrollTo({ top: 0 });
}

function macHtmlIc(m) {
  // mini kart içinde: saat sütunu olmadan iki satır takım
  const oynandi = m.durum !== 'pre';
  const ids = takipIdler();
  const g = (m.goller || []).filter((x) => x.oyuncu).map((x) => `${kacis(x.dk)} ${kacis(x.oyuncu)}`).join(', ');
  return `${takimSatiri(m.ev, oynandi ? m.ev_skor ?? 0 : null, ids.has(m.ev.id) ? 'takipte' : '')}
    ${takimSatiri(m.dep, oynandi ? m.dep_skor ?? 0 : null, ids.has(m.dep.id) ? 'takipte' : '')}
    ${g ? `<div class="goller">⚽ ${g}</div>` : ''}`;
}

function sira(id, kod) {
  for (const tablo of durum.ligVeri[kod]?.tablolar || []) {
    const s = tablo.satirlar.find((x) => x.takim.id === id);
    if (s) return s;
  }
  return null;
}

// ---- Maçlar
function cizMaclar() {
  if (!durum.takip.length) return bosEkran('Maç listesi boş', 'Önce takip edeceğin takımları ekle.');
  const maclar = tumMaclar().filter(ilgili);
  const simdi = Date.now();
  const canli = maclar.filter((m) => m.durum === 'in');
  const yaklasan = maclar.filter((m) => m.durum === 'pre' && new Date(m.tarih) > simdi - 3 * 3600e3);
  const biten = maclar.filter((m) => m.durum === 'post' || (m.durum === 'pre' && ERTELENDI.has(m.durum_kodu) && new Date(m.tarih) < simdi));
  const sekmeler = `<div class="bolmeli" role="tablist">
    <button data-macsekme="yaklasan" class="${durum.macSekme === 'yaklasan' ? 'aktif' : ''}">Yaklaşan</button>
    <button data-macsekme="sonuclar" class="${durum.macSekme === 'sonuclar' ? 'aktif' : ''}">Sonuçlar</button>
  </div>`;
  let govde = '';
  if (canli.length) govde += `<h2 class="bolum-baslik"><span class="nokta"></span>Şu an oynanıyor</h2>` + gunlereGore(canli);
  if (durum.macSekme === 'yaklasan') {
    govde += `<h2 class="bolum-baslik">Yaklaşan maçlar</h2>` +
      (yaklasan.length ? gunlereGore(yaklasan.slice(0, 40)) : '<div class="kart bos">Yaklaşan maç bulunamadı.</div>');
  } else {
    govde += `<h2 class="bolum-baslik">Son sonuçlar</h2>` +
      (biten.length ? gunlereGore(biten.slice(-40), true) : '<div class="kart bos">Henüz sonuç yok.</div>');
  }
  return `<div class="ekran-ust"><h2 class="ekran-baslik">Maçlar</h2></div>` + sekmeler + govde;
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
      return `<tr class="${ids.has(s.takim.id) ? 'takipte' : ''}">
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
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const aramaBicim = (s) => isaretsiz(s).replace(/[øæœßłđðþ]/g, (h) => OZEL_HARF[h]);

function cizEkle() {
  if (!durum.ligler.length) return bosEkran('Takım listesi yok', 'Veriler hazır olduğunda takımları buradan ekleyebileceksin.', false);
  if (!durum.ekleLig) durum.ekleLig = durum.ligler[0].kod;
  const ids = takipIdler();
  const q = aramaBicim(durum.arama.trim());
  let takimlar;
  if (q) {
    const gorulen = new Set();
    takimlar = [];
    for (const l of durum.ligler) for (const t of l.takimlar || []) {
      if (!gorulen.has(t.id) && aramaBicim(t.ad).includes(q)) { gorulen.add(t.id); takimlar.push({ ...t, lig: l.kod }); }
    }
  } else {
    const lig = durum.ligler.find((l) => l.kod === durum.ekleLig) || durum.ligler[0];
    takimlar = (lig.takimlar || []).map((t) => ({ ...t, lig: lig.kod }));
  }
  const takipteki = durum.takip.length ? `<h2 class="bolum-baslik">Takip ettiklerin (${durum.takip.length})</h2>
    <div class="takim-izgara">${durum.takip.map((t) => takimDugme(t, true)).join('')}</div>` : '';
  return `<div class="ekran-ust"><button class="geri-dugme" data-git="takimlar" aria-label="Takımlarım'a dön">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <h2 class="ekran-baslik">Takım ekle</h2></div>
    ${takipteki}
    <h2 class="bolum-baslik">Ara ya da ligden seç</h2>
    <input class="arama" id="arama" type="search" placeholder="Takım ara (ör. Galatasaray, Arsenal)" value="${kacis(durum.arama)}" autocomplete="off">
    ${q ? '' : `<div class="secici">${durum.ligler.map((l) =>
      `<button class="cip ${l.kod === durum.ekleLig ? 'aktif' : ''}" data-eklelig="${kacis(l.kod)}">${kacis(l.ad)}</button>`).join('')}</div>`}
    <div class="takim-izgara" id="takimIzgara">${takimlar.length ? takimlar.map((t) => takimDugme(t, ids.has(t.id))).join('') : '<p class="bos">Sonuç bulunamadı.</p>'}</div>`;
}
function takimDugme(t, secili) {
  return `<button class="takim-sec ${secili ? 'secili' : ''}" data-takim="${kacis(t.id)}" data-lig="${kacis(t.lig)}" aria-pressed="${secili}">
    ${logoHtml(t, 'orta')}<span class="isim">${kacis(t.ad)}</span>
    <span class="isaret">${secili ? '<svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>' : ''}</span>
  </button>`;
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

function siralamaDegistir(siralama) {
  durum.siralama = siralama;
  depoYaz(SIRALAMA_DEPO, siralama);
  ciz();
}

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

// Profil'deki seçenek satırı (Görünüm, Takım sıralaması): data-<ad>="<değer>" düğmeleri
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
  // Takım bazında zil notu ("Bir takımın bildirimlerini tamamen kapatmak için...") 3. aşamada eklenecek.
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
      ${secimSatiri('Takım sıralaması', SIRALAMA_ACIKLAMA[durum.siralama], 'siralama', SIRALAMA_ADLARI, durum.siralama)}
    </section>

    <section class="kart profil-kart menu" aria-labelledby="pHakkinda"><h2 class="kart-baslik" id="pHakkinda">Hakkında</h2>
      <button class="menu-satir" id="gizlilikBtn">
        <span><b>Gizlilik politikası</b><small>${kacis(PRIVACY_URL.replace(/^https:\/\//, ''))}</small></span>${SAG_OK}
      </button>
      <a class="menu-satir" href="mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Taraftar geri bildirim')}">
        <span><b>Geri bildirim gönder</b><small>${FEEDBACK_EMAIL}</small></span>${DIS_OK}
      </a>
      <div class="menu-satir">
        <span><b>Sürüm</b><small>Skorlar maç sırasında dakikada bir güncellenir · son veri ${kacis(sonVeri)}</small></span>
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
  durum.sirala = false;
  yukle({ sessiz: true });
});
Bulut.bildirimGelince((b) => {
  tost([b.title, b.body?.split('\n')[0]].filter(Boolean).join(' · '), 5000);
  yukle({ sessiz: true });
});

// ------------------------------------------------------------------ olaylar
function sekmeyeGec(sekme) {
  durum.sekme = sekme;
  durum.sirala = false;
  ciz();
  window.scrollTo({ top: 0 });
}

// Android geri tuşu: pencere → sıralama modu → takım araması → Takım ekle'den Takımlarım'a
// → diğer sekmelerden Maçlar'a → arka plan
function geriTusu() {
  if (durum.onay) { durum.onay = null; ciz(); return; }
  if (durum.sirala) { siralamaModu(false); return; }
  if (durum.sekme === 'ekle' && durum.arama) { durum.arama = ''; ciz(); return; }
  if (durum.sekme === 'ekle') { sekmeyeGec('takimlar'); return; }
  if (durum.sekme !== 'maclar') { sekmeyeGec('maclar'); return; }
  const App = window.Capacitor.Plugins.App;
  App.minimizeApp().catch(() => App.exitApp());
}
if (Bulut.yerel) window.Capacitor.Plugins.App?.addListener('backButton', geriTusu);

document.addEventListener('click', (e) => {
  const h = e.target.closest('button, a');
  if (!h) return;
  if (h.dataset.sekme || h.dataset.git) {
    sekmeyeGec(h.dataset.sekme || h.dataset.git);
  } else if (h.dataset.macsekme) { durum.macSekme = h.dataset.macsekme; ciz(); }
  else if (h.dataset.puanlig) { durum.puanLig = h.dataset.puanlig; ciz(); }
  else if (h.dataset.eklelig) { durum.ekleLig = h.dataset.eklelig; ciz(); }
  else if (h.dataset.takim) takimDegistir(h.dataset.takim, h.dataset.lig);
  else if (h.dataset.bildirim) bildirimDegistir(h.dataset.bildirim);
  else if (h.dataset.tema) temaDegistir(h.dataset.tema);
  else if (h.dataset.siralama) siralamaDegistir(h.dataset.siralama);
  else if (h.id === 'siralaBtn') siralamaModu(true);
  else if (h.id === 'siralaBitti') siralamaModu(false);
  else if (h.id === 'yenileBtn') yukle();
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
  else if (e.key === 'Escape' && durum.sirala) siralamaModu(false);
  else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.classList?.contains('tutamac')) {
    e.preventDefault();
    takimTasi(e.target.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
  }
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
  yenilemeZamanlayici = setTimeout(() => yukle({ sessiz: true }), sicak ? 60e3 : 15 * 60e3);
}
document.addEventListener('visibilitychange', () => {
  // izin telefonun ayarlarından açılmış olabilir
  if (document.visibilityState === 'visible' && Bulut.yerel) izinKontrol();
  if (document.visibilityState === 'visible' && (!durum.sonYukleme || Date.now() - durum.sonYukleme > 60e3)) yukle({ sessiz: true });
});
setInterval(() => { if (document.visibilityState === 'visible' && durum.sekme === 'takimlar' && !durum.sirala) ciz(); }, 60e3);

if (!Bulut.yerel && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

temaUygula();
ciz();
yukle();
bulutBaslat();
