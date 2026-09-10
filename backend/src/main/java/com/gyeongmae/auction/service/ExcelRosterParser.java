package com.gyeongmae.auction.service;

import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.*;

import java.util.*;

/**
 * 구글폼 응답 기반 참가 신청서 엑셀을 파싱한다.
 *
 * <p>대상 워크북은 보통 두 개의 시트를 갖는다.
 * <ul>
 *   <li><b>응답 시트</b> — 폼 원본. 이름 / 닉네임#태그 / 최고 티어 / 주·부 포지션 /
 *       모스트 챔피언 / 하고 싶은 말 / 팀장 지원 여부 / 기준 점수(탑·정글·미드·원딜·서폿)</li>
 *   <li><b>참가자별 점수표</b> — 운영진이 손으로 보정한 최종 라인별 점수와 팀장 목록</li>
 * </ul>
 *
 * <p>점수표가 있으면 라인별 점수·티어·포지션은 점수표를 신뢰하고,
 * 모스트 챔피언·각오·신입 여부처럼 점수표에 없는 값만 응답 시트에서 채워 넣는다.
 * 두 시트는 닉네임#태그(없으면 이름)로 조인한다.
 */
@Slf4j
public class ExcelRosterParser {

    public static final List<String> LINES = List.of("TOP", "JUNGLE", "MID", "ADC", "SUPPORT");

    /** 엑셀의 라인 헤더 → 내부 라인 코드 */
    private static final Map<String, String> LINE_HEADERS = Map.of(
            "탑", "TOP",
            "정글", "JUNGLE",
            "미드", "MID",
            "원딜", "ADC",
            "서폿", "SUPPORT"
    );

    @Getter @Setter
    public static class ParsedPlayer {
        private String name;
        private String summonerName;
        private String tier;             // 원본 표기 (D1, M400+ ...)
        private String mainPosition;     // TOP/JUNGLE/MID/ADC/SUPPORT
        private String subPosition;
        private String mostChampions;
        private String resolution;
        private boolean newMember;
        private boolean captain;
        private Map<String, Integer> lineScores = new LinkedHashMap<>();

        public String joinKey() {
            String key = normalize(summonerName);
            return key.isEmpty() ? normalize(name) : key;
        }
    }

    @Getter
    public static class ParsedRoster {
        private final List<ParsedPlayer> players = new ArrayList<>();
        /** 팀장 이름 (엑셀에 적힌 순서대로) */
        private final List<String> captainNames = new ArrayList<>();
    }

    // ==================== 진입점 ====================

    public ParsedRoster parse(Workbook workbook) {
        Sheet responseSheet = findResponseSheet(workbook);
        Sheet scoreSheet = findScoreSheet(workbook);

        Map<String, ParsedPlayer> fromResponse = new LinkedHashMap<>();
        if (responseSheet != null) {
            for (ParsedPlayer p : parseResponseSheet(responseSheet)) {
                fromResponse.put(p.joinKey(), p);
            }
        }

        ParsedRoster roster = new ParsedRoster();

        if (scoreSheet != null) {
            List<ParsedPlayer> scored = parseScoreSheet(scoreSheet);
            if (!scored.isEmpty()) {
                for (ParsedPlayer p : scored) {
                    enrich(p, fromResponse.get(p.joinKey()));
                    roster.players.add(p);
                }
                // 점수표에 빠져있고 응답 시트에만 있는 사람도 놓치지 않는다
                Set<String> covered = new HashSet<>();
                scored.forEach(p -> covered.add(p.joinKey()));
                fromResponse.forEach((key, p) -> {
                    if (!covered.contains(key)) roster.players.add(p);
                });
                roster.captainNames.addAll(findCaptainNames(scoreSheet));
            }
        }

        if (roster.players.isEmpty()) {
            roster.players.addAll(fromResponse.values());
        }

        // 점수표에 팀장 목록이 없으면 응답 시트의 '팀장 지원 여부'로 대체
        if (roster.captainNames.isEmpty()) {
            for (ParsedPlayer p : roster.players) {
                if (p.isCaptain() && p.getName() != null && !p.getName().isBlank()) {
                    roster.captainNames.add(p.getName().trim());
                }
            }
        }

        // 팀장 목록을 실제 선수 레코드에 반영
        Set<String> captainKeys = new HashSet<>();
        for (String captainName : roster.captainNames) {
            roster.players.stream()
                    .filter(p -> normalize(p.getName()).equals(normalize(captainName)))
                    .findFirst()
                    .ifPresent(p -> captainKeys.add(p.joinKey()));
        }
        for (ParsedPlayer p : roster.players) {
            p.setCaptain(captainKeys.contains(p.joinKey()));
        }

        log.info("엑셀 파싱 완료: 참가자 {}명, 팀장 {}명", roster.players.size(), roster.captainNames.size());
        return roster;
    }

