package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class FplContextTest {
    private static JSONObject snapshot() throws Exception {
        JSONArray teams=new JSONArray(),players=new JSONArray(),fixtures=new JSONArray();
        for(int i=1;i<=20;i++){
            String name=i==1?"Arsenal":i==2?"Spurs":i==3?"Man City":"Test Club "+i;
            teams.put(new JSONObject().put("id",i).put("name",name)
                .put("strength_attack_home",1300+i*8).put("strength_attack_away",1180+i*8)
                .put("strength_defence_home",1320+i*8).put("strength_defence_away",1200+i*8));
        }
        for(int i=0;i<300;i++){
            String status=i==2?"i":i==3?"d":"a";
            JSONObject p=new JSONObject().put("team",i%20+1).put("web_name","Test Player "+i)
                .put("minutes",800).put("expected_goals","1.5").put("expected_assists","0.5")
                .put("status",status);
            if(i==3)p.put("chance_of_playing_next_round",40);
            players.put(p);
        }
        for(int i=1;i<=100;i++){
            JSONObject f=new JSONObject().put("id",i).put("team_h",1+i%20)
                .put("team_a",1+(i+1)%20).put("kickoff_time","2026-11-25T19:00:00Z")
                .put("finished",i<=5);
            if(i<=5){f.put("team_h_score",2).put("team_a_score",0);}
            fixtures.put(f);
        }
        JSONObject input=new JSONObject().put("teams",teams).put("elements",players);
        return FplContext.parse(input.toString(),fixtures.toString(),1700000000000L);
    }
    @Test public void parsesOfficialPlayersAndTeamStrengthWithSourceTime() throws Exception {
        JSONObject data=snapshot();
        JSONObject context=data.getJSONObject("context");
        assertEquals(20,context.getJSONArray("teams").length());
        assertEquals(300,context.getJSONArray("players").length());
        assertFalse(context.getBoolean("historicallyValid"));
        assertEquals("Fantasy Premier League public API",context.getString("source"));
        assertEquals(100,data.getJSONArray("events").length());
    }
    @Test public void statusChanceIsNotInventedAsAvailability() throws Exception {
        JSONArray players=snapshot().getJSONObject("context").getJSONArray("players");
        assertEquals(0,players.getJSONObject(2).getInt("chance_of_playing_next_round"));
        assertEquals(40,players.getJSONObject(3).getInt("chance_of_playing_next_round"));
        assertEquals(100,players.getJSONObject(1).getInt("chance_of_playing_next_round"));
    }
    @Test public void clubsHaveCanonicalNamesForFixtureMatching() throws Exception {
        JSONArray clubs=snapshot().getJSONObject("context").getJSONArray("teams");
        assertEquals("Tottenham Hotspur",clubs.getJSONObject(1).getString("id"));
        assertEquals("Manchester City",clubs.getJSONObject(2).getString("id"));
        assertTrue(clubs.getJSONObject(2).getDouble("attack")<110);
    }
    @Test public void onlyCompletedFixturesHaveFinalScores() throws Exception {
        JSONArray events=snapshot().getJSONArray("events");
        JSONArray h=events.getJSONObject(0).getJSONArray("competitions")
            .getJSONObject(0).getJSONArray("competitors");
        JSONArray notFinished=events.getJSONObject(7).getJSONArray("competitions")
            .getJSONObject(0).getJSONArray("competitors");
        assertEquals(2,h.getJSONObject(0).getInt("score"));
        assertFalse(notFinished.getJSONObject(0).has("score"));
        assertFalse(events.getJSONObject(7).getJSONObject("status")
             .getJSONObject("type").getBoolean("completed"));
    }
    @Test public void refusesIncompleteClubOrPlayerData() throws Exception {
        assertThrows(IllegalArgumentException.class,()->{
            FplContext.parse("{\"teams\":[],\"elements\":[]}","[]",1700000000000L);
        });
    }
}
