package com.sahin.taraftar;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.RemoteMessage;
import io.capawesome.capacitorjs.plugins.firebase.messaging.MessagingService;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * "Skor kartı" bildirimi (Profil > Bildirimler > Bildirim görünümü).
 *
 * Sunucu (arka_plan/bildirim.py → kart_gonder) t{ID}_{tür}k konularına yalnız veri mesajı gönderir; burada
 * RemoteViews + DecoratedCustomViewStyle ile çizilir. Eklentinin MessagingService'ini genişletir (manifest'te
 * onun yerine bu kayıtlı), böylece veri mesajı yine JS'e iletilir (uygulama açıksa veri yenilenir).
 * Kanal, ses, etiket (maç id) ve renk sade metin bildirimiyle aynı; dokununca o maçın detayı açılır.
 */
public class BildirimServisi extends MessagingService {

    private static final String ETIKET = "Taraftar.Kart";
    private static final int LIME = 0xFFC8F04A;
    private static final long LOGO_BEKLE_MS = 3000;          // logolar en fazla 3 sn beklenir
    private static final long LOGO_SAKLA_MS = 30L * 24 * 3600 * 1000;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage mesaj) {
        Map<String, String> v = mesaj.getData();
        if ("1".equals(v.get("kart"))) {
            try {
                kartGoster(v);
            } catch (Exception h) {
                Log.w(ETIKET, "skor kartı gösterilemedi", h);
            }
        }
        super.onMessageReceived(mesaj);   // JS'e de iletilir (uygulama açıksa veri yenilenir)
    }

    private static String al(Map<String, String> v, String anahtar) {
        String d = v.get(anahtar);
        return d == null ? "" : d;
    }

    private void kartGoster(Map<String, String> v) {
        String kanal = al(v, "kanal").isEmpty() ? "mac_durumu" : al(v, "kanal");
        kanalHazirla(kanal);
        String mac = al(v, "mac");
        String olay = al(v, "olay");
        String atan = al(v, "atan");

        // logolar paralel, en fazla 3 sn; inmezse kulüp renginde daire + kısaltma
        Bitmap[] logolar = logolariAl(v);

        // skor: son golü atan tarafın skoru vurgu renginde (koyuda lime, açıkta koyu yeşil: values(-night))
        String evSkor = al(v, "ev_skor"), depSkor = al(v, "dep_skor");
        String skor = evSkor + " – " + depSkor;
        SpannableString skorYazi = new SpannableString(skor);
        if ("gol".equals(olay) && !atan.isEmpty()) {
            int vurgu = ContextCompat.getColor(this, R.color.kart_vurgu);
            int bas = "ev".equals(atan) ? 0 : skor.length() - depSkor.length();
            int son = "ev".equals(atan) ? evSkor.length() : skor.length();
            skorYazi.setSpan(new ForegroundColorSpan(vurgu), bas, son, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        RemoteViews kucuk = new RemoteViews(getPackageName(), R.layout.bildirim_kart_kucuk);
        kucuk.setImageViewBitmap(R.id.ev_logo, logolar[0]);
        kucuk.setImageViewBitmap(R.id.dep_logo, logolar[1]);
        kucuk.setTextViewText(R.id.ev_kisa, al(v, "ev_kisa"));
        kucuk.setTextViewText(R.id.dep_kisa, al(v, "dep_kisa"));
        kucuk.setTextViewText(R.id.skor, skorYazi);
        kucuk.setTextViewText(R.id.olay, kisaOlay(olay, v));

        RemoteViews buyuk = new RemoteViews(getPackageName(), R.layout.bildirim_kart_buyuk);
        buyuk.setImageViewBitmap(R.id.ev_logo, logolar[0]);
        buyuk.setImageViewBitmap(R.id.dep_logo, logolar[1]);
        buyuk.setTextViewText(R.id.ev_ad, al(v, "ev_ad"));
        buyuk.setTextViewText(R.id.dep_ad, al(v, "dep_ad"));
        buyuk.setTextViewText(R.id.skor, skorYazi);
        buyuk.setTextViewText(R.id.lig, al(v, "lig"));
        // golde oyuncu satırı golü atan takımın altında; diğer olaylarda ortada durum yazısı
        String oyuncu = golSatiri(v);
        boolean golSatiriVar = ("gol".equals(olay) || "iptal".equals(olay)) && !atan.isEmpty();
        buyuk.setTextViewText(R.id.ev_alt, golSatiriVar && "ev".equals(atan) ? oyuncu : "");
        buyuk.setTextViewText(R.id.dep_alt, golSatiriVar && "dep".equals(atan) ? oyuncu : "");
        buyuk.setViewVisibility(R.id.ev_alt, golSatiriVar && "ev".equals(atan) ? View.VISIBLE : View.GONE);
        buyuk.setViewVisibility(R.id.dep_alt, golSatiriVar && "dep".equals(atan) ? View.VISIBLE : View.GONE);
        String durum = durumYazisi(olay);
        buyuk.setTextViewText(R.id.durum, durum);
        buyuk.setViewVisibility(R.id.durum, durum.isEmpty() ? View.GONE : View.VISIBLE);

        // dokununca: FCM'nin bildirimiyle aynı yol (google.message_id + veri → eklenti → JS → maç detayı)
        Intent ac = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("google.message_id", "kart-" + mac + "-" + System.currentTimeMillis())
            .putExtra("mac", mac)
            .putExtra("tur", al(v, "tur"))
            .putExtra("olay", olay);
        PendingIntent pi = PendingIntent.getActivity(this, mac.hashCode(), ac,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, kanal)
            .setSmallIcon(R.drawable.ic_stat_taraftar)
            .setColor(LIME)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(kucuk)
            .setCustomBigContentView(buyuk)
            .setCustomHeadsUpContentView(kucuk)
            .setContentTitle(al(v, "baslik"))     // kilit ekranı / erişilebilirlik için düz metin
            .setContentText(al(v, "govde"))
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setPriority("goller".equals(kanal) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pi);

        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManagerCompat.from(this).notify(mac, 0, b.build());   // etiket = maç id: aynı maçın yenisi öncekinin yerine
    }

    private static String kisaOlay(String olay, Map<String, String> v) {
        switch (olay) {
            case "gol": return "⚽ " + al(v, "dk");
            case "iptal": return "Gol iptal";
            case "basladi": return "Başladı";
            case "devre": return "Devre";
            case "bitti": return "Bitti";
            case "ertelendi": return "Ertelendi";
            default: return "";
        }
    }

    private static String durumYazisi(String olay) {
        switch (olay) {
            case "basladi": return "Maç başladı";
            case "devre": return "Devre arası";
            case "bitti": return "Maç sonu";
            case "ertelendi": return "Maç ertelendi";
            default: return "";
        }
    }

    private static String golSatiri(Map<String, String> v) {
        if ("iptal".equals(al(v, "olay"))) return "❌ Gol iptal " + al(v, "dk");
        String ek = "1".equals(al(v, "kk")) ? " (k.k.)" : "1".equals(al(v, "pen")) ? " (p)" : "";
        return ("⚽ " + al(v, "dk") + " " + al(v, "oyuncu") + ek).trim();
    }

    // ---- logolar
    private Bitmap[] logolariAl(Map<String, String> v) {
        Bitmap[] sonuc = new Bitmap[2];
        String[] taraflar = { "ev", "dep" };
        ExecutorService havuz = Executors.newFixedThreadPool(2);
        try {
            @SuppressWarnings("unchecked")
            Future<Bitmap>[] isler = new Future[2];
            for (int i = 0; i < 2; i++) {
                final String url = al(v, taraflar[i] + "_logo");
                isler[i] = havuz.submit(() -> logoIndir(url));
            }
            long bitis = System.currentTimeMillis() + LOGO_BEKLE_MS;
            for (int i = 0; i < 2; i++) {
                try {
                    sonuc[i] = isler[i].get(Math.max(1, bitis - System.currentTimeMillis()), TimeUnit.MILLISECONDS);
                } catch (Exception h) {
                    sonuc[i] = null;
                }
            }
        } finally {
            havuz.shutdownNow();
        }
        for (int i = 0; i < 2; i++) {
            if (sonuc[i] == null) sonuc[i] = yedekLogo(al(v, taraflar[i] + "_kisa"), al(v, taraflar[i] + "_renk"));
        }
        return sonuc;
    }

    /** Önbellekte varsa oradan, yoksa indirir ve önbelleğe yazar (cacheDir/logolar). */
    private Bitmap logoIndir(String url) {
        if (url.isEmpty()) return null;
        File klasor = new File(getCacheDir(), "logolar");
        File dosya = new File(klasor, ozet(url) + ".png");
        if (dosya.exists() && System.currentTimeMillis() - dosya.lastModified() < LOGO_SAKLA_MS) {
            Bitmap b = BitmapFactory.decodeFile(dosya.getAbsolutePath());
            if (b != null) return b;
        }
        HttpURLConnection baglanti = null;
        try {
            baglanti = (HttpURLConnection) new URL(url).openConnection();
            baglanti.setConnectTimeout((int) LOGO_BEKLE_MS);
            baglanti.setReadTimeout((int) LOGO_BEKLE_MS);
            if (baglanti.getResponseCode() != 200) return null;
            byte[] veri;
            try (InputStream in = baglanti.getInputStream(); java.io.ByteArrayOutputStream tampon = new java.io.ByteArrayOutputStream()) {
                byte[] parca = new byte[8192];   // readAllBytes Android 13'ten önce yok
                for (int n; (n = in.read(parca)) != -1; ) tampon.write(parca, 0, n);
                veri = tampon.toByteArray();
            }
            Bitmap b = BitmapFactory.decodeByteArray(veri, 0, veri.length);
            if (b != null) {
                klasor.mkdirs();
                try (FileOutputStream out = new FileOutputStream(dosya)) {
                    out.write(veri);
                }
            }
            return b;
        } catch (Exception h) {
            return null;
        } finally {
            if (baglanti != null) baglanti.disconnect();
        }
    }

    private static String ozet(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte x : d) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception h) {
            return Integer.toHexString(s.hashCode());
        }
    }

    /** Kulüp renginde daire + kısaltma (yazı rengi zemine göre beyaz ya da lacivert). */
    private Bitmap yedekLogo(String kisa, String renk) {
        int px = (int) (40 * getResources().getDisplayMetrics().density);
        Bitmap b = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        int zemin;
        try {
            zemin = renk.matches("^#?[0-9a-fA-F]{6}$") ? Color.parseColor(renk.startsWith("#") ? renk : "#" + renk) : 0xFF4D6890;
        } catch (Exception h) {
            zemin = 0xFF4D6890;
        }
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(zemin);
        c.drawCircle(px / 2f, px / 2f, px / 2f, p);
        double parlaklik = (0.299 * Color.red(zemin) + 0.587 * Color.green(zemin) + 0.114 * Color.blue(zemin)) / 255;
        p.setColor(parlaklik > 0.6 ? 0xFF1B2D4B : Color.WHITE);
        p.setTextAlign(Paint.Align.CENTER);
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextSize(px * 0.34f);
        String yazi = kisa.length() > 3 ? kisa.substring(0, 3) : kisa;
        c.drawText(yazi, px / 2f, px / 2f - (p.descent() + p.ascent()) / 2, p);
        return b;
    }

    /** Kanal yoksa (uygulama kurulduktan sonra hiç açılmadıysa) oluşturur; tanımlar bulut.js → KANALLAR ile aynı. */
    private void kanalHazirla(String kanal) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(kanal) != null) return;
        NotificationChannel k;
        switch (kanal) {
            case "goller":
                k = new NotificationChannel(kanal, "Goller", NotificationManager.IMPORTANCE_HIGH);
                k.setDescription("Takımlarının attığı ve yediği goller, iptal edilen goller");
                k.setSound(Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/raw/gol_sesi"),
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                k.enableLights(true);
                k.setLightColor(LIME);
                break;
            case "mac_sonucu":
                k = new NotificationChannel(kanal, "Maç sonucu · ertelemeler", NotificationManager.IMPORTANCE_DEFAULT);
                k.setDescription("Maç bitince skor; ertelenen ya da durdurulan maçlar");
                break;
            default:
                k = new NotificationChannel(kanal, "Maç başladı · devre arası", NotificationManager.IMPORTANCE_DEFAULT);
                k.setDescription("Maçın başlaması ve devre arası skoru");
        }
        k.enableVibration(true);
        nm.createNotificationChannel(k);
    }
}
