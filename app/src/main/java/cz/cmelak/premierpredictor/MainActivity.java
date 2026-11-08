package cz.cmelak.premierpredictor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
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
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
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
        // Only bundled local UI owns the native JS bridge. External links
        // (including PulseScore signup) open in the phone's default browser.
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request){
                Uri uri=request.getUrl();
                if("file".equals(uri.getScheme()))return false;
                try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){
                Uri uri=Uri.parse(url);
                if("file".equals(uri.getScheme()))return false;
                try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
                return true;
            }
        });
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
                        try {
                            responses.put(league, new JSONObject().put("error",
                                "Soutěž " + league + ": " + e.getMessage()));
                        } catch (Exception ignored) {}
                    }
                }
                final String result = responses.toString();
                runOnUiThread(() -> {
                    if (webView != null) webView.evaluateJavascript(
                        "window.receiveAllLeagues(" + JSONObject.quote(result) + ");", null);
                });
            });
        }

        @JavascriptInterface public void loadPaperHockeyResults(String requestedDates) {
            executor.execute(() -> {
                JSONArray results=new JSONArray(),unavailable=new JSONArray();
                try {
                    JSONArray days=new JSONArray(requestedDates);
                    if(days.length()>8)throw new IllegalArgumentException("Příliš mnoho datumů");
                    HashSet<String> seen=new HashSet<>();
                    LocalDate now=LocalDate.now(ZoneId.of("Europe/Prague"));
                    for(int i=0;i<days.length();i++){
                        String day=days.optString(i,"");
                        if(!day.matches("\\d{4}-\\d{2}-\\d{2}")||!seen.add(day))continue;
                        LocalDate target;
                        try{target=LocalDate.parse(day);}catch(Exception ignored){continue;}
                        if(!target.isBefore(now)||target.isBefore(now.minusDays(12)))continue;
                        try{
                            String json=readRemoteFast(HockeyScoreboard.URL_PREFIX+day+".json");
                            JSONObject parsed=HockeyScoreboard.parse(json,day,
                                java.time.Instant.now().toString());
                            JSONArray games=parsed.getJSONArray("events");
                            for(int k=0;k<games.length();k++)results.put(games.getJSONObject(k));
                        }catch(Exception e){unavailable.put(day);}
                    }
                }catch(Exception e){unavailable.put("Neplatný požadavek výsledků");}
                JSONObject response=new JSONObject();
                try{
                    response.put("results",results).put("unavailableDates",unavailable);
                    response.put("checkedAt",java.time.Instant.now().toString());
                }catch(Exception ignored){}
                final String payload=response.toString();
                runOnUiThread(()->{
                    if(webView!=null)webView.evaluateJavascript(
                        "window.receivePaperHockeyResults("+JSONObject.quote(payload)+");",null);
                });
            });
        }

        @JavascriptInterface public void saveChanceApiKey(String key) {
            executor.execute(() -> {
                String message;
                boolean ok=false;
                try{
                    ChanceKeyStore.save(MainActivity.this,key);
                    ok=true;message="Klíč datového poskytovatele uložen šifrovaně.";
                }catch(Exception ex){
                    message=ex.getMessage()==null?"Klíč nelze uložit.":ex.getMessage();
                }
                final boolean success=ok;
                final String result=message;
                runOnUiThread(() -> {
                    if(webView!=null)webView.evaluateJavascript(
                        "window.receiveChanceKeyStatus("+success+","+
                            JSONObject.quote(result)+");",null);
                });
            });
        }
        @JavascriptInterface public void clearChanceApiKey() {
            executor.execute(()->{
                ChanceKeyStore.clear(MainActivity.this);
                runOnUiThread(()->{
                    if(webView!=null)webView.evaluateJavascript(
                        "window.receiveChanceKeyStatus(false,"+
                            JSONObject.quote("Klíč byl odebrán.")+");",null);
                });
            });
        }
        @JavascriptInterface public void chanceKeyStatus() {
            executor.execute(()->{
                final boolean present=ChanceKeyStore.configured(MainActivity.this);
                runOnUiThread(()->{
                    if(webView!=null)webView.evaluateJavascript(
                        "window.receiveChanceKeyStatus("+present+","+
                            JSONObject.quote(present?"Klíč PulseScore je nastaven.":"Pro kurzy Chance je potřeba klíč PulseScore (bezplatný tarif BASIC).")+");",null);
                });
            });
        }
        @JavascriptInterface public void loadChanceOdds() {
            executor.execute(()->{
                String payload;
                try{
                    payload=downloadChanceOdds().toString();
                }catch(Exception e){
                    payload="{\"error\":"+JSONObject.quote(
                        "Kurzy Chance: "+(e.getMessage()==null?"nedostupné":e.getMessage()))+"}";
                }
                final String result=payload;
                runOnUiThread(()->{
                    if(webView!=null)webView.evaluateJavascript(
                        "window.receiveOdds("+JSONObject.quote(result)+",\"chance\");",null);
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
                        "window.receiveOdds(" + JSONObject.quote(result) + ",\"tipsport\");", null);
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
        if ("cz".equals(league)) {
            try{
                return downloadCurrentCzechLeagueFromFACR();
            }catch(Exception ignored){
                // Last-resort historical archive. It can be stale; no score
                // is manufactured when the authoritative current API is down.
            }
            LocalDate local=LocalDate.now(ZoneId.of("Europe/Prague"));
            int y=local.getMonthValue()>=7?local.getYear():local.getYear()-1;
            String season=y+"-"+String.format(Locale.ROOT,"%02d",(y+1)%100);
            String url="https://raw.githubusercontent.com/openfootball/europe/master/czech-republic/"
                +season+"_cz1.txt";
            String publishedResults=readRemote(url,"text/plain",1_400_000);
            JSONObject currentOdds=null;
            try {
                String html=readRemote(PublicOdds.SOURCE_URL,"text/html",700_000);
                currentOdds=PublicOdds.fromHtml(html,System.currentTimeMillis());
            } catch(Exception ignored) {
                // Previously published finished scores remain useful, but no
                // future fixture is invented when fresh odds/schedule is absent.
            }
            return CzechLeagueFeed.parse(publishedResults,currentOdds,y,
                java.time.Instant.now().toString()).toString();
        }
        if ("pl".equals(league)) {
            try {
                String bootstrap=readRemote(FplContext.BOOTSTRAP,"application/json",5_000_000);
                String fixtures=readRemote(FplContext.FIXTURES,"application/json",3_000_000);
                JSONObject parsed=FplContext.parse(bootstrap,fixtures,System.currentTimeMillis());
                try{
                    parsed.getJSONObject("context").put("futureCupFixtures",
                        fetchVerifiedCupCalendar(parsed.getJSONObject("context").getJSONArray("teams")));
                }catch(Exception ignored){}
                return parsed.toString();
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




    private String downloadCurrentCzechLeagueFromFACR() throws Exception {
        String endpoint=DenikCzechFeed.API;
        String yearRaw=readRemote(endpoint+"competition-years/current","application/json",200_000);
        JSONObject currentYear=new JSONObject(yearRaw);
        int season=currentYear.optInt("year",0);
        if(season<2020||season>2100)throw new IllegalArgumentException("Neznámý ročník");
        String competitions=readRemote(endpoint+"competitions?year="+season+"&limit=1000",
            "application/json",3_500_000);
        JSONObject league=DenikCzechFeed.selectCurrentLeague(yearRaw,competitions);
        String slug=league.getString("slug");
        String suffix=slug+"/"+season;
        JSONArray schedule=new JSONArray(readRemote(
            endpoint+"round-score/"+suffix,"application/json",350_000));
        JSONArray rounds=new JSONArray();
        LocalDate local=LocalDate.now(ZoneId.of("Europe/Prague"));
        HashSet<Integer> included=new HashSet<>();
        for(int i=0;i<schedule.length();i++){
            JSONObject row=schedule.optJSONObject(i);
            if(row==null)continue;
            int round=row.optInt("name",0);
            if(round<1||round>50||!included.add(round))continue;
            String date=row.optString("orientationDate","");
            java.time.OffsetDateTime stamp;
            try{stamp=java.time.OffsetDateTime.parse(date);}catch(Exception e){continue;}
            if(stamp.toLocalDate().isAfter(local.plusDays(17)))continue;
            try{
                String url=endpoint+"matches/get-matches-in-round/"+suffix+
                    "?roundName="+round;
                JSONObject response=new JSONObject(readRemoteFast(url));
                if(response.optJSONArray("matches")!=null)rounds.put(response);
            }catch(Exception ignored){}
        }
        if(rounds.length()<6)throw new IllegalStateException("Aktuální kola nejsou dostupná");
        return DenikCzechFeed.combine(rounds,slug,season,System.currentTimeMillis()).toString();
    }

    // ESPN public, verified upcoming cup fixtures. A looming cup match is a
    // SMALL rotation risk signal, never a claim that a club intends to lose.
    private JSONArray fetchVerifiedCupCalendar(JSONArray fplTeams) throws Exception {
        HashSet<String> allowed=new HashSet<>();
        for(int i=0;i<fplTeams.length();i++){
            JSONObject t=fplTeams.optJSONObject(i);
            if(t!=null)allowed.add(t.optString("name",""));
        }
        LocalDate today=LocalDate.now(ZoneOffset.UTC);
        DateTimeFormatter fmt=DateTimeFormatter.BASIC_ISO_DATE;
        String dates=fmt.format(today)+"-"+fmt.format(today.plusDays(28));
        String[] cups={"uefa.champions","uefa.europa","uefa.europa.conf","eng.fa","eng.league_cup"};
        String[] names={"Liga mistrů","Evropská liga","Konferenční liga","FA Cup","Ligový pohár"};
        JSONArray out=new JSONArray();
        for(int j=0;j<cups.length;j++){
            String url="https://site.api.espn.com/apis/site/v2/sports/soccer/"+
                cups[j]+"/scoreboard?dates="+dates+"&limit=250";
            JSONObject json;
            try{json=new JSONObject(readRemoteFast(url));}catch(Exception ex){continue;}
            JSONArray events=json.optJSONArray("events");
            if(events==null)continue;
            for(int k=0;k<events.length();k++){
                JSONObject ev=events.optJSONObject(k);
                if(ev==null)continue;
                String kickoff=ev.optString("date","");
                long unixTime;
                try{unixTime=java.time.Instant.parse(kickoff).toEpochMilli();}
                catch(Exception ex){continue;}
                if(unixTime<=System.currentTimeMillis())continue;
                JSONArray competitions=ev.optJSONArray("competitions");
                JSONObject comp=competitions!=null?competitions.optJSONObject(0):null;
                JSONArray participants=comp!=null?comp.optJSONArray("competitors"):null;
                if(participants==null)continue;
                for(int q=0;q<participants.length();q++){
                    JSONObject member=participants.optJSONObject(q);
                    JSONObject club=member!=null?member.optJSONObject("team"):null;
                    String name=club!=null?club.optString("displayName",""):"";
                    name=canonicalCupClub(name);
                    if(!allowed.contains(name))continue;
                    String stage=ev.optString("name","").toLowerCase(Locale.ROOT);
                    out.put(new JSONObject().put("team_id",name).put("kickoff",kickoff)
                        .put("competition",names[j])
                        .put("stage",stage.matches(".*(final|quarter|semi|round of).*")?
                            "knockout":"unknown")
                        .put("verified",true).put("source","ESPN cup calendar"));
                }
            }
        }
        return out;
    }
    private String canonicalCupClub(String club) {
        if ("Man United".equals(club)||"Manchester United FC".equals(club))return "Manchester United";
        if ("Man City".equals(club))return "Manchester City";
        if ("Tottenham".equals(club)||"Spurs".equals(club))return "Tottenham Hotspur";
        if ("Wolves".equals(club))return "Wolverhampton Wanderers";
        if ("Brighton & Hove Albion".equals(club))return "Brighton";
        if ("Newcastle".equals(club))return "Newcastle United";
        if ("West Ham".equals(club))return "West Ham United";
        if ("AFC Bournemouth".equals(club))return "Bournemouth";
        return club.replaceAll(" FC$","");
    }
    private String readRemoteFast(String address) throws Exception {
        HttpURLConnection conn=(HttpURLConnection)new URL(address).openConnection();
        conn.setConnectTimeout(3500);conn.setReadTimeout(4000);
        conn.setRequestProperty("Accept","application/json");
        conn.setRequestProperty("User-Agent","SportPredictorAI/3.0 Android");
        try{
            if(conn.getResponseCode()!=200)throw new IllegalStateException("ESPN cup calendar not available");
            try(InputStream input=conn.getInputStream(); ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;
                while((n=input.read(buffer))!=-1){
                    if(output.size()+n>1_300_000)throw new IllegalStateException("ESPN cup response too large");
                    output.write(buffer,0,n);
                }
                return output.toString("UTF-8");
            }
        }finally{conn.disconnect();}
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


    // Read-only Chance pre-match board from documented independent API.
    // No bookmaker account is accessed, and no bets are placed.
    private JSONObject downloadChanceOdds() throws Exception {
        String key=ChanceKeyStore.load(this);
        if(key==null||key.trim().isEmpty())
            throw new IllegalStateException("Chybí API klíč PulseScore. Bez klíče nelze ověřit kurzy Chance.");
        JSONArray soccer=new JSONArray(),hockey=new JSONArray();
        String[] types={"soccer","ice-hockey"};
        for(int index=0;index<types.length;index++){
            JSONArray destination=index==0?soccer:hockey;
            for(int page=1;page<=4;page++){
                String url=ChanceOddsFeed.API+types[index]+"/events?page="+page+"&limit=30";
                String response=readChancePage(url,key);
                JSONObject json=new JSONObject(response);
                if(json.optJSONArray("events")==null)
                    throw new IllegalStateException("API Chance vrátilo neplatnou odpověď.");
                destination.put(json);
                if(!json.optBoolean("hasNextPage",false)||
                   json.getJSONArray("events").length()==0)break;
            }
        }
        JSONObject parsed=ChanceOddsFeed.parse(soccer,hockey,System.currentTimeMillis());
        if(parsed.getJSONArray("offers").length()==0) {
            // Valid empty results must never be replaced with prices from
            // unrelated market, period, or another sportsbook.
            parsed.put("note","Chance API funguje, ale v načtených stránkách dnes nejsou "
                +"ověřené předzápasové kurzy 1/X/2 pro sledované soutěže.");
        }
        return parsed;
    }
    private String readChancePage(String address,String key) throws Exception {
        java.net.HttpURLConnection conn=(java.net.HttpURLConnection)new URL(address).openConnection();
        conn.setConnectTimeout(9000);conn.setReadTimeout(10000);
        conn.setRequestProperty("Accept","application/json");
        conn.setRequestProperty("x-secret",key);
        conn.setRequestProperty("User-Agent","SportPredictorAI/3.2 (personal research)");
        try{
            int status=conn.getResponseCode();
            if(status==401||status==403)throw new IllegalStateException(
                "API klíč PulseScore není platný nebo nemá přístup ke kurzům Chance.");
            if(status==429)throw new IllegalStateException(
                "Byl překročen limit požadavků PulseScore. Zkus to později.");
            if(status!=200)throw new IllegalStateException("Datový zdroj Chance HTTP "+status);
            try(InputStream input=conn.getInputStream();
                ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] bytes=new byte[8192];int n;
                while((n=input.read(bytes))!=-1){
                    if(output.size()+n>4_000_000)
                        throw new IllegalStateException("Příliš velká odpověď Chance API");
                    output.write(bytes,0,n);
                }
                return output.toString("UTF-8");
            }
        }finally{conn.disconnect();}
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
