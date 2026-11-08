package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.time.Instant;
import static org.junit.Assert.*;

public class ChanceOddsFeedTest {
    private static final long NOW=Instant.parse("2026-11-08T12:00:00Z").toEpochMilli();
    private static JSONObject market(String period,boolean active,boolean draw)throws Exception {
        JSONArray selections=new JSONArray()
            .put(new JSONObject().put("canonicalOutcome","HOME").put("odds",2.35).put("isActive",true))
            .put(new JSONObject().put("canonicalOutcome","AWAY").put("odds",3.4).put("isActive",true));
        if(draw)selections.put(new JSONObject()
            .put("canonicalOutcome","DRAW").put("odds",3.6).put("isActive",true));
        return new JSONObject().put("canonicalMarket","MATCH_RESULT")
            .put("period",period).put("isActive",active).put("selections",selections);
    }
    private static JSONObject event(String id,String league,JSONObject... markets)throws Exception{
        JSONArray arr=new JSONArray();
        for(JSONObject m:markets)arr.put(m);
        return new JSONObject().put("eventId",id).put("startTime","2026-11-09T17:00:00Z")
            .put("home","Sparta Praha").put("away","Slavia Praha")
            .put("league",league).put("live",false).put("markets",arr);
    }
    private static JSONArray pages(JSONObject... events)throws Exception{
        JSONArray entries=new JSONArray();for(JSONObject e:events)entries.put(e);
        return new JSONArray().put(new JSONObject().put("events",entries));
    }
    @Test public void parsesOnlyChanceSoccerFullTimeThreeWay()throws Exception{
        JSONObject e=event("456","Chance Liga",
          market("FIRST_HALF",true,true),
          market("FULL_TIME",true,true));
        JSONObject parsed=ChanceOddsFeed.parse(pages(e),new JSONArray(),NOW);
        JSONArray offers=parsed.getJSONArray("offers");
        assertEquals(1,offers.length());
        JSONObject item=offers.getJSONObject(0);
        assertEquals("Chance",item.getString("bookmaker"));
        assertEquals("cz",item.getString("league"));
        assertEquals("1X2_90_MINUTES",item.getString("market"));
        assertEquals(3.6,item.getJSONObject("odds").getDouble("X"),.00001);
        assertEquals("chance_soccer_456",item.getString("id"));
        assertTrue(item.getString("sourceProvider").contains("third-party"));
    }
    @Test public void tipsportFeedUsesDifferentBookmakerAndEventNamespace()throws Exception{
        JSONObject e=event("456","Chance Liga",market("FULL_TIME",true,true));
        JSONObject parsed=ChanceOddsFeed.parse(pages(e),new JSONArray(),NOW,"Tipsport");
        JSONObject offer=parsed.getJSONArray("offers").getJSONObject(0);
        assertEquals("Tipsport",offer.getString("bookmaker"));
        assertEquals("tipsport_soccer_456",offer.getString("id"));
        assertEquals("https://www.tipsport.cz/kurzy",offer.getString("sourceUrl"));
    }
    @Test public void premierLeagueAcceptsEnglishAndCzechLeagueNames()throws Exception{
        JSONObject p=ChanceOddsFeed.parse(pages(
          event("111","1. anglická liga",market("FULL_TIME",true,true)),
          event("112","Premier League",market("FULL_TIME",true,true))),
          new JSONArray(),NOW);
        assertEquals(2,p.getJSONArray("offers").length());
        assertEquals("pl",p.getJSONArray("offers").getJSONObject(0).getString("league"));
    }
    @Test public void hockeyDrawRequiresSixtyMinutesAndNeverUsesOvertimeTwoWay()throws Exception{
        JSONObject hk=event("222","Tipsport extraliga",
          market("FULL_TIME",true,false),
          market("REGULAR_TIME",true,true));
        JSONObject result=ChanceOddsFeed.parse(new JSONArray(),pages(hk),NOW);
        assertEquals(1,result.getJSONArray("offers").length());
        JSONObject offer=result.getJSONArray("offers").getJSONObject(0);
        assertEquals("hockey",offer.getString("league"));
        assertEquals("1X2_60_MINUTES",offer.getString("market"));
        assertEquals(3.6,offer.getJSONObject("odds").getDouble("X"),.00001);
    }
    @Test public void missingRegulationDrawNeverInventsHockeyThreeWay()throws Exception{
        JSONObject hk=event("222","Tipsport extraliga",market("FULL_TIME",true,false));
        assertEquals(0,ChanceOddsFeed.parse(new JSONArray(),pages(hk),NOW)
            .getJSONArray("offers").length());
    }
    @Test public void suspendedMarketIsRejectedEvenWithPrices()throws Exception{
        JSONObject e=event("x","Chance Liga",market("FULL_TIME",false,true));
        assertEquals(0,ChanceOddsFeed.parse(pages(e),null,NOW)
            .getJSONArray("offers").length());
    }
    @Test public void unknownLowerLeagueNotMisclassifiedAsChanceLiga()throws Exception{
        JSONObject e=event("x","Chance Národní Liga",market("FULL_TIME",true,true));
        assertEquals(0,ChanceOddsFeed.parse(pages(e),null,NOW)
            .getJSONArray("offers").length());
    }
    @Test public void expiredAndInPlayMarketsCannotCreatePrematchTickets()throws Exception{
        JSONObject e=event("x","Chance Liga",market("FULL_TIME",true,true))
            .put("live",true);
        assertEquals(0,ChanceOddsFeed.parse(pages(e),null,NOW)
            .getJSONArray("offers").length());
        e.put("live",false).put("startTime","2026-11-07T17:00:00Z");
        assertEquals(0,ChanceOddsFeed.parse(pages(e),null,NOW)
            .getJSONArray("offers").length());
    }
    @Test public void duplicatePagesDeduplicatedByBookmakerEventId()throws Exception{
        JSONObject e=event("abc","Chance Liga",market("FULL_TIME",true,true));
        JSONArray multi=new JSONArray().put(new JSONObject().put("events",new JSONArray().put(e)))
            .put(new JSONObject().put("events",new JSONArray().put(e)));
        assertEquals(1,ChanceOddsFeed.parse(multi,null,NOW)
            .getJSONArray("offers").length());
    }
    @Test public void rejectedImpossiblePricesWithMissingSelections()throws Exception{
        JSONObject invalid=market("FULL_TIME",true,true);
        invalid.getJSONArray("selections").getJSONObject(0).put("odds",1.01);
        assertEquals(0,ChanceOddsFeed.parse(pages(event("x","Chance Liga",invalid)),null,NOW)
            .getJSONArray("offers").length());
    }
}
