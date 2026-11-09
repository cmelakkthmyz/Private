package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Independent native background forecaster: no WebView, credentials, bets, or
 * scraped bookmaker pages. Every forecast is frozen before kickoff.
 * Statistics and corrections only use subsequently confirmed final scores.
 */
public final class BackgroundForecastEngine {
    private static final long DAY = 86_400_000L;
    private static final ZoneId PRAGUE = ZoneId.of("Europe/Prague");
    private BackgroundForecastEngine() {}

    public static JSONObject empty() {
        return new JSONObject().put("version",1).put("records",new JSONArray())
                .put("tickets",new JSONArray()).put("lastRun",JSONObject.NULL)
                .put("lastSuccess",JSONObject.NULL).put("sources",new JSONObject());
    }

    static final class Game {
        String id,league,home,away,kickoff;
        long starts;
        boolean finished;
        int hs=-1,as=-1;
        Game(String league,String id,String home,String away,String kickoff) {
            this.league=league;this.id=id;this.home=home;this.away=away;
            this.kickoff=kickoff;
            try {this.starts=Instant.parse(kickoff).toEpochMilli();}
            catch(Exception e){this.starts=0;}
        }
    }

    private static String plain(String s){
        String n=Normalizer.normalize(s==null?"":s,Normalizer.Form.NFD)
                .replaceAll("\\p{M}","").toLowerCase(Locale.ROOT).trim()
                .replaceAll("[^\\p{L}0-9]"," ").replaceAll("\\s+"," ");
        n=n.replaceFirst("^(hc|hk|bk|hc ocelari|rytiri|hc skoda) ","");
        return n;
    }

    private static JSONObject competitor(JSONObject e,String side){
        JSONArray comps=e.optJSONArray("competitions");
        JSONObject c=comps==null?null:comps.optJSONObject(0);
        JSONArray all=c==null?null:c.optJSONArray("competitors");
        if(all==null)return null;
        for(int i=0;i<all.length();i++){
            JSONObject x=all.optJSONObject(i);
            if(x!=null&&side.equals(x.optString("homeAway")))return x;
        }
        return null;
    }

    public static List<Game> footballGames(String league,JSONObject feed,long now){
        List<Game> games=new ArrayList<>();
        JSONArray events=feed.optJSONArray("events");
        if(events==null)return games;
        for(int i=0;i<events.length();i++){
            JSONObject event=events.optJSONObject(i);
            if(event==null)continue;
            JSONObject h=competitor(event,"home"),a=competitor(event,"away");
            if(h==null||a==null)continue;
            String home=h.optJSONObject("team")==null?"":h.optJSONObject("team").optString("displayName","");
            String away=a.optJSONObject("team")==null?"":a.optJSONObject("team").optString("displayName","");
            if(home.isEmpty()||away.isEmpty()||plain(home).equals(plain(away)))continue;
            Game g=new Game(league,league+"_"+event.optString("id",String.valueOf(i)),
                           home,away,event.optString("date",""));
            if(g.starts<=0)continue;
            JSONObject status=event.optJSONObject("status");
            JSONObject type=status==null?null:status.optJSONObject("type");
            boolean done=type!=null&&(type.optBoolean("completed",false)||
                    "STATUS_FINAL".equals(type.optString("name","")));
            Object hs=h.opt("score"),as=a.opt("score");
            if(done&&hs instanceof Number&&as instanceof Number&&g.starts+90L*60000L<now){
                int hh=((Number)hs).intValue(),aa=((Number)as).intValue();
                if(hh>=0&&aa>=0&&hh<=35&&aa<=35){g.finished=true;g.hs=hh;g.as=aa;}
            }
            games.add(g);
        }
        return games;
    }

    public static List<Game> hockeyGames(JSONObject feed,long now){
        List<Game> games=new ArrayList<>();
        if(!feed.optBoolean("scheduleCurrent",false))return games;
        JSONArray events=feed.optJSONArray("events");
        if(events==null)return games;
        for(int i=0;i<events.length();i++){
            JSONObject x=events.optJSONObject(i);
            if(x==null)continue;
            Game g=new Game("hockey","hockey_daily_"+x.optString("id",String.valueOf(i)),
                    x.optString("home",""),x.optString("away",""),x.optString("date",""));
            if(g.starts>now&&g.starts<now+DAY&&
                !g.home.isEmpty()&&!g.away.isEmpty())games.add(g);
        }
        return games;
    }

