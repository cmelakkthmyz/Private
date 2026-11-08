package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import java.text.Normalizer;
import java.time.Instant;
import java.util.HashSet;
import java.util.Locale;

/**
 * Strict read-only adapter for Chance pre-match 1/X/2 prices served through
 * PulseScore's documented third-party API. Never mixes soccer FULL_TIME with
 * ice hockey REGULAR_TIME, and never invents disabled/missing selections.
 */
public final class ChanceOddsFeed {
    public static final String API="https://api.pulsescore.net/api/chance/";
    private ChanceOddsFeed(){}

    private static String fold(String text) {
        String ascii=Normalizer.normalize(text==null?"":text,Normalizer.Form.NFD)
            .replaceAll("\\p{M}","");
        return ascii.toLowerCase(Locale.ROOT).replaceAll("\\s+"," ").trim();
    }
    private static String leagueKey(String sourceLeague,String sport) {
        final String s=fold(sourceLeague);
        if("soccer".equals(sport)) {
            if(s.contains("premier league")||s.contains("1. anglicka liga")||
                s.contains("1 anglicka liga"))return "pl";
            if(s.equals("chance liga")||s.contains("1. ceska liga")||
                s.contains("1 ceska liga")||s.contains("fortuna liga")||
                s.contains("1. liga cesko"))return "cz";
        }
        if("ice-hockey".equals(sport)) {
            if(s.contains("tipsport extraliga")||
                s.contains("extraliga ledniho hokeje")||
                s.contains("extraliga cr")||s.contains("extraliga - cesko")||
                s.equals("extraliga"))return "hockey";
        }
        return null;
    }
    public static JSONObject parse(JSONArray soccerPages, JSONArray hockeyPages, long nowMs) throws Exception {
        JSONArray offers=new JSONArray();
        HashSet<String> used=new HashSet<>();
        int seen=0,matchedLeague=0,badMarkets=0;
        final long week=8L*86400000L;
        for(int s=0;s<2;s++) {
            String sport=s==0?"soccer":"ice-hockey";
            JSONArray pages=s==0?soccerPages:hockeyPages;
            if(pages==null)continue;
            for(int p=0;p<pages.length();p++){
                JSONObject response=pages.optJSONObject(p);
                JSONArray events=response==null?null:response.optJSONArray("events");
                if(events==null)continue;
                for(int i=0;i<events.length();i++) {
                    JSONObject e=events.optJSONObject(i);
                    if(e==null)continue;
                    seen++;
                    String league=leagueKey(e.optString("league",""),sport);
                    if(league==null)continue;
                    matchedLeague++;
                    if(e.optBoolean("live",false))continue;
                    String start=e.optString("startTime","");
                    long kickoff;
                    try{kickoff=Instant.parse(start).toEpochMilli();}
                    catch(Exception ignored){continue;}
                    if(kickoff<nowMs+60000L||kickoff>nowMs+week)continue;
                    String home=e.optString("home","").trim(),away=e.optString("away","").trim();
                    if(home.isEmpty()||away.isEmpty()||fold(home).equals(fold(away)))continue;
                    JSONArray markets=e.optJSONArray("markets");
                    if(markets==null)continue;
                    for(int m=0;m<markets.length();m++) {
                        JSONObject market=markets.optJSONObject(m);
                        if(market==null||!market.optBoolean("isActive",true)||
                           !"MATCH_RESULT".equals(market.optString("canonicalMarket","")))continue;
                        String period=market.optString("period","");
                        if("hockey".equals(league)) {
                            // Exactly 60:00. FULL_TIME hockey often means incl. OT+shootout.
                            if(!"REGULAR_TIME".equals(period))continue;
                        } else if(!"FULL_TIME".equals(period))continue;
                        JSONObject prices=new JSONObject();
                        JSONArray selections=market.optJSONArray("selections");
                        if(selections==null)continue;
                        boolean good=true;
                        for(int j=0;j<selections.length();j++){
                            JSONObject sel=selections.optJSONObject(j);
                            if(sel==null||!sel.optBoolean("isActive",true))continue;
                            String outcome=sel.optString("canonicalOutcome","");
                            String key="HOME".equals(outcome)?"1":
                                "DRAW".equals(outcome)?"X":"AWAY".equals(outcome)?"2":null;
                            if(key==null)continue;
                            if(prices.has(key)){good=false;break;}
                            double value=sel.optDouble("odds",Double.NaN);
                            if(!Double.isFinite(value)||value<=1.01||value>150){good=false;break;}
                            prices.put(key,value);
                        }
                        if(!good||prices.length()!=3){badMarkets++;continue;}
                        // Bookmaker margin sanity: rejected one missing quote can be
                        // misread as an impossible huge value edge.
                        double overround=1/prices.getDouble("1")+
                            1/prices.getDouble("X")+1/prices.getDouble("2");
                        if(overround<.88||overround>1.4){badMarkets++;continue;}
                        String id=e.optString("eventId","");
                        if(id.isEmpty())continue;
                        String signature=sport+"|"+id+"|"+period;
                        if(!used.add(signature))continue;
                        offers.put(new JSONObject()
                            .put("id","chance_"+sport+"_"+id)
                            .put("league",league)
                            .put("market","hockey".equals(league)?"1X2_60_MINUTES":"1X2_90_MINUTES")
                            .put("kickoff",Instant.ofEpochMilli(kickoff).toString())
                            .put("home",home).put("away",away)
                            .put("odds",prices)
                            .put("bookmaker","Chance")
                            .put("sourceUrl","https://www.chance.cz/kurzy")
                            .put("sourceProvider","PulseScore third-party data API")
                            .put("fetchedAt",Instant.ofEpochMilli(nowMs).toString()));
                        break;
                    }
                }
            }
        }
        JSONObject result=new JSONObject();
        result.put("offers",offers);
        result.put("totalScanned",seen);
        result.put("matchedLeagues",matchedLeague);
        result.put("invalidMarkets",badMarkets);
        result.put("source","Chance via PulseScore, third-party feed (not official Chance API)");
        result.put("bookmaker","Chance");
        result.put("sourceUrl","https://www.chance.cz/kurzy");
        result.put("fetchedAt",Instant.ofEpochMilli(nowMs).toString());
        result.put("notice","Předzápasové kurzy z nezávislého datového prostředníka. Jejich aktuální dostupnost a platnost se může změnit. Nejde o přímé čtení účtu Chance.");
        return result;
    }
}