    /** 점수표에 없는 값(모스트/각오/신입/티어/포지션)을 응답 시트에서 보충한다. */
    private void enrich(ParsedPlayer target, ParsedPlayer source) {
        if (source == null) return;
        if (isBlank(target.getName())) target.setName(source.getName());
        if (isBlank(target.getSummonerName())) target.setSummonerName(source.getSummonerName());
        if (isBlank(target.getTier())) target.setTier(source.getTier());
        if (isBlank(target.getMainPosition())) target.setMainPosition(source.getMainPosition());
        if (isBlank(target.getSubPosition())) target.setSubPosition(source.getSubPosition());
        if (isBlank(target.getMostChampions())) target.setMostChampions(source.getMostChampions());
        if (isBlank(target.getResolution())) target.setResolution(source.getResolution());
        if (source.isNewMember()) target.setNewMember(true);
        for (String line : LINES) {
            if (target.getLineScores().get(line) == null && source.getLineScores().get(line) != null) {
                target.getLineScores().put(line, source.getLineScores().get(line));
            }
        }
    }

    // ==================== 시트 탐색 ====================

    private Sheet findResponseSheet(Workbook wb) {
        for (int i = 0; i < wb.getNumberOfSheets(); i++) {
            if (wb.getSheetName(i).replace(" ", "").contains("응답")) return wb.getSheetAt(i);
        }
        // 이름으로 못 찾으면 타임스탬프/닉네임 헤더가 있는 시트를 찾는다
        for (int i = 0; i < wb.getNumberOfSheets(); i++) {
            Sheet s = wb.getSheetAt(i);
            if (findHeaderRow(s, "닉네임") != -1 && findHeaderRow(s, "타임스탬프") != -1) return s;
        }
        return wb.getNumberOfSheets() > 0 ? wb.getSheetAt(0) : null;
    }

    private Sheet findScoreSheet(Workbook wb) {
        for (int i = 0; i < wb.getNumberOfSheets(); i++) {
            String n = wb.getSheetName(i).replace(" ", "");
            if (n.contains("점수표")) return wb.getSheetAt(i);
        }
        return null;
    }

    /** 주어진 헤더 텍스트를 포함한 셀이 있는 첫 행 번호. 없으면 -1. */
    private int findHeaderRow(Sheet sheet, String needle) {
        int limit = Math.min(sheet.getLastRowNum(), 20);
        for (int r = sheet.getFirstRowNum(); r <= limit; r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;
            for (Cell c : row) {
                if (norm(cellText(c)).contains(needle)) return r;
            }
        }
        return -1;
    }

    // ==================== 응답 시트 ====================

