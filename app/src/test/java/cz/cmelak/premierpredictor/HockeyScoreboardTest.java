package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.time.Instant;
import static org.junit.Assert.*;

public class HockeyScoreboardTest {
    private static final String DATE="2026-11-07", SEEN="2026-11-08T09:15:00Z";
    private static String make(String state, String[] periods, int finalH,int finalA) throws Exception {
        JSONArray rows=new JSONArray();
        for(String p:periods)rows.put(p);
        JSONObject game=new JSONObject().put("hokejcz_id","2988771")
          .put("date",DATE).put("time","17:30")
          .put("match_actual_time_alias",state)
          .put("score_periods",rows)
          .put("score_home",finalH).put("score_visitor",finalA)
          .put("home",new JSONObject().put("name","HC Oceláři Třinec"))
          .put("visitor",new JSONObject().put("name","HC Kometa Brno"));
        return new JSONObject().put("101",new JSONObject().put("league_name","Tipsport extraliga")
          .put("matches",new JSONArray().put(game))).toString();
    }
    @Test public void overtimeWinnerIsStillRegulationDraw() throws Exception {
        JSONObject result=HockeyScoreboard.parse(make("K",new String[]{"1:1","0:1","2:1","1:0"},4,3),DATE,SEEN);
        JSONArray arr=result.getJSONArray("events");
        assertEquals(1,arr.length());
        JSONObject game=arr.getJSONObject(0);
        assertEquals(3,game.getInt("homeScore"));
        assertEquals(3,game.getInt("awayScore"));
        assertEquals(4,game.getInt("finalHome"));
        assertEquals("1X2_60_MINUTES",game.getString("market"));
        assertEquals("hockey",game.getString("league"));
        assertTrue(game.getBoolean("periodsVerified"));
        assertEquals("2026-11-07T16:30:00Z",game.getString("kickoff"));
    }
    @Test public void incompleteFirstThreePeriodsCannotSettle() throws Exception {
        assertEquals(0,HockeyScoreboard.parse(make("K",
             new String[]{"1:0","1:1"},2,1),DATE,SEEN)
             .getJSONArray("events").length());
    }
    @Test public void inProgressIsNotFinal() throws Exception {
        assertEquals(0,HockeyScoreboard.parse(make("2",
             new String[]{"2:0","1:0","0:1"},3,1),DATE,SEEN)
             .getJSONArray("events").length());
    }
    @Test public void impossiblePeriodSumsRejectResult() throws Exception {
        assertEquals(0,HockeyScoreboard.parse(make("K",
             new String[]{"2:0","2:0","1:0"},4,0),DATE,SEEN)
             .getJSONArray("events").length());
    }
    @Test public void missingExtraligaNeverFallsBackToOtherLeagues() throws Exception {
        JSONObject wrong=new JSONObject().put("82",new JSONObject()
            .put("matches",new JSONArray()));
        assertThrows(IllegalArgumentException.class,
            ()->HockeyScoreboard.parse(wrong.toString(),DATE,SEEN));
    }
    @Test public void invalidPeriodCannotBeGuessed() throws Exception {
        assertEquals(0,HockeyScoreboard.parse(make("K",
             new String[]{"1:0","N/A","2:2"},3,2),DATE,SEEN)
             .getJSONArray("events").length());
    }
}
