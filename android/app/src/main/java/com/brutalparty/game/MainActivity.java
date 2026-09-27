package com.brutalparty.game;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Kabuğun native yüzü. Amaç: tarayıcı çubuğu sorununu "gizlemek" değil, hiç
 * var etmemek — ve JS tarafının yapamadığı üç şeyi üstlenmek.
 *
 * 1) EKRAN AÇIK KALIR. `navigator.wakeLock` WebView'da yoktur; `main.js`'teki
 *    `requestHostWakeLock()` bu yüzden sessizce `null` dönüyor ve host telefonu
 *    maç ortasında uyuyordu.
 * 2) GERİ TUŞU KABUK YIĞININA GİDER. Capacitor 8 geri tuşunu `@capacitor/app`
 *    eklentisine taşıdı; o eklenti kurulu değil, bu yüzden varsayılan davranış
 *    uygulamayı anında öldürüyordu. `appShell` her görünümde
 *    `history.pushState` yazdığı için (src/ui/appShell.js) WebView'da geri
 *    gitmek `popstate` üretir ve kabuğun kendi `back()`'i çalışır. Yeni bir
 *    bağımlılık eklemenin bedeli `package.json` + kilit dosyasıydı; burada
 *    gerekmiyor.
 * 3) ÇUBUKLAR PERDE GİBİ DAVRANIR. Durum/gezinme çubukları gizlenir ve
 *    kenara kaydırma jestiyle geçici olarak çağrılır; WebView tüm ekranı
 *    kaplar, çentik payı `env(safe-area-inset-*)` üzerinden playfield'a akar
 *    (src/core/playfield.js kompakt yatayda güvenli alanı oradan okur).
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());

        // `onBackPressed()` API 33'de kullanımdan kalktı; dispatcher her
        // sürümde androidx.activity üzerinden doğru yoldur.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                // Yığının kökündeyiz: kabukta gidilecek yer yok, sistem devralır.
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }
}
