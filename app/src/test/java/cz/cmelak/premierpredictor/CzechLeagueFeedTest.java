package cz.cmelak.premierpredictor;

import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import static org.junit.Assert.*;

public class CzechLeagueFeedTest {
    private static String snippet() {
        StringBuilder s=new StringBuilder("= Czech Republic | First League 2026/27\n# Public CC0 results\n");
        for(int day=1;day<=30;day++){
            s.append("Sat Aug ").append(day).append("\n");
            s.append("  17:00  Sparta Praha  2-1 (0-1)  Viktoria Plzeň\n");
        }
        s.append("Sun Nov 8\n");
        s.append("  18:00  Slavia Praha  1-1 (1-0)  Artis Brno\n");
        s.append("Sat Nov 21\n");
        s.append("       Sigma Olomouc   v   FK Jablonec\n");
        return s.toString();
    }
    @Test public void parsesFinishedResultsAndDoesNotInventUnclockedFutureFixtures() throws Exception {
        JSONObject parsed=CzechLeagueFeed.parse(snippet()+(" padding ".repeat(300)),null,2026,
            "2026-11-08T18:20:00Z");
        JSONArray events=parsed.getJSONArray("events");
        assertEquals(31,events.length());
        assertEquals(31,parsed.getInt("finishedCount"));
        JSONObject last=events.getJSONObject(30);
        assertTrue(last.getJSONObject("status").getJSONObject("type").getBoolean("completed"));
        assertEquals("Slavia Praha",last.getJSONArray("competitions")
            .getJSONObject(0).getJSONArray("competitors").getJSONObject(0)
            .getJSONObject("team").getString("displayName"));
    }
    @Test public void respectsQuotedVerifiedPublicKickoffInsteadOfGuessingFutureStart() throws Exception {
        JSONObject odds=new JSONObject().put("offers",new JSONArray().put(new JSONObject()
          .put("league","cz").put("id","odds-33")
          .put("home","Hradec Králové").put("away","Baník Ostrava")
          .put("kickoff","2027-04-11T16:00:00Z")));
        JSONObject parsed=CzechLeagueFeed.parse(snippet()+(" padding ".repeat(300)),odds,2026,
            "2026-11-08T18:20:00Z");
        assertEquals(1,parsed.getInt("scheduledFromVerifiedOdds"));
        JSONObject item=parsed.getJSONArray("events").getJSONObject(31);
        assertEquals("2027-04-11T16:00:00Z",item.getString("date"));
        assertFalse(item.getJSONObject("status").getJSONObject("type").getBoolean("completed"));
    }
    @Test public void duplicateFinalScoreCannotSettleTwice() throws Exception {
        String raw=snippet()+(" padding ".repeat(300))+
            "\nSun Nov 8\n  18:00  Slavia Praha  1-1 (1-0)  Artis Brno\n";
        JSONObject parsed=CzechLeagueFeed.parse(raw,null,2026,"2026-11-08T18:20:00Z");
        assertEquals(31,parsed.getInt("finishedCount"));
    }
    @Test public void rejectsIncompleteOrFabricatedLeagueFeed() {
        assertThrows(IllegalArgumentException.class,
            ()->CzechLeagueFeed.parse("Not a football match list",null,2026,
                "2026-11-08T13:20:00Z"));
    }
}
