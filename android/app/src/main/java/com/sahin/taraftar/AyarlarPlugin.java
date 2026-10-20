package com.sahin.taraftar;

import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Profil > Bildirimler > "Bildirim sesi ve titreşim": Android'in bu uygulamaya ait bildirim ayarlarını açar
    (kanallar: Goller, Maç başladı · devre arası, Maç sonucu · ertelemeler, Maçtan önce hatırlatma). */
@CapacitorPlugin(name = "Ayarlar")
public class AyarlarPlugin extends Plugin {
    @PluginMethod
    public void bildirimAyarlari(PluginCall call) {
        String paket = getContext().getPackageName();
        Intent niyet;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            niyet = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, paket);
        } else {
            // Android 7: kanal yok, uygulama bilgi ekranı
            niyet = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + paket));
        }
        niyet.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(niyet);
            call.resolve();
        } catch (Exception e) {
            call.reject("Ayarlar açılamadı", e);
        }
    }

    /** Xiaomi/MIUI "Otomatik başlatma" ekranı (skor kartı uygulama kapalıyken gecikmesin); yoksa uygulama bilgisi. */
    @PluginMethod
    public void otomatikBaslatma(PluginCall call) {
        Intent miui = new Intent().setComponent(new ComponentName(
            "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Intent yedek = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(miui);
            call.resolve();
        } catch (Exception e) {
            try {
                getActivity().startActivity(yedek);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Ayar açılamadı", e2);
            }
        }
    }
}
