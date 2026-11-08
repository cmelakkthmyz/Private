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
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZoneId;
import java.time.LocalTime;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public final class MainActivity extends Activity {
    private WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicInteger requestSerial = new AtomicInteger(0);
    private final ConcurrentHashMap<String, String> cachedFeeds = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> cachedTimes = new ConcurrentHashMap<>();

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
        @JavascriptInterface public void loadAllLeagues() {
            executor.execute(() -> {
                JSONObject responses = new JSONObject();
                for (String league : new String[]{"pl", "cz", "hockey"}) {
                    try {
                        responses.put(league, new JSONObject(downloadFixtures(league)));
                    } catch (Exception e) {
                        responses.put(league, new JSONObject().put("error",
                            "Soutěž " + league + ": " + e.getMessage()));
                    }
                }
                final String result = responses.toString();
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript(
                        "window.receiveAllLeagues(" + JSONObject.quote(result) + ");", null);
                });
            });
        }

        @JavascriptInterface public void loadOdds() {
            executor.execute(() -> {
                String payload;
                try {
                    String html = readRemote(PublicOdds.SOURCE_URL, "text/html");
                    payload = PublicOdds.fromHtml(html, System.currentTimeMillis()).toString();
                } catch (Exception e) {
                    payload = "{\"error\":" + JSONObject.quote("Automatické načítání kurzů: " + e.getMessage()) + "}";
                }
                final String result = payload;
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript(
                        "window.receiveOdds(" + JSONObject.quote(result) + ");", null);
                });
            });
        }

        @JavascriptInterface public void loadFixtures(String league) {
            final int serial = requestSerial.incrementAndGet();
            executor.execute(() -> {
                String json;
                try {
                    json = downloadFixtures(league);
                } catch (Exception e) {
                    json = "{\"error\":" + JSONObject.quote("Načítání dat selhalo: " + e.getMessage()) + "}";
                }
                final String value = json;
                runOnUiThread(() -> {
                    if (webView != null && serial == requestSerial.get()) webView.evaluateJavascript(
                        "window.receiveMatches(" + JSONObject.quote(value) + "," + JSONObject.quote(league) + ");", null);
                });
            });
        }
    }

    private String downloadFixtures(String league) throws Exception {
        if (!"pl".equals(league) && !"cz".equals(league) && !"hockey".equals(league))
            throw new IllegalArgumentException("Neznámá soutěž");
        Long timestamp=cachedTimes.get(league);
        String cached=cachedFeeds.get(league);
        if (cached != null && timestamp != null && System.currentTimeMillis()-timestamp < 10*60_000L)
            return cached;
        String data=downloadUncachedFixtures(league);
        cachedFeeds.put(league,data);
        cachedTimes.put(league,System.currentTimeMillis());
        return data;
    }

    private String downloadUncachedFixtures(String league) throws Exception {
        if ("hockey".equals(league)) return downloadCzechHockey();
        if ("pl".equals(league)) {
            try {
                String bootstrap=readRemote(FplContext.BOOTSTRAP,"application/json",5_000_000);
                String fixtures=readRemote(FplContext.FIXTURES,"application/json",3_000_000);
                return FplContext.parse(bootstrap,fixtures,System.currentTimeMillis()).toString();
            } catch (Exception ignored) {
                // A missing or temporarily blocked FPL endpoint must not stop
                // Premier League results from being shown through ESPN.
            }
        }
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        int season = today.getMonthValue() >= 7 ? today.getYear() : today.getYear()-1;
        String dates = season + "0801-" + (season+1) + "0630";
        String competition = "cz".equals(league) ? "cze.1" : "eng.1";
        URL url = new URL("https://site.api.espn.com/apis/site/v2/sports/soccer/" + competition + "/scoreboard?dates=" + dates + "&limit=500");
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


    // CC BY 4.0 public Czech sports data. No bookmaker credentials required.
    // This feed is a daily schedule only; it does NOT contain final 60-minute results.
    private String downloadCzechHockey() throws Exception {
        String root = "https://raw.githubusercontent.com/LiborP75/lp75-open-data/main/sazkyweb/";
        JSONObject daily = new JSONObject(readRemote(root + "dnes.json"));
        JSONObject standing = new JSONObject(readRemote(root + "extraliga-tabulka.json"));
        LocalDate today = LocalDate.now(ZoneId.of("Europe/Prague"));
        String date = daily.optString("datum", "");
        JSONArray events = new JSONArray();
        if (today.toString().equals(date)) {
            JSONArray matches = daily.optJSONArray("zapasy");
            if (matches != null) {
                for (int i = 0; i < matches.length(); i++) {
                    JSONObject game = matches.optJSONObject(i);
                    if (game == null) continue;
                    String league = game.optString("soutez", "").toLowerCase(Locale.ROOT);
                    if (!league.contains("extraliga") || league.contains("slovensk")) continue;
                    String home = game.optString("domaci", "");
                    String away = game.optString("hoste", "");
                    String start = game.optString("cas", "");
                    if (home.isEmpty() || away.isEmpty()) continue;
                    try {
                        String utc = today.atTime(LocalTime.parse(start))
                            .atZone(ZoneId.of("Europe/Prague")).toInstant().toString();
                        JSONObject event = new JSONObject();
                        event.put("id", date + "_" + i);
                        event.put("date", utc);
                        event.put("home", home);
                        event.put("away", away);
                        event.put("source", daily.optString("source_url", ""));
                        events.put(event);
                    } catch (Exception ignore) {
                        // Invalid kick-off time: skip rather than invent a time.
                    }
                }
            }
        }
        JSONObject result = new JSONObject();
        result.put("sport", "hockey");
        result.put("events", events);
        result.put("standings", standing.optJSONArray("tabulka"));
        result.put("source", standing.optString("source_url", "https://sazkyweb.cz"));
        result.put("updated", standing.optString("updated", ""));
        result.put("scheduleDate", date);
        result.put("scheduleCurrent", today.toString().equals(date));
        result.put("licence", "CC BY 4.0, zdroj: SazkyWeb.cz");
        return result.toString();
    }

    private String readRemote(String address) throws Exception {
        return readRemote(address, "application/json");
    }

    private String readRemote(String address, String accept) throws Exception {
        return readRemote(address, accept, 2_000_000);
    }

    private String readRemote(String address, String accept, int maxBytes) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(address).openConnection();
        conn.setConnectTimeout(11000);
        conn.setReadTimeout(14000);
        conn.setRequestProperty("Accept", accept);
        conn.setRequestProperty("User-Agent", "PremierLeaguePredictor/2.1 Android");
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new IllegalStateException("Zdroj HTTP " + code);
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (out.size() + n > maxBytes) throw new IllegalStateException("Velikost sportovních dat překročena");
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
