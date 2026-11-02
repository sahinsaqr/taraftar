// Web dosyalarını Android uygulamasına girecek www/ klasörüne kopyalar.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const DOSYALAR = ['index.html', 'app.js', 'bulut.js', 'firebase-ayar.js', 'style.css', 'manifest.webmanifest', 'kisaltmalar.json', 'ikonlar', 'kutuphane', 'yazitipleri'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const d of DOSYALAR) cpSync(d, `www/${d}`, { recursive: true });
// Uygulamaya package.json'ın tamamı (bağımlılık listesi) girmez; Profil ekranı için yalnız sürüm
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync('www/surum.json', `${JSON.stringify({ version })}\n`);
console.log(`www/ hazır: ${DOSYALAR.join(', ')}, surum.json (${version})`);
