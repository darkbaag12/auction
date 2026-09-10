package com.gyeongmae.auction;

import com.gyeongmae.auction.service.ExcelRosterParser;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.junit.jupiter.api.Test;

import java.io.FileInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 실제 참가 신청서 워크북으로 파서를 확인한다.
 * 파일 경로는 -Droster.xlsx=... 로 넘길 수 있고, 없으면 테스트를 건너뛴다.
 */
public class ExcelParserTest {

    private static final String DEFAULT_PATH =
            System.getProperty("user.home") + "/Downloads/League 멸망전_ 2nd Era 참가 신청서(응답).xlsx";

    @Test
    public void parsesRosterAndCaptains() throws Exception {
        Path path = Paths.get(System.getProperty("roster.xlsx", DEFAULT_PATH));
        assumeTrue(Files.exists(path), "참가 신청서 엑셀이 없어 건너뜁니다: " + path);

        ExcelRosterParser.ParsedRoster roster;
        try (FileInputStream fis = new FileInputStream(path.toFile());
             Workbook wb = WorkbookFactory.create(fis)) {
            roster = new ExcelRosterParser().parse(wb);
        }

        List<ExcelRosterParser.ParsedPlayer> players = roster.getPlayers();
        assertFalse(players.isEmpty(), "참가자를 한 명도 못 읽었습니다");
        assertFalse(roster.getCaptainNames().isEmpty(), "팀장 목록을 못 읽었습니다");

        for (ExcelRosterParser.ParsedPlayer p : players) {
            assertNotNull(p.getName());
            assertFalse(p.getName().isBlank());
            assertEquals(5, p.getLineScores().size(),
                    p.getName() + " 의 라인별 점수가 5개가 아닙니다: " + p.getLineScores());
            assertFalse(p.getMainPosition().isBlank(), p.getName() + " 의 주 포지션이 비었습니다");
        }

        long captains = players.stream().filter(ExcelRosterParser.ParsedPlayer::isCaptain).count();
        assertEquals(roster.getCaptainNames().size(), captains, "팀장 목록과 매칭된 선수 수가 다릅니다");

        System.out.println("참가자 " + players.size() + "명 / 팀장 " + roster.getCaptainNames());
        players.stream().limit(5).forEach(p -> System.out.println(
                p.getName() + " | " + p.getSummonerName() + " | " + p.getTier() + " | "
                        + p.getMainPosition() + "/" + p.getSubPosition() + " | " + p.getLineScores()
                        + " | 팀장=" + p.isCaptain() + " | 신입=" + p.isNewMember()));
    }
}
