package com.sahin.taraftar;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Pencere ve WebView zeminini uygulamanın seçili temasına uydurur (app.js temaUygula).
    Durum çubuğu ve gezinme çubuğu bölgeleri bu zemini gösterir. */
@CapacitorPlugin(name = "Zemin")
public class ZeminPlugin extends Plugin {
    @PluginMethod
    public void ayarla(PluginCall call) {
        String renk = call.getString("renk");
        int c;
        try {
            c = Color.parseColor(renk);
        } catch (Exception e) {
            call.reject("geçersiz renk: " + renk);
            return;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(c));
            getBridge().getWebView().setBackgroundColor(c);
            call.resolve();
        });
    }
}
