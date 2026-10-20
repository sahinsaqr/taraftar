package com.sahin.taraftar;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZeminPlugin.class);
        registerPlugin(AyarlarPlugin.class);
        super.onCreate(savedInstanceState);
        // Sayfa çizilene kadar WebView beyaz görünmesin: açılış zemininin aynısı (values(-night)/tema.xml).
        // Sayfa açılınca app.js seçili temanın rengini Zemin eklentisiyle verir.
        getBridge().getWebView().setBackgroundColor(getColor(R.color.acilis_zemin));
    }
}
