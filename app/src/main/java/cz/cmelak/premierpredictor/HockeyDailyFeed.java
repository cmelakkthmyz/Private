package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Locale;

/**
 * Validates publicly published Czech Extraliga daily snapshots.
 * Historical "today" JSON must never be mistaken for today's fixtures.
 */
public final class HockeyDailyFeed {
    private static final ZoneId PRAGUE=ZoneId.of("Europe/Prague");
    private HockeyDailyFeed(){}

    public static JSONObject parse(String dailyRaw,String standingsRaw,long clockMs) throws Exception {
        JSONObject daily=new JSONObject(dailyRaw);
        JSONObject standings=new JSONObject(standingsRaw);
        LocalDate today=Instant.ofEpochMilli(clockMs).atZone(PRAGUE).toLocalDate();
        String day=daily.optString("datum","");
        if(!today.toString().equals(day))
            throw new IllegalStateException("Hokejový program není dnešní: "+day+" (dnes "+today+")");
        JSONArray table=standings.optJSONArray("tabulka");
        if(table==null||table.length()<10)
            throw new IllegalStateException("Hokejová tabulka je neúplná");
        String updated=standings.optString("updated","");
        long updatedAt=0;
        try{updatedAt=OffsetDateTime.parse(updated).toInstant().toEpochMilli();}
        catch(Exception ex){throw new IllegalStateException("Tabulka nemá ověřitelné datum aktualizace");}
        if(updatedAt>clockMs+3600000L||clockMs-updatedAt>96L*3600000L)
            throw new IllegalStateException("Tabulka extraligy je starší než 4 dny: "+updated);
        JSONArray events=new JSONArray(),matches=daily.optJSONArray("zapasy");
        for(int i=0;matches!=null&&i<matches.length();i++){
            JSONObject g=matches.optJSONObject(i);
            if(g==null)continue;
            String league=g.optString("soutez","").toLowerCase(Locale.ROOT);
            if(!league.contains("extraliga")||league.contains("slovensk"))continue;
            String home=g.optString("domaci","").trim(),away=g.optString("hoste","").trim();
            if(home.isEmpty()||away.isEmpty()||home.equalsIgnoreCase(away))continue;
            try{
                String when=today.atTime(LocalTime.parse(g.optString("cas","")))
                    .atZone(PRAGUE).toInstant().toString();
                if(Instant.parse(when).toEpochMilli()<=clockMs+5*60000L)continue;
                events.put(new JSONObject().put("id",day+"_"+i)
                    .put("date",when).put("home",home).put("away",away));
            }catch(Exception invalidTime){/* Ignore incomplete schedules. */}
        }
        return new JSONObject().put("scheduleCurrent",true)
            .put("scheduleDate",day).put("sourceUpdatedAt",updated)
            .put("events",events).put("standings",table)
            .put("source","SazkyWeb.cz / CC BY 4.0");
    }
}