    private List<ParsedPlayer> parseResponseSheet(Sheet sheet) {
        int headerRow = findHeaderRow(sheet, "닉네임");
        if (headerRow == -1) return List.of();

        int nameIdx = -1, summonerIdx = -1, tierIdx = -1, mainIdx = -1, subIdx = -1;
        int champsIdx = -1, resolutionIdx = -1, captainIdx = -1, newMemberIdx = -1;
        Map<String, Integer> lineIdx = new LinkedHashMap<>();

        for (Cell cell : sheet.getRow(headerRow)) {
            String h = norm(cellText(cell));
            int i = cell.getColumnIndex();
            if (h.isEmpty()) continue;

            if (h.startsWith("기준점수") || h.startsWith("점수(")) {
                LINE_HEADERS.forEach((ko, code) -> { if (h.contains(ko)) lineIdx.putIfAbsent(code, i); });
            } else if (nameIdx == -1 && (h.equals("이름") || h.equals("성명"))) nameIdx = i;
            else if (summonerIdx == -1 && h.contains("닉네임")) summonerIdx = i;
            else if (tierIdx == -1 && h.contains("티어")) tierIdx = i;
            else if (mainIdx == -1 && (h.contains("주포지션") || h.contains("주라인"))) mainIdx = i;
            else if (subIdx == -1 && (h.contains("부포지션") || h.contains("부라인"))) subIdx = i;
            else if (champsIdx == -1 && (h.contains("모스트") || h.contains("선호챔피언") || h.contains("선호요원"))) champsIdx = i;
            else if (captainIdx == -1 && h.contains("팀장") && h.contains("여부")) captainIdx = i;
            else if (newMemberIdx == -1 && h.contains("신입") && h.contains("여부")) newMemberIdx = i;
            else if (resolutionIdx == -1 && (h.contains("하고싶은말") || h.contains("각오") || h.contains("한마디"))) resolutionIdx = i;
        }

        List<ParsedPlayer> result = new ArrayList<>();
        for (int r = headerRow + 1; r <= sheet.getLastRowNum(); r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;

            String name = text(row, nameIdx);
            String summoner = text(row, summonerIdx);
            if (name.isEmpty() && summoner.isEmpty()) continue;

            ParsedPlayer p = new ParsedPlayer();
            p.setName(name.isEmpty() ? summoner : name);
            p.setSummonerName(summoner.isEmpty() ? name : summoner);
            p.setTier(text(row, tierIdx));
            p.setMainPosition(mapPosition(text(row, mainIdx)));
            p.setSubPosition(mapPosition(text(row, subIdx)));
            p.setMostChampions(text(row, champsIdx));
            p.setResolution(text(row, resolutionIdx));

            // '팀장 지원 여부' 칸에 "X(신입부원)"처럼 신입 표기가 섞여 들어오는 경우가 있다
            String captainCell = text(row, captainIdx);
            p.setCaptain(isYes(captainCell));
            p.setNewMember(isYes(text(row, newMemberIdx)) || captainCell.contains("신입"));

            lineIdx.forEach((line, idx) -> {
                Integer score = number(row, idx);
                if (score != null) p.getLineScores().put(line, score);
            });

            result.add(p);
        }
        return result;
    }

    // ==================== 참가자별 점수표 ====================

    private List<ParsedPlayer> parseScoreSheet(Sheet sheet) {
        int headerRow = -1;
        for (int r = sheet.getFirstRowNum(); r <= Math.min(sheet.getLastRowNum(), 20); r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;
            boolean hasName = false, hasTop = false, hasSup = false;
            for (Cell c : row) {
                String h = norm(cellText(c));
                if (h.equals("이름")) hasName = true;
                if (h.equals("탑")) hasTop = true;
                if (h.equals("서폿")) hasSup = true;
            }
            if (hasName && hasTop && hasSup) { headerRow = r; break; }
        }
        if (headerRow == -1) return List.of();

        int nameIdx = -1, summonerIdx = -1, tierIdx = -1, posIdx = -1;
        Map<String, Integer> lineIdx = new LinkedHashMap<>();
        for (Cell cell : sheet.getRow(headerRow)) {
            String h = norm(cellText(cell));
            int i = cell.getColumnIndex();
            if (h.isEmpty()) continue;
            if (LINE_HEADERS.containsKey(h)) lineIdx.putIfAbsent(LINE_HEADERS.get(h), i);
            else if (nameIdx == -1 && h.equals("이름")) nameIdx = i;
            else if (summonerIdx == -1 && h.contains("닉네임")) summonerIdx = i;
            else if (tierIdx == -1 && h.contains("티어")) tierIdx = i;
            else if (posIdx == -1 && h.contains("포지션")) posIdx = i;
        }

        List<ParsedPlayer> result = new ArrayList<>();
        int blankStreak = 0;
        for (int r = headerRow + 1; r <= sheet.getLastRowNum(); r++) {
            Row row = sheet.getRow(r);
            String name = row == null ? "" : text(row, nameIdx);
            if (name.isEmpty()) {
                // 표 아래쪽에 붙은 통계 블록에 걸리지 않도록 연속 공백에서 끊는다
                if (++blankStreak >= 3) break;
                continue;
            }
            blankStreak = 0;

            ParsedPlayer p = new ParsedPlayer();
            p.setName(name);
            String summoner = text(row, summonerIdx);
            p.setSummonerName(summoner.isEmpty() ? name : summoner);
            p.setTier(text(row, tierIdx));

            // "정글/미드" 형태의 주/부 포지션
            String posPair = text(row, posIdx);
            if (!posPair.isEmpty()) {
                String[] parts = posPair.split("[/,·]");
                p.setMainPosition(mapPosition(parts[0]));
                if (parts.length > 1) p.setSubPosition(mapPosition(parts[1]));
            }

            for (Map.Entry<String, Integer> e : lineIdx.entrySet()) {
                Integer score = number(row, e.getValue());
                if (score != null) p.getLineScores().put(e.getKey(), score);
            }
            result.add(p);
        }
        return result;
    }

