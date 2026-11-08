package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.Instant;
import java.time.Month;
import java.util.HashSet;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Czech first division: current-season results from OpenFootball public-domain
 * CC0 text, plus exact future kick-off times from public published bookmaker
 * rows. Undated/unclocked future text is NOT presented as a timed fixture.
 *
 * This is a published scoreboard updated by volunteers, not a live clock.
 * Incomplete results do not settle any paper tickets.
 */
public final class CzechLeagueFeed {
    private static final Pattern DATE=Pattern.compile(
        "^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2})(?:\\s+(\\d{4}))?$");
    private static final Pattern RESULT=Pattern.compile(
        "^(?:(\\d{1,2}:\\d{2})\\s+)?(.+?)\\s+(\\d{1,2})-(\\d{1,2})\\s+\\((\\d{1,2})-(\\d{1,2})\\)\\s+(.+?)\\s*$");
    private CzechLeagueFeed(){}

    private static String club(String raw){
        String name=raw.trim().replaceAll("\\s+"," ");
        String plain=name.toLowerCase(Locale.ROOT);
        if(plain.contains("fastav zl"))return "Zlín";
        if(plain.contains("slovácko")||plain.contains("slovacko"))return "Slovácko";
        if(plain.contains("mlad")&&plain.contains("boleslav"))return "Mladá Boleslav";
        if(plain.contains("viktoria plz"))return "Viktoria Plzeň";
        if(plain.contains("sparta praha"))return "Sparta Praha";
        if(plain.contains("slavia praha"))return "Slavia Praha";
        if(plain.contains("slovan liberec"))return "Slovan Liberec";
        if(plain.contains("baník ostrava")||plain.contains("banik ostrava"))return "Baník Ostrava";
        if(plain.contains("hradec kralove")||plain.contains("hradec králové"))return "Hradec Králové";
        if(plain.contains("bohemians"))return "Bohemians Praha 1905";
        if(plain.contains("olomouc"))return "Sigma Olomouc";
        if(plain.contains("zbrojovka"))return "Zbrojovka Brno";
        if(plain.contains("artis"))return "Artis Brno";
        if(plain.contains("pardubice"))return "Pardubice";
        if(plain.contains("jablonec"))return "Jablonec";
        if(plain.contains("teplice"))return "Teplice";
        return name.replaceAll("^(FC|FK|SK|AC)\\s+","");
    }
    private static LocalDate parseDay(String line,int seasonStart){
        Matcher m=DATE.matcher(line.trim());
        if(!m.matches())return null;
        String mm=m.group(2);
        String[] names={"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};
        int month=0;for(int i=0;i<names.length;i++)if(names[i].equals(mm))month=i+1;
        if(month==0)return null;
        int year=m.group(4)!=null?Integer.parseInt(m.group(4)):(month>=7?seasonStart:seasonStart+1);
        try{return LocalDate.of(year,month,Integer.parseInt(m.group(3)));}
        catch(Exception e){return null;}
    }
    private static JSONObject espnEvent(String id,String home,String away,String kickoff,
        boolean finished,int h,int a)throws Exception{
        JSONObject hteam=new JSONObject().put("homeAway","home")
            .put("team",new JSONObject().put("displayName",home));
        JSONObject ateam=new JSONObject().put("homeAway","away")
            .put("team",new JSONObject().put("displayName",away));
        if(finished){hteam.put("score",h);ateam.put("score",a);}
        return new JSONObject().put("id",id).put("date",kickoff)
            .put("status",new JSONObject().put("type",
                new JSONObject().put("completed",finished)
                .put("name",finished?"STATUS_FINAL":"STATUS_SCHEDULED")))
            .put("competitions",new JSONArray().put(new JSONObject()
                .put("competitors",new JSONArray().put(hteam).put(ateam))));
    }

    public static JSONObject parse(String text, JSONObject publicOdds,int seasonStart,String observedAt)throws Exception{
        String season=seasonStart+"-"+String.format(Locale.ROOT,"%02d",(seasonStart+1)%100);
        if(text==null||!text.contains("First League")||text.length()<2000)
            throw new IllegalArgumentException("Historie aktuální Chance Ligy není dostupná");
        JSONArray events=new JSONArray();
        HashSet<String> known=new HashSet<>();
        LocalDate current=null;int finished=0,schedule=0,index=0;
        for(String line:text.replace("\r","").split("\n")){
            LocalDate candidate=parseDay(line,seasonStart);
            if(candidate!=null){current=candidate;continue;}
            if(current==null)continue;
            Matcher m=RESULT.matcher(line.trim());
            if(!m.matches())continue;
            String home=club(m.group(2)),away=club(m.group(7));
            if(home.isEmpty()||away.isEmpty()||home.equals(away))continue;
            int h=Integer.parseInt(m.group(3)),a=Integer.parseInt(m.group(4));
            if(h>30||a>30)continue;
            String time=m.group(1)!=null?m.group(1):"12:00";
            String kickoff=current.atTime(LocalTime.parse(time))
                .atZone(ZoneId.of("Europe/Prague")).toInstant().toString();
            String id="cc0_"+season+"_"+index++;
            events.put(espnEvent(id,home,away,kickoff,true,h,a));
            finished++;
            known.add(current+"|"+home+"|"+away);
        }
        if(finished<25||finished>350)
            throw new IllegalArgumentException("Neúplná sezóna Chance Ligy: jen "+finished+" výsledků");
        if(publicOdds!=null){
            JSONArray odds=publicOdds.optJSONArray("offers");
            if(odds!=null){
                for(int i=0;i<odds.length();i++){
                    JSONObject row=odds.optJSONObject(i);
                    if(row==null||!"cz".equals(row.optString("league","")))continue;
                    String kickoff=row.optString("kickoff","");
                    Instant instant;
                    try{instant=Instant.parse(kickoff);}catch(Exception ignored){continue;}
                    if(instant.toEpochMilli()<System.currentTimeMillis()+60000L)continue;
                    String home=club(row.optString("home","")),away=club(row.optString("away",""));
                    if(home.isEmpty()||away.isEmpty()||home.equals(away))continue;
                    LocalDate day=instant.atZone(ZoneId.of("Europe/Prague")).toLocalDate();
                    if(known.contains(day+"|"+home+"|"+away))continue;
                    String id="odds_"+row.optString("id",String.valueOf(i));
                    events.put(espnEvent(id,home,away,kickoff,false,0,0));
                    schedule++;
                }
            }
        }
        return new JSONObject().put("events",events).put("source","OpenFootball CC0 2026-27 + SazkyWeb public bookie schedules")
            .put("publishedAt",observedAt).put("finishedCount",finished)
            .put("scheduledFromVerifiedOdds",schedule).put("note",
                "Výsledky v OpenFootball jsou publikované, nikoli živé. Odehrané zápasy bez zveřejněného skóre zůstanou otevřené.");
    }
}