    private static boolean sameGame(JSONObject old,Game g){
        if(!g.league.equals(old.optString("league")))return false;
        if(g.id.equals(old.optString("id")))return true;
        long oldStart=time(old.optString("kickoff",""));
        return oldStart>0&&Math.abs(oldStart-g.starts)<9L*3600000L
                &&plain(old.optString("home","")).equals(plain(g.home))
                &&plain(old.optString("away","")).equals(plain(g.away));
    }
    private static long time(String s){try{return Instant.parse(s).toEpochMilli();}catch(Exception e){return 0;}}
    private static JSONObject existing(JSONArray rows,Game g){
        for(int i=0;i<rows.length();i++){
            JSONObject old=rows.optJSONObject(i);
            if(old!=null&&sameGame(old,g))return old;
        }
        return null;
    }
    private static double clamp(double x,double lo,double hi){return Math.max(lo,Math.min(hi,x));}
    private static double pmf(int k,double lambda){
        double p=Math.exp(-lambda);
        for(int i=1;i<=k;i++)p*=lambda/i;
        return p;
    }
    static double[] poisson(double h,double a){
        double[] p=new double[3];
        for(int x=0;x<=13;x++)for(int y=0;y<=13;y++)
            p[x>y?0:x==y?1:2]+=pmf(x,h)*pmf(y,a);
        double sum=p[0]+p[1]+p[2];
        for(int i=0;i<3;i++)p[i]/=sum;
        return p;
    }
    private static double[] bias(JSONArray records,String league){
        double[] delta=new double[3];int n=0;
        for(int i=records.length()-1;i>=0&&n<240;i--){
            JSONObject r=records.optJSONObject(i);
            if(r==null||!league.equals(r.optString("league"))||!"settled".equals(r.optString("status")))continue;
            JSONObject p=r.optJSONObject("p");
            if(p==null)continue;
            String outcome=r.optString("actual","");
            String[] outcomes={"1","X","2"};
            for(int k=0;k<3;k++)delta[k]+=(outcomes[k].equals(outcome)?1.0:0.0)-p.optDouble(outcomes[k],1.0/3);
            n++;
        }
        // Learn only after at least 20 real outcomes. Strong shrinkage prevents overfitting.
        if(n<20)return delta;
        for(int k=0;k<3;k++)delta[k]=clamp(delta[k]/(n+65.0),-.07,.07);
        return delta;
    }
    private static double[] applyBias(double[] p,double[] b){
        double[] v=new double[3];double sum=0;
        for(int i=0;i<3;i++){v[i]=clamp(p[i]+b[i],.005,.99);sum+=v[i];}
        for(int i=0;i<3;i++)v[i]/=sum;
        return v;
    }
    private static JSONObject pJson(double[] p){
        return new JSONObject().put("1",p[0]).put("X",p[1]).put("2",p[2]);
    }
    private static String best(double[] p){
        return p[0]>=p[1]&&p[0]>=p[2]?"1":p[1]>=p[2]?"X":"2";
    }
    private static String actual(int h,int a){return h>a?"1":h==a?"X":"2";}

