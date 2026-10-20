// Web dosyalarını Android uygulamasına girecek www/ klasörüne kopyalar.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const DOSYALAR = ['index.html', 'app.js', 'bulut.js', 'firebase-ayar.js', 'style.css', 'manifest.webmanifest', 'ikonlar', 'kutuphane', 'yazitipleri', 'package.json'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const d of DOSYALAR) cpSync(d, `www/${d}`, { recursive: true });
console.log(`www/ hazır: ${DOSYALAR.join(', ')}`);