    /** 점수표 옆에 붙어있는 "팀장" 표에서 이름들을 읽는다. */
    private List<String> findCaptainNames(Sheet sheet) {
        for (int r = sheet.getFirstRowNum(); r <= sheet.getLastRowNum(); r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;
            for (Cell c : row) {
                if (!norm(cellText(c)).equals("팀장")) continue;

                int col = c.getColumnIndex();
                List<String> names = new ArrayList<>();
                for (int rr = r + 1; rr <= sheet.getLastRowNum(); rr++) {
                    Row nameRow = sheet.getRow(rr);
                    String v = nameRow == null ? "" : text(nameRow, col);
                    if (v.isEmpty()) break;
                    names.add(v);
                }
                if (!names.isEmpty()) return names;
            }
        }
        return List.of();
    }

    // ==================== 셀 유틸 ====================

    private String text(Row row, int idx) {
        if (row == null || idx < 0) return "";
        return cellText(row.getCell(idx)).trim();
    }

    private Integer number(Row row, int idx) {
        if (row == null || idx < 0) return null;
        Cell cell = row.getCell(idx);
        if (cell == null) return null;
        CellType type = cell.getCellType() == CellType.FORMULA
                ? cell.getCachedFormulaResultType()
                : cell.getCellType();
        if (type == CellType.NUMERIC) return (int) Math.round(cell.getNumericCellValue());
        if (type == CellType.STRING) {
            String digits = cell.getStringCellValue().replaceAll("[^0-9-]", "");
            if (digits.isEmpty() || digits.equals("-")) return null;
            try {
                return Integer.parseInt(digits);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    /** 수식 셀은 캐시된 계산 결과를 읽는다. 이 워크북은 대부분의 값이 수식이다. */
    static String cellText(Cell cell) {
        if (cell == null) return "";
        CellType type = cell.getCellType() == CellType.FORMULA
                ? cell.getCachedFormulaResultType()
                : cell.getCellType();
        return switch (type) {
            case STRING -> cell.getStringCellValue();
            case NUMERIC -> {
                double d = cell.getNumericCellValue();
                yield d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
            }
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            default -> "";
        };
    }

    private static String norm(String s) {
        return s == null ? "" : s.trim().replace(" ", "").replace("\n", "");
    }

    static String normalize(String s) {
        return s == null ? "" : s.trim().replace(" ", "").toLowerCase();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static boolean isYes(String raw) {
        if (raw == null) return false;
        String v = raw.trim().toUpperCase();
        return v.startsWith("O") || v.equals("ㅇ") || v.startsWith("Y") || v.equals("TRUE") || v.equals("1");
    }

    static String mapPosition(String pos) {
        if (pos == null) return "";
        String p = pos.trim().toUpperCase();
        if (p.isEmpty() || p.equals("없음") || p.equals("-")) return "";
        if (p.contains("탑") || p.equals("TOP")) return "TOP";
        if (p.contains("정글") || p.equals("JUNGLE") || p.equals("JG")) return "JUNGLE";
        if (p.contains("미드") || p.equals("MID")) return "MID";
        if (p.contains("원딜") || p.equals("ADC") || p.equals("BOT")) return "ADC";
        if (p.contains("서포터") || p.contains("서폿") || p.equals("SUP") || p.equals("SUPPORT")) return "SUPPORT";
        return "";
    }
}
