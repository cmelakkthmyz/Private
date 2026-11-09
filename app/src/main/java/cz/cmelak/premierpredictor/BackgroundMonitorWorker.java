package cz.cmelak.premierpredictor;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;

/**
 * Every six hours, Android schedules a real background sync, even when the
 * activity is closed. Device Doze/force-stop/network availability can delay it.
 * This is read-only statistical research and never places any wagers.
 */
public final class BackgroundMonitorWorker extends Worker {
    private static final String PREFS="sport-predictor-background-v1";
    private static final String JOB="sport-predictor-six-hour-sync";
    private static final String ONE_SHOT="sport-predictor-manual-sync";
    private static final ZoneId PRAGUE=ZoneId.of("Europe/Prague");
    public BackgroundMonitorWorker(@NonNull Context context,@NonNull WorkerParameters params){
        super(context,params);
    }
    static SharedPreferences prefs(Context c){
        return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
    }
    public static boolean enabled(Context c){return prefs(c).getBoolean("enabled",true);}
    public static void setEnabled(Context c,boolean active){
        prefs(c).edit().putBoolean("enabled",active).apply();
        if(active)schedule(c);
        else {
            WorkManager wm=WorkManager.getInstance(c);
            wm.cancelUniqueWork(JOB);wm.cancelUniqueWork(ONE_SHOT);
        }
    }
    private static Constraints network(){
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }
    public static void schedule(Context c){
        if(!enabled(c))return;
        // Unique work stays scheduled through app closure and normal device reboot.
        PeriodicWorkRequest request=new PeriodicWorkRequest.Builder(
            BackgroundMonitorWorker.class,6,TimeUnit.HOURS)
                .setConstraints(network()).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(JOB,
                ExistingPeriodicWorkPolicy.KEEP,request);
    }
    public static void checkNow(Context c){
        if(!enabled(c))return;
        OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(
            BackgroundMonitorWorker.class).setConstraints(network()).build();
        WorkManager.getInstance(c).enqueueUniqueWork(ONE_SHOT,ExistingWorkPolicy.KEEP,work);
    }
    public static synchronized JSONObject readLedger(Context c){
        try{
            JSONObject j=new JSONObject(prefs(c).getString("ledger",""));
            if(j.optInt("version")==1&&j.optJSONArray("records")!=null)return j;
        }catch(Exception ignored){}
        return BackgroundForecastEngine.empty();
    }
    private static void store(Context c,JSONObject j){
        // commit() is synchronous so Android process death cannot discard forecasts.
        prefs(c).edit().putString("ledger",j.toString()).commit();
    }
    public static JSONObject status(Context c){
        JSONObject j=readLedger(c);
        return BackgroundForecastEngine.summary(j).put("enabled",enabled(c))
            .put("intervalHours",6)
            .put("note","Pravidelný běh na pozadí; Android může termín zpozdit kvůli baterii či síti. "
                +"Odhady nejsou stejné jako tržní kurzy. Tipsport aréna nemá ověřený veřejný export.");
    }
    private static String request(String address,String accept,int maximum) throws Exception{
        HttpURLConnection conn=(HttpURLConnection)new URL(address).openConnection();
        conn.setConnectTimeout(9000);conn.setReadTimeout(12000);
        conn.setRequestProperty("Accept",accept);
        conn.setRequestProperty("User-Agent","SportPredictorAI/3.6 (Android background research)");
        conn.setInstanceFollowRedirects(true);
        try{
            int code=conn.getResponseCode();
            if(code!=200)throw new IllegalStateException("HTTP "+code);
            try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] buf=new byte[8192];int n;
                while((n=in.read(buf))!=-1){
                    if(out.size()+n>maximum)throw new IllegalStateException("Odpověď příliš velká");
                    out.write(buf,0,n);
                }
                return out.toString("UTF-8");
            }
        }finally{conn.disconnect();}
    }
    private static String json(String url,int maximum) throws Exception{
        return request(url,"application/json",maximum);
    }
    private static JSONObject pl() throws Exception{
        try{
            String bootstrap=json(FplContext.BOOTSTRAP,5_000_000);
            String fixtures=json(FplContext.FIXTURES,3_500_000);
            return FplContext.parse(bootstrap,fixtures,System.currentTimeMillis());
        }catch(Exception fallback){
            return espn("eng.1");
        }
    }
    private static JSONObject espn(String competition) throws Exception {
        LocalDate now=LocalDate.now(PRAGUE);
        int year=now.getMonthValue()>=7?now.getYear():now.getYear()-1;
        String dates=year+"0801-"+(year+1)+"0630";
        return new JSONObject(json("https://site.api.espn.com/apis/site/v2/sports/soccer/"
            +competition+"/scoreboard?dates="+dates+"&limit=600",12_000_000));
    }
    private static JSONObject cz() throws Exception{
        try{
            String root=DenikCzechFeed.API;
            String yearRaw=json(root+"competition-years/current",250_000);
            int year=new JSONObject(yearRaw).optInt("year",0);
            String competitions=json(root+"competitions?year="+year+"&limit=1000",4_000_000);
            JSONObject league=DenikCzechFeed.selectCurrentLeague(yearRaw,competitions);
            String suffix=league.getString("slug")+"/"+year;
            JSONArray schedule=new JSONArray(json(root+"round-score/"+suffix,550_000));
            LocalDate today=LocalDate.now(PRAGUE);
            ArrayList<JSONObject> rounds=new ArrayList<>();
            HashSet<Integer> seen=new HashSet<>();
            for(int i=0;i<schedule.length();i++){
                JSONObject entry=schedule.optJSONObject(i);
                if(entry==null)continue;
                int n=entry.optInt("name",0);
                if(n<1||n>50||!seen.add(n))continue;
                LocalDate date;
                try{date=OffsetDateTime.parse(entry.optString("orientationDate","")).toLocalDate();}
                catch(Exception ex){continue;}
                if(date.isAfter(today.plusDays(30)))continue;
                entry.put("_distance",Math.abs(java.time.temporal.ChronoUnit.DAYS.between(today,date)));
                rounds.add(entry);
            }
            rounds.sort(Comparator.comparingInt(x->x.optInt("_distance",9999)));
            JSONArray all=new JSONArray();
            for(int i=0;i<rounds.size()&&i<18;i++){
                JSONObject entry=rounds.get(i);
                try{
                    JSONObject row=new JSONObject(json(root+"matches/get-matches-in-round/"
                        +suffix+"?roundName="+entry.getInt("name"),1_600_000));
                    if(row.optJSONArray("matches")!=null)all.put(row);
                }catch(Exception ignored){}
            }
            return DenikCzechFeed.combine(all,league.getString("slug"),year,System.currentTimeMillis());
        }catch(Exception fallback){
            return espn("cze.1");
        }
    }
    private static JSONObject hockey() throws Exception{
        String root="https://raw.githubusercontent.com/LiborP75/lp75-open-data/main/sazkyweb/";
        JSONObject daily=new JSONObject(json(root+"dnes.json",1_000_000));
        JSONObject standing=new JSONObject(json(root+"extraliga-tabulka.json",1_000_000));
        LocalDate today=LocalDate.now(PRAGUE);
        String date=daily.optString("datum","");
        JSONArray events=new JSONArray();
        if(today.toString().equals(date)){
            JSONArray matches=daily.optJSONArray("zapasy");
            for(int i=0;matches!=null&&i<matches.length();i++){
                JSONObject g=matches.optJSONObject(i);
                if(g==null)continue;
                String comp=g.optString("soutez","").toLowerCase(Locale.ROOT);
                if(!comp.contains("extraliga")||comp.contains("slovensk"))continue;
                String home=g.optString("domaci",""),away=g.optString("hoste","");
                if(home.isEmpty()||away.isEmpty())continue;
                try{
                    String time=today.atTime(LocalTime.parse(g.optString("cas","")))
                            .atZone(PRAGUE).toInstant().toString();
                    events.put(new JSONObject().put("id",date+"_"+i).put("date",time)
                        .put("home",home).put("away",away));
                }catch(Exception ignored){}
            }
        }
        JSONArray table=standing.optJSONArray("tabulka");
        if(table==null)throw new IllegalStateException("Tabulka extraligy nedostupná");
        return new JSONObject().put("scheduleCurrent",today.toString().equals(date))
            .put("events",events).put("standings",table).put("source","SazkyWeb.cz CC BY 4.0");
    }
    private static int hockeyFinals(JSONObject ledger,long now){
        JSONArray records=ledger.optJSONArray("records");
        if(records==null)return 0;
        HashSet<String> days=new HashSet<>();
        LocalDate today=LocalDate.now(PRAGUE);
        for(int i=0;i<records.length();i++){
            JSONObject r=records.optJSONObject(i);
            if(r==null||!"hockey".equals(r.optString("league"))||
                !"pending".equals(r.optString("status")))continue;
            try{
                LocalDate date=Instant.parse(r.getString("kickoff")).atZone(PRAGUE).toLocalDate();
                if(date.isBefore(today)&&!date.isBefore(today.minusDays(12)))
                    days.add(date.toString());
            }catch(Exception ignored){}
        }
        int completed=0,checked=0;
        for(String day:days){
            if(checked++>=10)break;
            try{
                JSONObject parsed=HockeyScoreboard.parse(
                    json(HockeyScoreboard.URL_PREFIX+day+".json",2_000_000),
                    day,Instant.ofEpochMilli(now).toString());
                completed+=BackgroundForecastEngine.settleHockey(records,
                    parsed.getJSONArray("events"),now);
            }catch(Exception ignored){}
        }
        return completed;
    }
    @NonNull @Override public Result doWork(){
        if(!enabled(getApplicationContext()))return Result.success();
        long now=System.currentTimeMillis();
        JSONObject ledger=readLedger(getApplicationContext());
        int successful=0;
        for(String league:new String[]{"pl","cz","hockey"}){
            if(isStopped())break;
            try{
                JSONObject data="pl".equals(league)?pl():"cz".equals(league)?cz():hockey();
                BackgroundForecastEngine.ingest(ledger,league,data,now);
                successful++;
                store(getApplicationContext(),ledger);
            }catch(Exception e){
                JSONObject sources=ledger.optJSONObject("sources");
                if(sources==null)sources=new JSONObject();
                String message=e.getMessage()==null?"zdroj není dostupný":e.getMessage();
                sources.put(league,"CHYBA · "+message);
                ledger.put("sources",sources);
                store(getApplicationContext(),ledger);
            }
        }
        try{
            int settled=hockeyFinals(ledger,now);
            if(settled>0){
                JSONObject sources=ledger.optJSONObject("sources");
                if(sources!=null)sources.put("hockey-results",settled+" ověřeno po 60 minutách");
            }
        }catch(Exception ignored){}
        BackgroundForecastEngine.finishCycle(ledger,now);
        ledger.put("lastRun",Instant.ofEpochMilli(now).toString());
        if(successful>0)ledger.put("lastSuccess",Instant.ofEpochMilli(now).toString());
        store(getApplicationContext(),ledger);
        return successful>0?Result.success():Result.retry();
    }
}
