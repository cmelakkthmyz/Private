package cz.cmelak.premierpredictor;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean loading = new AtomicBoolean(false);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(10, 19, 35));
        getWindow().setNavigationBarColor(Color.rgb(10, 19, 35));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(10, 19, 35));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new Bridge(), "AndroidPredictor");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    private final class Bridge {
        @JavascriptInterface public void loadFixtures() {
            if (!loading.compareAndSet(false, true)) return;
            executor.execute(() -> {
                String json;
                try {
                    json = downloadFixtures();
                } catch (Exception e) {
                    json = "{\"error\":" + JSONObject.quote("Načítání ESPN selhalo: " + e.getMessage()) + "}";
                } finally {
                    loading.set(false);
                }
                final String value = json;
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript(
                        "window.receiveMatches(" + JSONObject.quote(value) + ");", null);
                });
            });
        }
    }

    private String downloadFixtures() throws Exception {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        int season = today.getMonthValue() >= 7 ? today.getYear() : today.getYear()-1;
        String dates = season + "0801-" + (season+1) + "0630";
        URL url = new URL("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=" + dates + "&limit=500");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(16000);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("Accept-Encoding", "identity");
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android) PremierLeaguePredictor/1.0");
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new IllegalStateException("HTTP " + code);
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (out.size() + n > 12000000) throw new IllegalStateException("Příliš mnoho dat");
                    out.write(buf, 0, n);
                }
                return out.toString("UTF-8");
            }
        } finally {
            conn.disconnect();
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
