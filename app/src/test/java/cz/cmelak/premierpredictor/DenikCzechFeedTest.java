package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.time.Instant;
import static org.junit.Assert.*;

public class DenikCzechFeedTest {
    private static final long NOW=Instant.parse("2026-11-08T13:30:00Z").toEpochMilli();
    private static JSONObject fixture(int id,String day,String home,String away,
       String hs,String as)throws Exception{
        return new JSONObject().put("id",id).put("homeTeam",home).put("guestTeam",away)
          .put("matchDate",day).put("homeScore",hs).put("guestScore",as);
    }
    private static String round(JSONObject... rows)throws Exception{
        JSONArray matches=new JSONArray();for(JSONObject x:rows)matches.put(x);
        return new JSONObject().put("matches",matches).toString();
    }
    @Test public void selectsOnlyCurrentMensChanceLigaWithCorrectSlug() throws Exception{
        JSONObject current=new JSONObject().put("year",2026).put("current",true);
        JSONArray entries=new JSONArray().put(new JSONObject().put("name","Chance Liga")
          .put("slug","chance-liga-2025-2")
          .put("competitionYear",new JSONObject().put("year",2025))
          .put("type",new JSONObject().put("id",11))
          .put("category",new JSONObject().put("type","A")))
         .put(new JSONObject().put("name","Chance Liga").put("slug","chance-liga-2026-2")
          .put("competitionYear",new JSONObject().put("year",2026))
          .put("type",new JSONObject().put("id",11))
          .put("category",new JSONObject().put("type","A")));
        JSONObject selected=DenikCzechFeed.selectCurrentLeague(current.toString(),
         new JSONObject().put("results",entries).toString());
        assertEquals("chance-liga-2026-2",selected.getString("slug"));
        assertEquals(2026,selected.getInt("year"));
    }
    @Test public void actualFinalAndUnplayedMatchesRemainSeparated()throws Exception{
        String json=round(
          fixture(1544697,"2026-11-07 15:00:00","Liberec","Bohemians Praha 1905","1","0"),
          fixture(1544703,"2026-11-08 15:00:00","Slavia Praha","Artis Brno","-","-"));
        JSONObject parsed=DenikCzechFeed.parseRound(json,"chance-liga-2026-2",2026,NOW);
        JSONArray matches=parsed.getJSONArray("events");
        assertEquals(2,matches.length());
        JSONObject completed=matches.getJSONObject(0);
        JSONObject upcoming=matches.getJSONObject(1);
        assertTrue(completed.getJSONObject("status").getJSONObject("type").getBoolean("completed"));
        assertEquals(1,completed.getJSONArray("competitions").getJSONObject(0)
         .getJSONArray("competitors").getJSONObject(0).getInt("score"));
        assertFalse(upcoming.getJSONObject("status").getJSONObject("type").getBoolean("completed"));
        assertFalse(upcoming.getJSONArray("competitions").getJSONObject(0)
         .getJSONArray("competitors").getJSONObject(0).has("score"));
    }
    @Test public void scoreDuringLiveMatchNeverCountsAsFinal()throws Exception{
        JSONObject json=DenikCzechFeed.parseRound(round(
          fixture(1544703,"2026-11-08 15:00:00","Slavia Praha","Artis Brno","1","0")),
          "chance-liga-2026-2",2026,Instant.parse("2026-11-08T15:35:00Z").toEpochMilli());
        JSONObject event=json.getJSONArray("events").getJSONObject(0);
        assertFalse(event.getJSONObject("status").getJSONObject("type").getBoolean("completed"));
    }
    @Test public void completedZeroZeroIsNotDiscarded()throws Exception{
        JSONObject json=DenikCzechFeed.parseRound(round(
          fixture(1544703,"2026-11-07 15:00:00","Slavia Praha","Artis Brno","0","0")),
          "chance-liga-2026-2",2026,NOW);
        JSONObject event=json.getJSONArray("events").getJSONObject(0);
        assertTrue(event.getJSONObject("status").getJSONObject("type").getBoolean("completed"));
        assertEquals(0,event.getJSONArray("competitions").getJSONObject(0)
         .getJSONArray("competitors").getJSONObject(1).getInt("score"));
    }
    @Test public void duplicateMatchIdNeverDoubleCounts()throws Exception{
        JSONObject one=fixture(1544697,"2026-11-07 15:00:00","Liberec","Bohemians Praha 1905","1","0");
        JSONObject json=DenikCzechFeed.parseRound(round(one,one),
          "chance-liga-2026-2",2026,NOW);
        assertEquals(1,json.getJSONArray("events").length());
    }
    @Test public void seasonCheckPreventsAccidentalCrossYearResults()throws Exception{
        JSONObject json=DenikCzechFeed.parseRound(round(
          fixture(111,"2025-11-07 15:00:00","Liberec","Bohemians Praha 1905","1","0")),
          "chance-liga-2026-2",2026,NOW);
        assertEquals(0,json.getJSONArray("events").length());
    }
}
