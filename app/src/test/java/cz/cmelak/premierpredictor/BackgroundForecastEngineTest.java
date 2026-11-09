package cz.cmelak.premierpredictor;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;

public class BackgroundForecastEngineTest {
    private static final long NOW=Instant.parse("2026-11-09T09:00:00Z").toEpochMilli();
    private JSONObject match(String id,String home,String away,long kickoff,boolean finalScore,
                             Integer hs,Integer as) throws Exception{
        JSONObject h=new JSONObject().put("homeAway","home").put("team",
            new JSONObject().put("displayName",home));
        JSONObject a=new JSONObject().put("homeAway","away").put("team",
            new JSONObject().put("displayName",away));
        if(hs!=null)h.put("score",hs);
        if(as!=null)a.put("score",as);
        return new JSONObject().put("id",id).put("date",Instant.ofEpochMilli(kickoff).toString())
            .put("status",new JSONObject().put("type",new JSONObject()
                 .put("completed",finalScore).put("name",finalScore?"STATUS_FINAL":"STATUS_SCHEDULED")))
            .put("competitions",new JSONArray().put(new JSONObject()
                .put("competitors",new JSONArray().put(h).put(a))));
    }
    @Test public void forecastsAreFrozenBeforeKickoffAndSettledFromFinalOnly() throws Exception {
        JSONObject ledger=BackgroundForecastEngine.empty();
        long kickoff=NOW+2L*86_400_000L;
        JSONObject scheduled=new JSONObject().put("events",new JSONArray().put(
            match("id123","Arsenal","Chelsea",kickoff,false,null,null)));
        JSONObject first=BackgroundForecastEngine.ingest(ledger,"pl",scheduled,NOW);
        assertEquals(1,first.getInt("created"));
        JSONObject record=ledger.getJSONArray("records").getJSONObject(0);
        String before=record.getJSONObject("p").toString();
        assertEquals("pending",record.getString("status"));
        assertTrue(Math.abs(record.getJSONObject("p").getDouble("1")+
            record.getJSONObject("p").getDouble("X")+
            record.getJSONObject("p").getDouble("2")-1)<1e-9);
        BackgroundForecastEngine.ingest(ledger,"pl",scheduled,NOW+3600000L);
        assertEquals(1,ledger.getJSONArray("records").length());
        assertEquals(before,ledger.getJSONArray("records").getJSONObject(0).getJSONObject("p").toString());
        JSONObject inProgress=new JSONObject().put("events",new JSONArray().put(
            match("id123","Arsenal","Chelsea",kickoff,false,1,0)));
        BackgroundForecastEngine.ingest(ledger,"pl",inProgress,kickoff+90L*60000L);
        assertEquals("pending",record.getString("status"));
        JSONObject finished=new JSONObject().put("events",new JSONArray().put(
            match("id123","Arsenal","Chelsea",kickoff,true,2,0)));
        BackgroundForecastEngine.ingest(ledger,"pl",finished,kickoff+4L*3600000L);
        assertEquals("settled",record.getString("status"));
        assertEquals("1",record.getString("actual"));
        assertEquals(before,record.getJSONObject("p").toString());
    }
    @Test public void ESPNStringScoresAlsoSettle()throws Exception{
        JSONObject ledger=BackgroundForecastEngine.empty();
        long kickoff=NOW+3L*86_400_000L;
        BackgroundForecastEngine.ingest(ledger,"cz",new JSONObject()
            .put("events",new JSONArray().put(match("c1","Sparta Praha","Slavia Praha",
                kickoff,false,null,null))),NOW);
        JSONObject finished=match("c1","Sparta Praha","Slavia Praha",kickoff,true,null,null);
        JSONArray comps=finished.getJSONArray("competitions").getJSONObject(0)
                        .getJSONArray("competitors");
        comps.getJSONObject(0).put("score","0");
        comps.getJSONObject(1).put("score","1");
        BackgroundForecastEngine.ingest(ledger,"cz",
          new JSONObject().put("events",new JSONArray().put(finished)),kickoff+4*3600000L);
        assertEquals("2",ledger.getJSONArray("records").getJSONObject(0).getString("actual"));
    }
    @Test public void noRetroactivePredictionsAfterKickoff()throws Exception{
        long past=NOW-2L*3600000L;
        JSONObject feed=new JSONObject().put("events",new JSONArray().put(match(
            "old","Manchester City","Chelsea",past,true,2,1)));
        JSONObject ledger=BackgroundForecastEngine.empty();
        BackgroundForecastEngine.ingest(ledger,"pl",feed,NOW);
        assertEquals(0,ledger.getJSONArray("records").length());
    }
    @Test public void hockeyRequiresVerifiedRegulationPeriods()throws Exception{
        JSONObject ledger=BackgroundForecastEngine.empty();
        JSONObject r=new JSONObject().put("id","hockey_daily_day_1").put("league","hockey")
            .put("home","Třinec").put("away","Pardubice").put("kickoff",
                Instant.ofEpochMilli(NOW-3L*86_400_000L).toString())
            .put("pick","X").put("p",new JSONObject().put("1",.38).put("X",.24).put("2",.38))
            .put("status","pending");
        ledger.getJSONArray("records").put(r);
        JSONArray ignored=new JSONArray().put(new JSONObject().put("league","hockey")
            .put("market","1X2_FINAL").put("status","finished").put("home","HC Oceláři Třinec")
            .put("away","Dynamo Pardubice").put("kickoff",r.getString("kickoff"))
            .put("homeScore",4).put("awayScore",3).put("periodsVerified",true));
        assertEquals(0,BackgroundForecastEngine.settleHockey(ledger.getJSONArray("records"),ignored,NOW));
        JSONArray accepted=new JSONArray().put(new JSONObject().put("league","hockey")
            .put("market","1X2_60_MINUTES").put("status","finished").put("home","HC Oceláři Třinec")
            .put("away","Dynamo Pardubice").put("kickoff",r.getString("kickoff"))
            .put("homeScore",3).put("awayScore",3).put("periodsVerified",true));
        assertEquals(1,BackgroundForecastEngine.settleHockey(ledger.getJSONArray("records"),accepted,NOW));
        assertEquals("X",r.getString("actual"));
    }
    @Test public void dailyTicketUsesAvailableFutureMatchesAndSettlesIndependently()throws Exception{
        JSONObject ledger=BackgroundForecastEngine.empty();
        JSONArray events=new JSONArray();
        long future=NOW+2L*86400000L;
        for(int i=0;i<3;i++)events.put(match("m"+i,"Home "+i,"Away "+i,
                   future+i*3600000L,false,null,null));
        BackgroundForecastEngine.ingest(ledger,"pl",
            new JSONObject().put("events",events),NOW);
        assertEquals(0,ledger.getJSONArray("tickets").length());
        BackgroundForecastEngine.finishCycle(ledger,NOW);
        assertEquals(1,ledger.getJSONArray("tickets").length());
        JSONObject ticket=ledger.getJSONArray("tickets").getJSONObject(0);
        assertEquals(3,ticket.getJSONArray("legs").length());
        assertEquals("simulation",ticket.getString("status"));
        JSONArray played=new JSONArray();
        for(int i=0;i<3;i++)played.put(match("m"+i,"Home "+i,"Away "+i,
                 future+i*3600000L,true,2,0));
        BackgroundForecastEngine.ingest(ledger,"pl",
            new JSONObject().put("events",played),future+10*3600000L);
        BackgroundForecastEngine.finishCycle(ledger,future+10*3600000L);
        assertEquals("evaluated",ticket.getString("status"));
        assertTrue(ticket.getInt("hitRows")>=0&&ticket.getInt("hitRows")<=4);
    }
    @Test public void probabilityMatrixIsNormalized() {
        double[] p=BackgroundForecastEngine.poisson(1.8,1.1);
        assertEquals(1.0,p[0]+p[1]+p[2],1e-9);
        assertTrue(p[0]>p[2]);
    }
}