    private static double[] goalsFor(List<Game> games,String team,long cutoff,double baseFor,double baseAgainst){
        double scored=baseFor*6,allowed=baseAgainst*6,points=1.35*6,total=6;
        for(Game x:games){
            if(!x.finished||x.starts>=cutoff||cutoff-x.starts>350L*DAY)continue;
            boolean isHome=plain(team).equals(plain(x.home));
            boolean isAway=plain(team).equals(plain(x.away));
            if(!isHome&&!isAway)continue;
            double weight=Math.exp(-((double)(cutoff-x.starts))/ (110.0*DAY));
            int forGoals=isHome?x.hs:x.as,againstGoals=isHome?x.as:x.hs;
            scored+=weight*forGoals;allowed+=weight*againstGoals;
            points+=weight*(forGoals>againstGoals?3:forGoals==againstGoals?1:0);
            total+=weight;
        }
        return new double[]{scored/total,allowed/total,points/total};
    }
    private static double[] forecast(Game g,List<Game> games,JSONObject hockeyStandings,JSONArray ledger){
        boolean hockey="hockey".equals(g.league);
        double homeBase=hockey?3.10:1.56,awayBase=hockey?2.83:1.22;
        double[] h=goalsFor(games,g.home,g.starts,homeBase,awayBase);
        double[] a=goalsFor(games,g.away,g.starts,awayBase,homeBase);
        if(hockey&&hockeyStandings!=null){
            h=hockeyForm(hockeyStandings,g.home,homeBase,awayBase);
            a=hockeyForm(hockeyStandings,g.away,awayBase,homeBase);
        }
        double mean=(homeBase+awayBase)/2;
        double hp=homeBase*(h[0]/homeBase)*(a[1]/mean);
        double ap=awayBase*(a[0]/awayBase)*(h[1]/mean);
        double form=clamp((h[2]-a[2])*.055,-.12,.12);
        hp=clamp(hp*(1+form),hockey?.60:.35,hockey?5.8:3.6);
        ap=clamp(ap*(1-form),hockey?.60:.35,hockey?5.8:3.6);
        return applyBias(poisson(hp,ap),bias(ledger,g.league));
    }
    private static double[] hockeyForm(JSONObject feed,String team,double baseFor,double baseAgainst){
        JSONArray teams=feed.optJSONArray("standings");
        if(teams!=null)for(int i=0;i<teams.length();i++){
            JSONObject row=teams.optJSONObject(i);
            if(row==null)continue;
            String name=row.optString("tym","");
            if(!plain(name).contains(plain(team))&&!plain(team).contains(plain(name)))continue;
            String[] goals=row.optString("skore","").split(":");
            int gp=row.optInt("zapasy",0);
            try{
                if(goals.length==2&&gp>=6){
                    double games=gp+12.0;
                    return new double[]{(Integer.parseInt(goals[0])+baseFor*12)/games,
                        (Integer.parseInt(goals[1])+baseAgainst*12)/games,1.35};
                }
            }catch(Exception ignored){}
        }
        return new double[]{baseFor,baseAgainst,1.35};
    }

    public static int settle(JSONArray saved,List<Game> games,long now){
        int count=0;
        for(Game g:games){
            if(!g.finished||g.starts>=now)continue;
            JSONObject record=existing(saved,g);
            if(record==null||!"pending".equals(record.optString("status")))continue;
            String out=actual(g.hs,g.as);
            record.put("actual",out).put("score",g.hs+":"+g.as).put("status","settled")
                    .put("settledAt",Instant.ofEpochMilli(now).toString())
                    .put("correct",out.equals(record.optString("pick")));
            count++;
        }
        return count;
    }

    public static int settleHockey(JSONArray saved,JSONArray results,long now){
        List<Game> all=new ArrayList<>();
        for(int i=0;i<results.length();i++){
            JSONObject r=results.optJSONObject(i);
            if(r==null||!"finished".equals(r.optString("status"))||
                    !"1X2_60_MINUTES".equals(r.optString("market"))||
                    !r.optBoolean("periodsVerified",false))continue;
            Game g=new Game("hockey",r.optString("matchId",""),
                    r.optString("home",""),r.optString("away",""),r.optString("kickoff",""));
            if(g.starts<=0)continue;
            g.hs=r.optInt("homeScore",-1);g.as=r.optInt("awayScore",-1);
            g.finished=g.hs>=0&&g.as>=0&&g.hs<=35&&g.as<=35;
            all.add(g);
        }
        return settle(saved,all,now);
    }

    public static JSONObject ingest(JSONObject ledger,String league,JSONObject feed,long now){
        JSONArray saved=ledger.optJSONArray("records");
        if(saved==null){saved=new JSONArray();ledger.put("records",saved);}
        List<Game> all="hockey".equals(league)?hockeyGames(feed,now):footballGames(league,feed,now);
        int settled=settle(saved,all,now),created=0;
        Collections.sort(all,Comparator.comparingLong(a->a.starts));
        for(Game g:all){
            if(g.finished||g.starts<=now+45L*60000L||g.starts>now+14L*DAY)continue;
            if(existing(saved,g)!=null)continue;
            double[] p=forecast(g,all,feed,saved);
            JSONObject row=new JSONObject().put("id",g.id).put("league",g.league)
                    .put("home",g.home).put("away",g.away).put("kickoff",g.kickoff)
                    .put("createdAt",Instant.ofEpochMilli(now).toString())
                    .put("p",pJson(p)).put("pick",best(p)).put("status","pending")
                    .put("model","native-poisson-form-calibration-v1");
            saved.put(row);created++;
        }
        ledger.put("lastRun",Instant.ofEpochMilli(now).toString());
        JSONObject sources=ledger.optJSONObject("sources");
        if(sources==null)sources=new JSONObject();
        sources.put(league,"OK · "+all.size()+" utkání, "+created+" nových odhadů, "+settled+" výsledků");
        ledger.put("sources",sources);
        trim(ledger,now);
        createDailyTicket(ledger,now);
        return new JSONObject().put("fixtures",all.size()).put("created",created).put("settled",settled);
    }

