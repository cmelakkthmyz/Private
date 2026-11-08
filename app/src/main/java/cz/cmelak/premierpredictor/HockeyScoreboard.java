package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Final Czech Extraliga scores derived from the FIRST THREE period scores.
 * The scoreboard also contains overtime and shootout; those are deliberately
 * ignored when settling a 1/X/2 60-minute draw. Any ambiguity leaves a bet pending.
 */
public final class HockeyScoreboard {
    public static final String URL_PREFIX="https://json.esports.cz/hokejcz/scoreboard/";
    private static final Pattern SCORE=Pattern.compile("^(\\d{1,2}):(\\d{1,2})$");
    private HockeyScoreboard() {}

    public static JSONObject parse(String json, String expectedDay, String observedAt) throws Exception {
        if (expectedDay == null || !expectedDay.matches("\\d{4}-\\d{2}-\\d{2}"))
            throw new IllegalArgumentException("Invalid game date");
        LocalDate local=LocalDate.parse(expectedDay);
        JSONObject raw=new JSONObject(json);
        JSONObject league=raw.optJSONObject("101");
        if (league==null)throw new IllegalArgumentException("No verified Extraliga 101 results");
        JSONArray rawGames=league.optJSONArray("matches");
        if (rawGames==null)throw new IllegalArgumentException("Missing games array");
        JSONArray verified=new JSONArray();
        HashSet<String> seen=new HashSet<>();
        for(int i=0;i<rawGames.length();i++){
            JSONObject m=rawGames.optJSONObject(i);
            if(m==null || !"K".equalsIgnoreCase(m.optString("match_actual_time_alias","")))continue;
            String gameDate=m.optString("date","");
            if(!expectedDay.equals(gameDate))continue;
            JSONArray periods=m.optJSONArray("score_periods");
            if(periods==null||periods.length()<3)continue;
            int h=0,a=0;boolean valid=true;
            for(int p=0;p<3;p++){
                Object value=periods.opt(p);
                if(!(value instanceof String)){valid=false;break;}
                Matcher matcher=SCORE.matcher((String)value);
                if(!matcher.matches()){valid=false;break;}
                h+=Integer.parseInt(matcher.group(1));
                a+=Integer.parseInt(matcher.group(2));
            }
            if(!valid||h>35||a>35)continue;
            int finalHome=m.optInt("score_home",-1),finalAway=m.optInt("score_visitor",-1);
            if(finalHome<0||finalAway<0||h>finalHome||a>finalAway)continue;
            JSONObject home=m.optJSONObject("home"),away=m.optJSONObject("visitor");
            if(home==null||away==null)continue;
            String homeName=home.optString("name","").trim(),
                awayName=away.optString("name","").trim();
            String hh=m.optString("time","");
            if(homeName.isEmpty()||awayName.isEmpty()||!hh.matches("\\d{1,2}:\\d{2}"))continue;
            String kickoff;
            try {
                kickoff=local.atTime(LocalTime.parse(hh))
                    .atZone(ZoneId.of("Europe/Prague")).toInstant().toString();
            } catch(Exception ignored){continue;}
            String id=m.optString("hokejcz_id","");
            if(id.isEmpty())continue;
            if(!seen.add(id))continue;
            verified.put(new JSONObject()
                .put("matchId","hokejcz_"+id).put("sourceId",id)
                .put("league","hockey").put("kickoff",kickoff)
                .put("home",homeName).put("away",awayName)
                .put("status","finished").put("homeScore",h).put("awayScore",a)
                .put("finalHome",finalHome).put("finalAway",finalAway)
                .put("periodsVerified",true).put("market","1X2_60_MINUTES")
                .put("source","hokej.cz / eSports Media scoreboard")
                .put("observedAt",observedAt));
        }
        return new JSONObject().put("date",expectedDay).put("events",verified)
            .put("source","hokej.cz / eSports Media scoreboard");
    }
}
