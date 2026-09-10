package com.gyeongmae.auction.service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 룰북 3-2 기준 점수표. 라인 배율은 이 표에 이미 반영되어 있다.
 * 엑셀에 라인별 점수가 없거나, 관리자가 선수를 손으로 추가할 때의 폴백으로 쓴다.
 */
public final class TierScoreTable {

    /** 표기 → {탑, 정글, 미드, 원딜, 서폿} */
    private static final Map<String, int[]> TABLE = new LinkedHashMap<>();

    static {
        TABLE.put("I", new int[]{1, 1, 1, 1, 1});
        TABLE.put("B3~4", new int[]{2, 2, 2, 2, 2});
        TABLE.put("B1~2", new int[]{3, 3, 3, 3, 3});
        TABLE.put("S4", new int[]{4, 4, 4, 4, 4});
        TABLE.put("S3", new int[]{6, 5, 5, 5, 5});
        TABLE.put("S2", new int[]{7, 6, 6, 6, 6});
        TABLE.put("S1", new int[]{8, 7, 8, 7, 7});
        TABLE.put("G4", new int[]{10, 9, 10, 9, 9});
        TABLE.put("G3", new int[]{12, 11, 12, 11, 11});
        TABLE.put("G2", new int[]{14, 13, 14, 13, 13});
        TABLE.put("G1", new int[]{17, 15, 16, 15, 15});
        TABLE.put("P4", new int[]{20, 18, 19, 18, 18});
        TABLE.put("P3", new int[]{23, 21, 22, 21, 21});
        TABLE.put("P2", new int[]{26, 24, 25, 25, 24});
        TABLE.put("P1", new int[]{30, 27, 28, 28, 27});
        TABLE.put("E4", new int[]{34, 32, 32, 32, 30});
        TABLE.put("E3", new int[]{39, 36, 36, 36, 34});
        TABLE.put("E2", new int[]{43, 41, 40, 40, 38});
        TABLE.put("E1", new int[]{47, 45, 44, 45, 41});
        TABLE.put("D4", new int[]{53, 50, 49, 50, 46});
        TABLE.put("D3", new int[]{58, 56, 54, 55, 50});
        TABLE.put("D2", new int[]{64, 62, 59, 60, 54});
        TABLE.put("D1", new int[]{69, 68, 64, 66, 58});
        TABLE.put("M+", new int[]{76, 75, 70, 72, 63});
        TABLE.put("M400+", new int[]{84, 83, 76, 80, 69});
        TABLE.put("M800+", new int[]{92, 92, 84, 88, 76});
        TABLE.put("M1200+", new int[]{101, 100, 93, 98, 83});
    }

    private static final String[] LINES = {"TOP", "JUNGLE", "MID", "ADC", "SUPPORT"};

    private TierScoreTable() {}

    /** "D1", "M400+", "플래티넘2" 같은 표기를 라인별 점수로 변환한다. 모르면 빈 맵. */
    public static Map<String, Integer> scoresFor(String tierNotation) {
        int[] row = TABLE.get(canonical(tierNotation));
        Map<String, Integer> result = new LinkedHashMap<>();
        if (row == null) return result;
        for (int i = 0; i < LINES.length; i++) result.put(LINES[i], row[i]);
        return result;
    }

    /** 자유 입력 티어 문자열을 룰북 표기(D1, M400+ ...)로 정규화한다. */
    public static String canonical(String raw) {
        if (raw == null) return "";
        String v = raw.trim().toUpperCase().replace(" ", "");
        if (v.isEmpty()) return "";
        if (TABLE.containsKey(v)) return v;

        // 한글 티어명 → 알파벳 표기
        String letter = null;
        if (v.contains("아이언")) letter = "I";
        else if (v.contains("브론즈")) letter = "B";
        else if (v.contains("실버")) letter = "S";
        else if (v.contains("골드")) letter = "G";
        else if (v.contains("플래") || v.contains("플레")) letter = "P";
        else if (v.contains("에메") || v.contains("애메")) letter = "E";
        else if (v.contains("다이아")) letter = "D";
        else if (v.contains("마스터") || v.contains("그마") || v.contains("챌")) letter = "M";
        if (letter == null && v.length() > 0 && "IBSGPEDM".indexOf(v.charAt(0)) >= 0) {
            letter = String.valueOf(v.charAt(0));
        }
        if (letter == null) return v;

        String digits = v.replaceAll("[^0-9]", "");

        if (letter.equals("M")) {
            int lp = digits.isEmpty() ? 0 : Integer.parseInt(digits);
            if (lp >= 1200) return "M1200+";
            if (lp >= 800) return "M800+";
            if (lp >= 400) return "M400+";
            return "M+";
        }
        if (letter.equals("I")) return "I";
        if (letter.equals("B")) {
            int d = digits.isEmpty() ? 4 : Integer.parseInt(digits.substring(0, 1));
            return d >= 3 ? "B3~4" : "B1~2";
        }
        if (digits.isEmpty()) return letter + "1";
        return letter + digits.charAt(0);
    }
}
