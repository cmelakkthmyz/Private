package cz.cmelak.premierpredictor;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Locale;

public final class PublicOdds {
    public static final String SOURCE_URL = "https://sazkyweb.cz/tipsport-kurzy-dnes.html";

    private PublicOdds() {}

    // The public HTML table displays the bookmaker's 1/X/2 market.
    // Strict parsing: never use other bookmaker columns or two-way overtime odds.
    public static JSONObject fromHtml(String html, long nowEpochMs) throws Exception {
        if (html == null || html.length() < 2000) throw new IllegalArgumentException("Kurzy: neúplná stránka");
        Document doc = Jsoup.parse(html, SOURCE_URL);
        Elements offered = doc.select("tr[data-start][data-mid]");
        JSONArray results = new JSONArray();
        int validRows = 0, rejected = 0, considered = 0;
        for (Element row : offered) {
            Elements columns = row.select("td");
            if (columns.size() < 4) { rejected++; continue; }
            String competition = columns.get(1).text().trim().toLowerCase(Locale.ROOT);
            String league;
            String market;
            if (competition.equals("premier league")) {
                league = "pl"; market = "1X2_90_MINUTES";
            } else if (competition.equals("chance liga")) {
                league = "cz"; market = "1X2_90_MINUTES";
            } else if (competition.equals("tipsport extraliga") || competition.equals("extraliga ledního hokeje")) {
                league = "hockey"; market = "1X2_60_MINUTES";
            } else {
                continue;
            }
            considered++;
            try {
                Instant kickoff = OffsetDateTime.parse(row.attr("data-start")).toInstant();
                long at = kickoff.toEpochMilli();
                if (at <= nowEpochMs + 60_000L || at > nowEpochMs + 8 * 86_400_000L) continue;
                Element strong = columns.get(2).selectFirst("strong");
                if (strong == null) { rejected++; continue; }
                String teams = strong.text();
                String[] participants = teams.split("\\s+[–—]\\s+", 2);
                if (participants.length != 2 || participants[0].isBlank() || participants[1].isBlank()) {
                    rejected++; continue;
                }
                // Tipsport is specifically the FOURTH column (index 3). Other
                // columns, particularly Kingsbet 2-way markets, are not comparable.
                String raw = columns.get(3).text().replace('\u00a0',' ').trim();
                String[] pieces = raw.split("\\s*·\\s*");
                if (pieces.length != 3) { rejected++; continue; }
                Double home = odds(pieces[0]), draw = odds(pieces[1]), away = odds(pieces[2]);
                if (home == null || draw == null || away == null) { rejected++; continue; }
                JSONObject item = new JSONObject();
                item.put("id", row.attr("data-mid"));
                item.put("league", league);
                item.put("market", market);
                item.put("kickoff", kickoff.toString());
                item.put("home", participants[0].trim());
                item.put("away", participants[1].trim());
                item.put("odds", new JSONObject().put("1", home).put("X", draw).put("2", away));
                item.put("bookmaker", "Tipsport");
                item.put("sourceUrl", SOURCE_URL);
                item.put("fetchedAt", Instant.ofEpochMilli(nowEpochMs).toString());
                results.put(item);
                validRows++;
            } catch (Exception e) {
                rejected++;
            }
        }
        JSONObject all = new JSONObject();
        all.put("source", "Veřejná tabulka SazkyWeb.cz · kurz Tipsportu");
        all.put("bookmaker", "Tipsport");
        all.put("sourceUrl", SOURCE_URL);
        all.put("fetchedAt", Instant.ofEpochMilli(nowEpochMs).toString());
        all.put("totalPublicRows", offered.size());
        all.put("applicableRows", considered);
        all.put("parsedRows", validRows);
        all.put("rejectedRows", rejected);
        all.put("offers", results);
        all.put("note", "Kurzy jsou orientační ranní snapshoty a mění se. Před jakýmkoliv rozhodnutím je ověř přímo u sázkové kanceláře. Pro Chance zatím není dostupný veřejný schválený zdroj kurzů.");
        if (offered.isEmpty()) throw new IllegalArgumentException("Zdroj nezveřejňuje očekávanou tabulku; nabídky nejsou ověřené");
        return all;
    }

    private static Double odds(String input) {
        String clean = input.trim().replace(',', '.');
        if (!clean.matches("\\d{1,3}\\.\\d{1,3}")) return null;
        double n = Double.parseDouble(clean);
        return n > 1.01 && n <= 150 ? n : null;
    }
}
