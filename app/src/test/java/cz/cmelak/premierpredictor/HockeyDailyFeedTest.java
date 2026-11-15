package cz.cmelak.premierpredictor;

import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

public class HockeyDailyFeedTest {
    private static final long NOW=Instant.parse("2026-11-15T12:00:00Z").toEpochMilli();
    private static String daily(String date) throws Exception {
        JSONArray matches=new JSONArray()
          .put(new JSONObject().put("soutez","Tipsport extraliga")
               .put("domaci","Třinec").put("hoste","Pardubice").put("cas","18:00"))
          .put(new JSONObject().put("soutez","NHL")
               .put("domaci","New York").put("hoste","Boston").put("cas","20:00"))
          .put(new JSONObject().put("soutez","Tipsport extraliga")
               .put("domaci","Kladno").put("hoste","Sparta Praha").put("cas","01:00"));
        return new JSONObject().put("datum",date).put("zapasy",matches).toString();
    }
    private static String table(String updated) throws Exception {
        JSONArray clubs=new JSONArray();
        for(int i=0;i<14;i++)
            clubs.put(new JSONObject().put("tym","Tým "+i).put("zapasy",16)
               .put("skore","42:38"));
        return new JSONObject().put("updated",updated)
               .put("tabulka",clubs).toString();
    }
    @Test public void staleProgramCannotPretendToBeToday()throws Exception{
        try{
            HockeyDailyFeed.parse(daily("2026-11-07"),
                table("2026-11-15T07:00:00+01:00"),NOW);
            fail("Stale feed must be refused");
        }catch(IllegalStateException expected){
            assertTrue(expected.getMessage().contains("není dnešní"));
        }
    }
    @Test public void oldStandingsAreExplicitlyRejected()throws Exception{
        try{
            HockeyDailyFeed.parse(daily("2026-11-15"),
                table("2026-11-07T07:04:00+01:00"),NOW);
            fail("Old standings must be refused");
        }catch(IllegalStateException expected){
            assertTrue(expected.getMessage().contains("starší"));
        }
    }
    @Test public void todaySnapshotIncludesOnlyUpcomingExtraligaGames()throws Exception{
        JSONObject data=HockeyDailyFeed.parse(daily("2026-11-15"),
             table("2026-11-15T07:00:00+01:00"),NOW);
        assertTrue(data.getBoolean("scheduleCurrent"));
        assertEquals(1,data.getJSONArray("events").length());
        assertEquals("Třinec",data.getJSONArray("events").getJSONObject(0).getString("home"));
        assertEquals("Pardubice",data.getJSONArray("events").getJSONObject(0).getString("away"));
    }
    @Test public void invalidStandingsAreRejected()throws Exception{
        try{HockeyDailyFeed.parse(daily("2026-11-15"),
            new JSONObject().put("updated","2026-11-15T07:00:00+01:00")
              .put("tabulka",new JSONArray()).toString(),NOW);
            fail("Empty standings");
        }catch(IllegalStateException expected){
            assertTrue(expected.getMessage().contains("neúplná"));
        }
    }
}
