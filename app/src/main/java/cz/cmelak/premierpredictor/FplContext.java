package cz.cmelak.premierpredictor;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/** Public, as-of-now Fantasy Premier League squad and schedule snapshot.
 *  Not suitable for historical replay unless the old snapshot was archived before the match.
 */
public final class FplContext {
    public static final String BOOTSTRAP = "https://fantasy.premierleague.com/api/bootstrap-static/";
    public static final String FIXTURES = "https://fantasy.premierleague.com/api/fixtures/";
    private FplContext() {}

    private static String canonical(String name) {
        if ("Spurs".equals(name) || "Tottenham".equals(name)) return "Tottenham Hotspur";
        if ("Man City".equals(name)) return "Manchester City";
        if ("Man Utd".equals(name) || "Man United".equals(name)) return "Manchester United";
        if ("Nott'm Forest".equals(name)) return "Nottingham Forest";
        if ("Newcastle".equals(name)) return "Newcastle United";
        if ("Wolves".equals(name)) return "Wolverhampton Wanderers";
        if ("West Ham".equals(name)) return "West Ham United";
        if ("Brighton & Hove Albion".equals(name)) return "Brighton";
        if ("AFC Bournemouth".equals(name)) return "Bournemouth";
        return name == null ? "" : name.trim();
    }
    private static double finite(double n, double fallback) {
        return Double.isFinite(n) ? n : fallback;
    }
    private static double limit(double x, double low, double high) {
        return Math.max(low, Math.min(high, x));
    }
    private static double normalizedRating(double raw, double mean) {
        if (!Double.isFinite(raw) || raw <= 0 || mean <= 0) return 70;
        return limit(70 + 85 * (raw / mean - 1), 42, 110);
    }

    public static JSONObject parse(String rawBootstrap, String rawFixtures, long timestampMs) throws Exception {
        JSONObject root = new JSONObject(rawBootstrap);
        JSONArray sourceTeams = root.getJSONArray("teams");
        JSONArray sourcePlayers = root.getJSONArray("elements");
        JSONArray sourceFixtures = new JSONArray(rawFixtures);
        if (sourceTeams.length() < 18 || sourceTeams.length() > 22 || sourcePlayers.length() < 250)
            throw new IllegalArgumentException("FPL snapshot has incomplete clubs or players");
        Map<Integer,String> names = new HashMap<>();
        double attackSum = 0, defenceSum = 0;
        for (int i = 0; i < sourceTeams.length(); i++) {
            JSONObject team = sourceTeams.getJSONObject(i);
            String name = canonical(team.optString("name", ""));
            int id = team.optInt("id", -1);
            if (id <= 0 || name.isEmpty()) throw new IllegalArgumentException("FPL club name missing");
            names.put(id, name);
            attackSum += (team.optDouble("strength_attack_home", 0) +
                          team.optDouble("strength_attack_away", 0))/2;
            defenceSum += (team.optDouble("strength_defence_home", 0) +
                           team.optDouble("strength_defence_away", 0))/2;
        }
        double attackMean = attackSum / sourceTeams.length();
        double defenceMean = defenceSum / sourceTeams.length();
        JSONArray teams = new JSONArray(), players = new JSONArray(), events = new JSONArray();
        for (int i = 0; i < sourceTeams.length(); i++) {
            JSONObject t = sourceTeams.getJSONObject(i);
            double atk = (t.optDouble("strength_attack_home", attackMean)
                    + t.optDouble("strength_attack_away", attackMean))/2;
            double def = (t.optDouble("strength_defence_home", defenceMean)
                    + t.optDouble("strength_defence_away", defenceMean))/2;
            teams.put(new JSONObject()
                    .put("id", names.get(t.getInt("id")))
                    .put("name", names.get(t.getInt("id")))
                    .put("attack", normalizedRating(atk,attackMean))
                    .put("defense", normalizedRating(def,defenceMean))
                    .put("source","FPL"));
        }
        for (int i = 0; i < sourcePlayers.length(); i++) {
            JSONObject p = sourcePlayers.getJSONObject(i);
            String teamName = names.get(p.optInt("team", -1));
            int minutes = p.optInt("minutes", 0);
            if (teamName == null || minutes < 90) continue;
            String status = p.optString("status", "a");
            Object rawChance = p.opt("chance_of_playing_next_round");
            int chance;
            if (rawChance instanceof Number) chance = ((Number) rawChance).intValue();
            else if ("i".equals(status) || "s".equals(status) || "u".equals(status) || "n".equals(status)) chance=0;
            else if ("d".equals(status)) chance=50;
            else chance=100;
            chance = (int)limit(chance,0,100);
            players.put(new JSONObject()
                .put("team_id", teamName)
                .put("name", p.optString("web_name", ""))
                .put("minutes", minutes)
                .put("xg", safeNumber(p.opt("expected_goals")))
                .put("xa", safeNumber(p.opt("expected_assists")))
                .put("availability", status)
                .put("chance_of_playing_next_round", chance)
                .put("news", p.optString("news","")));
        }
        for (int i = 0; i < sourceFixtures.length(); i++) {
            JSONObject f = sourceFixtures.getJSONObject(i);
            String kickoff=f.optString("kickoff_time","");
            String home=names.get(f.optInt("team_h",-1)),away=names.get(f.optInt("team_a",-1));
            if (home==null || away==null || kickoff.isEmpty()) continue;
            boolean finished=f.optBoolean("finished",false);
            JSONObject h=new JSONObject().put("homeAway","home")
                    .put("team", new JSONObject().put("displayName",home));
            JSONObject a=new JSONObject().put("homeAway","away")
                    .put("team", new JSONObject().put("displayName",away));
            if (finished && f.opt("team_h_score") instanceof Number && f.opt("team_a_score") instanceof Number) {
                h.put("score",f.getInt("team_h_score"));
                a.put("score",f.getInt("team_a_score"));
            } else finished=false;
            events.put(new JSONObject()
                .put("id", "FPL_"+f.optInt("id",i))
                .put("date",kickoff)
                .put("status",new JSONObject().put("type",new JSONObject()
                    .put("completed",finished).put("name",finished?"STATUS_FINAL":"STATUS_SCHEDULED")))
                .put("competitions",new JSONArray().put(new JSONObject()
                    .put("competitors",new JSONArray().put(h).put(a)))));
        }
        if (events.length() < 90 || teams.length() < 18)
            throw new IllegalArgumentException("FPL fixtures or team strengths incomplete");
        JSONObject context=new JSONObject()
            .put("teams",teams)
            .put("players",players)
            .put("fetchedAt", Instant.ofEpochMilli(timestampMs).toString())
            .put("source","Fantasy Premier League public API")
            .put("sourceUrl", BOOTSTRAP)
            .put("historicallyValid",false);
        return new JSONObject()
            .put("events",events)
            .put("context",context)
            .put("source","Fantasy Premier League fixtures")
            .put("fetchedAt",Instant.ofEpochMilli(timestampMs).toString());
    }
    private static double safeNumber(Object raw) {
        if (raw == null || raw == JSONObject.NULL) return 0;
        try {
            return limit(Double.parseDouble(String.valueOf(raw)),0,150);
        } catch(Exception ignored) { return 0; }
    }
}