    private static void trim(JSONObject ledger,long now){
        JSONArray rows=ledger.optJSONArray("records");
        if(rows==null||rows.length()<=1600)return;
        JSONArray kept=new JSONArray();
        for(int i=Math.max(0,rows.length()-1400);i<rows.length();i++)kept.put(rows.optJSONObject(i));
        ledger.put("records",kept);
    }
    private static void createDailyTicket(JSONObject ledger,long now){
        String today=LocalDate.ofInstant(Instant.ofEpochMilli(now),PRAGUE).toString();
        JSONArray tickets=ledger.optJSONArray("tickets");
        if(tickets==null){tickets=new JSONArray();ledger.put("tickets",tickets);}
        for(int i=0;i<tickets.length();i++)
            if(today.equals(tickets.optJSONObject(i).optString("day")))return;
        JSONArray records=ledger.optJSONArray("records");
        List<JSONObject> candidates=new ArrayList<>();
        for(int i=0;records!=null&&i<records.length();i++){
            JSONObject r=records.optJSONObject(i);
            if(r==null||!"pending".equals(r.optString("status")))continue;
            long start=time(r.optString("kickoff",""));
            if(start<=now+45L*60000L||start>now+4L*DAY)continue;
            candidates.add(r);
        }
        candidates.sort((a,b)->Double.compare(
            b.optJSONObject("p").optDouble(b.optString("pick"),0),
            a.optJSONObject("p").optDouble(a.optString("pick"),0)));
        JSONArray selected=new JSONArray();
        for(JSONObject candidate:candidates){
            if(selected.length()>=3)break;
            boolean repeated=false;
            for(int i=0;i<selected.length();i++){
                JSONObject old=selected.optJSONObject(i);
                if(old!=null&&old.optString("id").equals(candidate.optString("id")))repeated=true;
            }
            if(!repeated)selected.put(candidate);
        }
        if(selected.length()<2)return;
        JSONArray legs=new JSONArray();double chance=1;
        for(int i=0;i<selected.length();i++){
            JSONObject r=selected.optJSONObject(i);
            double p=r.optJSONObject("p").optDouble(r.optString("pick"),0);
            chance*=p;
            legs.put(new JSONObject().put("matchId",r.optString("id"))
                .put("home",r.optString("home")).put("away",r.optString("away"))
                .put("league",r.optString("league")).put("kickoff",r.optString("kickoff"))
                .put("pick",r.optString("pick")).put("probability",p));
        }
        tickets.put(new JSONObject().put("day",today).put("createdAt",Instant.ofEpochMilli(now).toString())
            .put("type",selected.length()==3?"MAXIKOMBI 2/3 + 3/3":"AKU 2")
            .put("legs",legs).put("allCorrectProbability",chance)
            .put("status","simulation").put("note","Bez kurzů, není to skutečná sázka"));
        while(tickets.length()>65)tickets.remove(0);
    }
    public static JSONObject summary(JSONObject ledger){
        JSONArray saved=ledger.optJSONArray("records");
        int pending=0,settled=0,correct=0;
        double brier=0;
        JSONArray latest=new JSONArray();
        for(int i=saved==null?0:saved.length()-1;i>=0;i--){
            JSONObject r=saved.optJSONObject(i);
            if(r==null)continue;
            if("pending".equals(r.optString("status")))pending++;
            if("settled".equals(r.optString("status"))){
                settled++;if(r.optBoolean("correct",false))correct++;
                String out=r.optString("actual","");
                JSONObject p=r.optJSONObject("p");
                if(p!=null)for(String o:new String[]{"1","X","2"}){
                    double err=p.optDouble(o,1.0/3)-(o.equals(out)?1:0);
                    brier+=err*err;
                }
            }
            if(latest.length()<25)latest.put(r);
        }
        JSONArray tickets=ledger.optJSONArray("tickets");
        return new JSONObject().put("lastRun",ledger.opt("lastRun"))
            .put("lastSuccess",ledger.opt("lastSuccess"))
            .put("pending",pending).put("settled",settled).put("correct",correct)
            .put("accuracy",settled>0?(double)correct/settled:JSONObject.NULL)
            .put("brier",settled>0?brier/settled:JSONObject.NULL)
            .put("sources",ledger.optJSONObject("sources"))
            .put("latest",latest)
            .put("dailyTickets",tickets==null?new JSONArray():tickets);
    }
}
