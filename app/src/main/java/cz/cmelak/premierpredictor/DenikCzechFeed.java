package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.Locale;

/**
 * Current FAČR aggregated Chance Liga scoreboards (Deník Fotbal API V2).
 * Official public data as of the actual request, no bookmaker credentials.
 * Pre-match schedule and final results stay distinct: live in-progress score
 * is NEVER marked finished until a conservative post-kickoff delay.
 */
public final class DenikCzechFeed {
    public static final String API="https://fotbalapi.denik.cz/api/front/2/";
    private static final DateTimeFormatter INPUT=DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final ZoneId ZONE=ZoneId.of("Europe/Prague");
    private DenikCzechFeed(){}
    private static String canonical(String raw){
        String n=String.valueOf(raw).trim();
        String k=n.toLowerCase(Locale.ROOT);
        if(k.equals("olomouc"))return "Sigma Olomouc";
        if(k.equals("liberec"))return "Slovan Liberec";
        if(k.equals("plzeň")||k.equals("plzen"))return "Viktoria Plzeň";
        if(k.equals("bohemians praha 1905"))return "Bohemians Praha 1905";
        if(k.equals("hradec králové"))return "Hradec Králové";
        return n;
    }
    public static JSONObject selectCurrentLeague(String currentYearJson,String competitionsJson) throws Exception {
        JSONObject year=new JSONObject(currentYearJson);
        int start=year.optInt("year",0);
        if(start<2020||start>2100||!year.optBoolean("current",false))
            throw new IllegalArgumentException("FAČR API nevrací současný ročník");
        JSONArray entries=new JSONObject(competitionsJson).optJSONArray("results");
        if(entries==null)throw new IllegalArgumentException("Chybí seznam soutěží");
        JSONObject chosen=null;
        for(int i=0;i<entries.length();i++){
            JSONObject item=entries.optJSONObject(i);
            if(item==null||!"Chance Liga".equals(item.optString("name","")))continue;
            JSONObject season=item.optJSONObject("competitionYear"),
             type=item.optJSONObject("type"),category=item.optJSONObject("category");
            if(season==null||type==null||category==null)continue;
            if(season.optInt("year",0)!=start||type.optInt("id",-1)!=11||
                !"A".equals(category.optString("type","")))continue;
            if(chosen!=null)throw new IllegalArgumentException("Nejednoznačná soutěž Chance Liga");
            chosen=item;
        }
        if(chosen==null||!chosen.optString("slug","").matches("[a-z0-9-]{5,96}"))
            throw new IllegalArgumentException("FAČR API neuvádí ověřený identifikátor Chance Ligy");
        return new JSONObject().put("slug",chosen.getString("slug"))
            .put("year",start).put("source","FAČR data via Deník / fotbalapi.denik.cz");
    }
    public static JSONObject parseRound(String json,String seasonSlug,int year,long nowMs)throws Exception{
        JSONObject data=new JSONObject(json);
        JSONArray games=data.optJSONArray("matches");
        if(games==null)throw new IllegalArgumentException("Neúplný rozpis kola");
        JSONArray events=new JSONArray();
        HashSet<String> known=new HashSet<>();
        for(int i=0;i<games.length();i++){
            JSONObject m=games.optJSONObject(i);
            if(m==null||m.optInt("id",-1)<=0)continue;
            String home=canonical(m.optString("homeTeam","")),
             away=canonical(m.optString("guestTeam",""));
            String date=m.optString("matchDate","");
            if(home.isEmpty()||away.isEmpty()||home.equals(away))continue;
            LocalDateTime local;
            try{local=LocalDateTime.parse(date,INPUT);}catch(Exception ex){continue;}
            if(local.getYear()<year||local.getYear()>year+1)continue;
            long kickoff=local.atZone(ZONE).toInstant().toEpochMilli();
            if(kickoff>nowMs+240L*86400000L)continue;
            String scoreHome=m.optString("homeScore","-"),scoreAway=m.optString("guestScore","-");
            // Numeric scores alone can appear during a live game! Mark completed
            // only >= 135 minutes after kickoff; otherwise leave unsettled.
            boolean finalWindow=nowMs>kickoff+135L*60000L,
             validNumbers=scoreHome.matches("\\d{1,2}")&&scoreAway.matches("\\d{1,2}");
            boolean finished=finalWindow&&validNumbers;
            int h=finished?Integer.parseInt(scoreHome):0,
              a=finished?Integer.parseInt(scoreAway):0;
            JSONObject host=new JSONObject().put("homeAway","home")
                .put("team",new JSONObject().put("displayName",home));
            JSONObject visitor=new JSONObject().put("homeAway","away")
                .put("team",new JSONObject().put("displayName",away));
            if(finished){host.put("score",h);visitor.put("score",a);}
            String id="FACR_"+m.getInt("id");
            if(!known.add(id))continue;
            events.put(new JSONObject().put("id",id)
             .put("date",Instant.ofEpochMilli(kickoff).toString())
             .put("status",new JSONObject().put("type",new JSONObject()
               .put("completed",finished).put("name",finished?"STATUS_FINAL":"STATUS_SCHEDULED")))
             .put("competitions",new JSONArray().put(new JSONObject()
                .put("competitors",new JSONArray().put(host).put(visitor)))));
        }
        return new JSONObject().put("events",events);
    }
    public static JSONObject combine(JSONArray roundResponses,String slug,int year,long nowMs) throws Exception {
        JSONArray events=new JSONArray();
        HashSet<String> used=new HashSet();
        for(int i=0;i<roundResponses.length();i++){
            JSONObject round=roundResponses.optJSONObject(i);
            if(round==null)continue;
            JSONObject parsed=parseRound(round.toString(),slug,year,nowMs);
            JSONArray matches=parsed.getJSONArray("events");
            for(int j=0;j<matches.length();j++){
                JSONObject item=matches.getJSONObject(j);
                if(used.add(item.optString("id","")))events.put(item);
            }
        }
        if(events.length()<20)throw new IllegalArgumentException("Příliš málo ověřených výsledků Chance Ligy");
        int finalCount=0,upcoming=0;
        for(int i=0;i<events.length();i++){
            JSONObject x=events.getJSONObject(i);
            if(x.getJSONObject("status").getJSONObject("type").optBoolean("completed"))finalCount++;
            else if(Instant.parse(x.getString("date")).toEpochMilli()>nowMs)upcoming++;
        }
        return new JSONObject().put("events",events)
          .put("source","FAČR výsledky / Deník Fotbal API V2")
          .put("fetchedAt",Instant.ofEpochMilli(nowMs).toString())
          .put("finishedCount",finalCount).put("upcomingCount",upcoming)
          .put("note","Výsledky FAČR po zápase; žádná průběžná skóre nejsou vydávána za definitivní.");
    }
}
