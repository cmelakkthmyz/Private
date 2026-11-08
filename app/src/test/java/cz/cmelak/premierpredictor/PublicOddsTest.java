package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.time.Instant;
import java.util.Locale;
import static org.junit.Assert.*;

public final class PublicOddsTest {
    private static final long NOW=Instant.parse("2026-11-08T09:00:00Z").toEpochMilli();
    private static String row(String id,String competition,String teams,String prices,String date) {
        return "<tr data-mid='"+id+"' data-start='"+date+"'><td>15:00</td><td class='kd-comp'>"+
            competition+"</td><td><strong>"+teams+"</strong></td><td class='num'>"+prices+
            "</td><td class='num'>2,01 · 3,07 · 3,90</td><td></td></tr>";
    }
    private static String html(String rows) {
        return "<html><body><p>"+("Historická nabídka. ".repeat(150))+
            "</p><table class='mg-table'>"+rows+"</table></body></html>";
    }
    @Test public void parsesTipsportColumnAndAllThreeTargetLeagues() throws Exception {
        String page=html(
            row("1","Chance Liga","Slavia Praha – Sparta Praha","1,95 · 3,30 · 4,10","2026-11-08T15:00:00+01:00")+
            row("2","Premier League","Arsenal – Chelsea","2,02 · 3,31 · 3,81","2026-11-08T18:00:00+01:00")+
            row("3","Tipsport extraliga","Třinec – Pardubice","1,80 · 4,44 · 4,60","2026-11-08T16:00:00+01:00"));
        JSONObject parsed=PublicOdds.fromHtml(page,NOW);
        assertEquals(3,parsed.getInt("parsedRows"));
        JSONArray arr=parsed.getJSONArray("offers");
        assertEquals(3,arr.length());
        assertEquals("cz",arr.getJSONObject(0).getString("league"));
        assertEquals("pl",arr.getJSONObject(1).getString("league"));
        assertEquals("hockey",arr.getJSONObject(2).getString("league"));
        assertEquals("1X2_60_MINUTES",arr.getJSONObject(2).getString("market"));
        assertEquals(3.30,arr.getJSONObject(0).getJSONObject("odds").getDouble("X"),.00001);
        assertEquals(4.10,arr.getJSONObject(0).getJSONObject("odds").getDouble("2"),.00001);
    }
    @Test public void ignoresDifferentLeaguesAndFakeOrMissingBookmakerPrices() throws Exception {
        String page=html(
            row("1","Chance Národní Liga","X – Y","1,50 · 3,30 · 6,00","2026-11-08T15:00:00+01:00")+
            row("2","Chance Liga","Jablonec – Liberec","1,55 · – · 2,20","2026-11-08T18:00:00+01:00")+
            row("3","Premier League","Arsenal – Chelsea","2,05 · 3,29 · 3,79","2026-11-08T18:00:00+01:00"));
        JSONObject data=PublicOdds.fromHtml(page,NOW);
        assertEquals(1,data.getJSONArray("offers").length());
        assertEquals("Arsenal",data.getJSONArray("offers").getJSONObject(0).getString("home"));
    }
    @Test public void filtersExpiredEventsAndNeverInventsOdds() throws Exception {
        String page=html(
            row("1","Premier League","Arsenal – Chelsea","1,90 · 3,40 · 4,10","2026-11-07T18:00:00+01:00")+
            row("2","Chance Liga","Jablonec – Liberec","1,90 · 3,40 · 4,10","2026-12-01T18:00:00+01:00"));
        JSONObject data=PublicOdds.fromHtml(page,NOW);
        assertEquals(0,data.getJSONArray("offers").length());
        assertEquals(0,data.getInt("parsedRows"));
    }
    @Test public void unsupportedPageIsExplicitError() {
        try {
            PublicOdds.fromHtml("<html>wrong page</html>",NOW);
            fail("Should reject stale or missing bookmaker table");
        } catch (Exception expected) {
            assertNotNull(expected.getMessage());
        }
    }
}
