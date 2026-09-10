package com.gyeongmae.auction.service;

import com.gyeongmae.auction.dto.*;
import com.gyeongmae.auction.entity.*;
import com.gyeongmae.auction.entity.AuctionRound.AuctionRoundStatus;
import com.gyeongmae.auction.entity.Player.PlayerStatus;
import com.gyeongmae.auction.entity.Tournament.TournamentStatus;
import com.gyeongmae.auction.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.apache.poi.ss.usermodel.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 경매 진행 로직. 룰북 4-3 '라인 지정 매입제'를 따른다.
 *
 * <ul>
 *   <li>선수마다 5개 라인의 기준 점수를 가진다.</li>
 *   <li>팀장이 올리는 값은 <b>프리미엄가</b>뿐이며, 범위는 [하한, +20]이다.</li>
 *   <li>화면에는 주/부 라인 각각 '기준 점수 + 프리미엄가'가 실시간으로 표시된다.</li>
 *   <li>낙찰 후 팀장이 라인을 선언하면 '그 라인의 기준 점수 + 프리미엄가'가 예산에서 차감된다.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@lombok.extern.slf4j.Slf4j
public class AuctionService {

    private final TournamentRepository tournamentRepository;
    private final TeamRepository teamRepository;
    private final PlayerRepository playerRepository;
    private final AuctionRoundRepository auctionRoundRepository;
    private final BidRepository bidRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final SimpMessagingTemplate messagingTemplate;

    private static final List<String> LINES = Team.LINES;

    // ==================== Tournament ====================

    @Transactional
    public TournamentDto.Response createTournament(TournamentDto.CreateRequest request) {
        Tournament tournament = Tournament.builder()
                .name(request.getName())
                .totalPoints(request.getTotalPoints() > 0 ? request.getTotalPoints() : 290)
                .bidUnit(request.getBidUnit() > 0 ? request.getBidUnit() : 1)
                .maxTeamSize(request.getMaxTeamSize() > 0 ? request.getMaxTeamSize() : 5)
                .premiumCap(request.getPremiumCap() != null && request.getPremiumCap() > 0 ? request.getPremiumCap() : 20)
                .accessCode(request.getAccessCode())
                .build();
        tournament = tournamentRepository.save(tournament);
        return toTournamentResponse(tournament);
    }

    @Transactional(readOnly = true)
    public List<TournamentDto.Response> getTournaments() {
        return tournamentRepository.findAll().stream()
                .map(this::toTournamentResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void deleteTournament(Long tournamentId) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));

        List<AuctionRound> rounds = auctionRoundRepository.findByTournamentIdOrderByRoundNumberAsc(tournamentId);
        auctionRoundRepository.deleteAll(rounds);

        List<Player> players = playerRepository.findByTournamentId(tournamentId);
        for (Player p : players) {
            p.setTeam(null);
            playerRepository.save(p);
        }
        List<Team> teams = teamRepository.findByTournamentId(tournamentId);
        teamRepository.deleteAll(teams);
        playerRepository.deleteAll(players);
        tournamentRepository.delete(tournament);
    }

    @Transactional
    public void setAccessCode(Long tournamentId, String code) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));
        tournament.setAccessCode(code == null || code.isBlank() ? null : code);
        tournamentRepository.save(tournament);
    }

    @Transactional(readOnly = true)
    public boolean verifyAccessCode(Long tournamentId, String code) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));
        if (tournament.getAccessCode() == null || tournament.getAccessCode().isBlank()) return true;
        return tournament.getAccessCode().equals(code);
    }

    @Transactional(readOnly = true)
    public TournamentDto.Response getTournament(Long id) {
        Tournament tournament = tournamentRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found: " + id));
        return toTournamentResponse(tournament);
    }

    @Transactional(readOnly = true)
    public TournamentDto.Response getLatestTournament() {
        Tournament tournament = tournamentRepository.findTopByOrderByIdDesc().orElse(null);
        return tournament != null ? toTournamentResponse(tournament) : null;
    }

    // ==================== Team ====================

    @Transactional
    public TeamDto.Response createTeam(Long tournamentId, TeamDto.CreateRequest request) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));

        int budget = (request.getStartingPoints() != null && request.getStartingPoints() > 0)
                ? request.getStartingPoints()
                : tournament.getTotalPoints();

        String captainPosition = ExcelRosterParser.mapPosition(request.getCaptainPosition());

        Team team = Team.builder()
                .tournament(tournament)
                .name(request.getName())
                .captainName(request.getCaptainName())
                .captainPosition(captainPosition.isEmpty() ? null : captainPosition)
                .captainScore(0)
                .remainingPoints(budget)
                .build();
        team = teamRepository.save(team);
        return toTeamResponse(team);
    }

    /** 팀장 라인/점수 수정. 라인만 바꾸면 팀장 선수 기록에서 점수를 다시 계산한다. */
    @Transactional
    public TeamDto.Response updateTeam(Long tournamentId, Long teamId, TeamDto.UpdateRequest request) {
        Team team = teamRepository.findById(teamId)
                .orElseThrow(() -> new IllegalArgumentException("Team not found"));
        if (!team.getTournament().getId().equals(tournamentId)) {
            throw new IllegalArgumentException("해당 팀은 이 대회 소속이 아닙니다.");
        }

        if (request.getName() != null && !request.getName().isBlank()) team.setName(request.getName());
        if (request.getCaptainName() != null && !request.getCaptainName().isBlank()) team.setCaptainName(request.getCaptainName());

        if (request.getCaptainPosition() != null) {
            String newLine = ExcelRosterParser.mapPosition(request.getCaptainPosition());
            if (newLine.isEmpty()) throw new IllegalArgumentException("알 수 없는 라인입니다: " + request.getCaptainPosition());

            boolean taken = team.getMembers().stream()
                    .anyMatch(m -> newLine.equalsIgnoreCase(m.getAssignedPosition()));
            if (taken) throw new IllegalArgumentException("이미 선수가 배정된 라인입니다: " + newLine);

            Player captain = findCaptainPlayer(team);
            int newScore = captain != null ? captain.getScoreFor(newLine) : team.getCaptainScore();

            // 팀장 점수는 예산에 포함되므로 라인 변경 시 차액만큼 예산을 조정한다
            team.setRemainingPoints(team.getRemainingPoints() + team.getCaptainScore() - newScore);
            team.setCaptainPosition(newLine);
            team.setCaptainScore(newScore);

            if (captain != null) {
                captain.setAssignedPosition(newLine);
                captain.setSoldPrice(newScore);
                playerRepository.save(captain);
            }
        }

        if (request.getRemainingPoints() != null) team.setRemainingPoints(request.getRemainingPoints());

        team = teamRepository.save(team);
        broadcast(tournamentId, "TEAMS_UPDATED", null);
        return toTeamResponse(team);
    }

    private Player findCaptainPlayer(Team team) {
        return playerRepository.findByTournamentId(team.getTournament().getId()).stream()
                .filter(p -> Boolean.TRUE.equals(p.getIsCaptain()))
                .filter(p -> p.getTeam() != null && p.getTeam().getId().equals(team.getId()))
                .findFirst()
                .orElse(null);
    }

    @Transactional(readOnly = true)
    public List<TeamDto.Response> getTeams(Long tournamentId) {
        return teamRepository.findByTournamentId(tournamentId).stream()
                .map(this::toTeamResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void deleteTeam(Long tournamentId, Long teamId) {
        Team team = teamRepository.findById(teamId)
                .orElseThrow(() -> new IllegalArgumentException("Team not found"));
        if (!team.getTournament().getId().equals(tournamentId)) {
            throw new IllegalArgumentException("Team does not belong to this tournament");
        }

        List<AuctionRound> wonRounds = auctionRoundRepository.findByWinningTeamId(teamId);
        for (AuctionRound round : wonRounds) {
            round.setWinningTeam(null);
            round.setStatus(AuctionRoundStatus.UNSOLD);
            round.setFinalPrice(null);
            round.setFinalPremium(null);
            round.setAssignedPosition(null);
            auctionRoundRepository.save(round);
        }

        List<Bid> teamBids = bidRepository.findByTeamId(teamId);
        if (!teamBids.isEmpty()) bidRepository.deleteAll(teamBids);

        List<Player> players = playerRepository.findByTournamentId(tournamentId);
        for (Player p : players) {
            if (p.getTeam() != null && p.getTeam().getId().equals(teamId)) {
                p.setTeam(null);
                p.setSoldPrice(null);
                p.setAssignedPosition(null);
                p.setStatus(Boolean.TRUE.equals(p.getIsCaptain()) ? PlayerStatus.SOLD : PlayerStatus.AVAILABLE);
                playerRepository.save(p);
            }
        }

        teamRepository.delete(team);
    }

    // ==================== Player ====================

    @Transactional
    public PlayerDto.Response createPlayer(Long tournamentId, PlayerDto.CreateRequest request) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));

        String mainPos = ExcelRosterParser.mapPosition(request.getMainPosition());
        if (mainPos.isEmpty()) mainPos = request.getMainPosition();

        Player player = Player.builder()
                .tournament(tournament)
                .name(request.getName() != null ? request.getName() : request.getSummonerName())
                .summonerName(request.getSummonerName())
                .tier(request.getTier())
                .rankDivision(request.getRankDivision())
                .lp(request.getLp())
                .mainPosition(mainPos)
                .subPosition(ExcelRosterParser.mapPosition(request.getSubPosition()))
                .mostChampions(request.getMostChampions())
                .isNewMember(request.getIsNewMember() != null ? request.getIsNewMember() : false)
                .profileIconUrl(request.getProfileIconUrl())
                .resolution(request.getResolution())
                .build();

        Map<String, Integer> scores = request.getLineScores() != null && !request.getLineScores().isEmpty()
                ? request.getLineScores()
                : TierScoreTable.scoresFor(request.getTier() != null ? request.getTier() : "");
        applyLineScores(player, scores, request.getStartingScore());

        player = playerRepository.save(player);
        return toPlayerResponse(player);
    }

    @Transactional
    public List<PlayerDto.Response> createPlayersBulk(Long tournamentId, List<PlayerDto.CreateRequest> requests) {
        return requests.stream()
                .map(req -> createPlayer(tournamentId, req))
                .collect(Collectors.toList());
    }

    private void applyLineScores(Player player, Map<String, Integer> scores, Integer fallback) {
        if (scores != null) {
            player.setScoreTop(scores.get("TOP"));
            player.setScoreJungle(scores.get("JUNGLE"));
            player.setScoreMid(scores.get("MID"));
            player.setScoreAdc(scores.get("ADC"));
            player.setScoreSupport(scores.get("SUPPORT"));
        }
        Integer mainScore = (scores != null && player.getMainPosition() != null)
                ? scores.get(player.getMainPosition())
                : null;
        player.setStartingScore(mainScore != null ? mainScore : fallback);
    }

    // ==================== Excel Import ====================

    /**
     * 참가 신청서 엑셀을 읽어 선수 풀과 팀을 구성한다.
     * '참가자별 점수표'의 보정된 라인별 점수와 팀장 목록을 기준으로 삼고,
     * '응답 시트'에서 모스트 챔피언 / 각오 / 신입 여부를 채워 넣는다.
     */
    @Transactional
    public List<PlayerDto.Response> importPlayersFromExcel(Long tournamentId, MultipartFile file) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));

        deleteAllPlayers(tournamentId);

        ExcelRosterParser.ParsedRoster roster;
        try (InputStream is = file.getInputStream();
             Workbook workbook = WorkbookFactory.create(is)) {
            roster = new ExcelRosterParser().parse(workbook);
        } catch (Exception e) {
            log.error("엑셀 파싱 실패", e);
            throw new RuntimeException("엑셀 파일 파싱 중 오류가 발생했습니다: " + e.getMessage());
        }

        if (roster.getPlayers().isEmpty()) {
            throw new RuntimeException("엑셀에서 참가자를 한 명도 찾지 못했습니다. 시트 구성을 확인해주세요.");
        }

        List<Player> saved = new ArrayList<>();
        Map<String, Player> captainByName = new LinkedHashMap<>();

        for (ExcelRosterParser.ParsedPlayer parsed : roster.getPlayers()) {
            String rawTier = parsed.getTier();
            String notation = TierScoreTable.canonical(rawTier);

            Map<String, Integer> scores = new LinkedHashMap<>(parsed.getLineScores());
            if (scores.isEmpty()) scores = TierScoreTable.scoresFor(rawTier);

            Player player = Player.builder()
                    .tournament(tournament)
                    .name(orDefault(parsed.getName(), parsed.getSummonerName()))
                    .summonerName(orDefault(parsed.getSummonerName(), parsed.getName()))
                    .tier(mapTier(rawTier))
                    .rankDivision(mapDivision(rawTier))
                    .lp(extractLp(rawTier))
                    .mainPosition(parsed.getMainPosition())
                    .subPosition(parsed.getSubPosition())
                    .mostChampions(parsed.getMostChampions())
                    .isNewMember(parsed.isNewMember())
                    .isCaptain(parsed.isCaptain())
                    .resolution(parsed.getResolution())
                    .build();
            applyLineScores(player, scores, null);

            if (parsed.isCaptain()) {
                // 팀장은 경매 풀에 올라가지 않는다
                player.setStatus(PlayerStatus.SOLD);
                warnIfIneligibleCaptain(player, notation);
            }

            player = playerRepository.save(player);
            saved.add(player);
            if (parsed.isCaptain()) {
                captainByName.put(ExcelRosterParser.normalize(player.getName()), player);
            }
        }

        createTeamsForCaptains(tournament, roster.getCaptainNames(), captainByName);

        log.info("엑셀 임포트 완료: 전체 {}명 (팀장 {}명)", saved.size(), captainByName.size());
        return saved.stream().map(this::toPlayerResponse).collect(Collectors.toList());
    }

    /** 룰북 2장: 신입 회원 및 플래티넘 이하는 팀장이 될 수 없다. 자동 차단 대신 경고만 남긴다. */
    private void warnIfIneligibleCaptain(Player player, String notation) {
        boolean lowTier = notation.startsWith("I") || notation.startsWith("B")
                || notation.startsWith("S") || notation.startsWith("G") || notation.startsWith("P");
        if (Boolean.TRUE.equals(player.getIsNewMember())) {
            log.warn("팀장 자격 확인 필요 - 신입 회원: {}", player.getName());
        }
        if (lowTier) {
            log.warn("팀장 자격 확인 필요 - 플래티넘 이하({}): {}", notation, player.getName());
        }
    }

    /** 팀장 목록 순서대로 '1팀, 2팀 ...' 을 만든다. 같은 팀장 이름의 팀이 이미 있으면 건너뛴다. */
    private void createTeamsForCaptains(Tournament tournament, List<String> captainNames, Map<String, Player> captainByName) {
        List<Team> existing = teamRepository.findByTournamentId(tournament.getId());
        Set<String> existingCaptains = existing.stream()
                .map(t -> ExcelRosterParser.normalize(t.getCaptainName()))
                .collect(Collectors.toSet());

        int teamNumber = existing.size();
        for (String captainName : captainNames) {
            String key = ExcelRosterParser.normalize(captainName);
            if (existingCaptains.contains(key)) {
                // 이미 있는 팀이면 팀장 선수 기록만 연결해준다
                existing.stream()
                        .filter(t -> ExcelRosterParser.normalize(t.getCaptainName()).equals(key))
                        .findFirst()
                        .ifPresent(t -> linkCaptainToTeam(t, captainByName.get(key)));
                continue;
            }

            Player captain = captainByName.get(key);
            String line = captain != null ? captain.getMainPosition() : null;
            int captainScore = captain != null && line != null && !line.isBlank() ? captain.getScoreFor(line) : 0;

            teamNumber++;
            Team team = Team.builder()
                    .tournament(tournament)
                    .name(teamNumber + "팀")
                    .captainName(captainName.trim())
                    .captainPosition(line != null && !line.isBlank() ? line : null)
                    .captainScore(captainScore)
                    // 룰북 4-3: 팀장 본인 점수를 포함해 총 290점
                    .remainingPoints(tournament.getTotalPoints() - captainScore)
                    .build();
            team = teamRepository.save(team);
            linkCaptainToTeam(team, captain);
        }
    }

    private void linkCaptainToTeam(Team team, Player captain) {
        if (captain == null) return;
        captain.setIsCaptain(true);
        captain.setStatus(PlayerStatus.SOLD);
        captain.setTeam(team);
        captain.setAssignedPosition(team.getCaptainPosition());
        captain.setSoldPrice(team.getCaptainScore());
        playerRepository.save(captain);
    }

    private static String orDefault(String value, String fallback) {
        return value != null && !value.isBlank() ? value : (fallback != null ? fallback : "");
    }

    // ==================== 티어 표기 변환 ====================

    private String mapTier(String tierStr) {
        String notation = TierScoreTable.canonical(tierStr);
        if (notation.isEmpty()) return "UNRANKED";
        return switch (notation.charAt(0)) {
            case 'I' -> "IRON";
            case 'B' -> "BRONZE";
            case 'S' -> "SILVER";
            case 'G' -> "GOLD";
            case 'P' -> "PLATINUM";
            case 'E' -> "EMERALD";
            case 'D' -> "DIAMOND";
            case 'M' -> "MASTER";
            default -> "UNRANKED";
        };
    }

    private String mapDivision(String tierStr) {
        String notation = TierScoreTable.canonical(tierStr);
        if (notation.isEmpty() || notation.startsWith("M") || notation.equals("I")) return "";
        if (notation.equals("B3~4")) return "4";
        if (notation.equals("B1~2")) return "2";
        String digits = notation.replaceAll("[^1-4]", "");
        return digits.isEmpty() ? "" : digits.substring(0, 1);
    }

    private int extractLp(String tierStr) {
        String notation = TierScoreTable.canonical(tierStr);
        return switch (notation) {
            case "M400+" -> 400;
            case "M800+" -> 800;
            case "M1200+" -> 1200;
            case "M+" -> 0;
            default -> 0;
        };
    }

    @Transactional(readOnly = true)
    public List<PlayerDto.Response> getPlayers(Long tournamentId) {
        return playerRepository.findByTournamentId(tournamentId).stream()
                .map(this::toPlayerResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void deleteAllPlayers(Long tournamentId) {
        tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));

        List<Player> existingPlayers = playerRepository.findByTournamentId(tournamentId);
        if (existingPlayers.isEmpty()) return;

        List<AuctionRound> rounds = auctionRoundRepository.findByTournamentIdOrderByRoundNumberAsc(tournamentId);
        auctionRoundRepository.deleteAll(rounds);

        for (Player player : existingPlayers) {
            Team team = player.getTeam();
            if (team == null) continue;

            List<TeamMember> members = teamMemberRepository.findByTeamId(team.getId());
            members.stream()
                    .filter(m -> m.getPlayer().getId().equals(player.getId()))
                    .findFirst()
                    .ifPresent(member -> {
                        team.getMembers().remove(member);
                        teamMemberRepository.delete(member);
                        team.setRemainingPoints(team.getRemainingPoints() + member.getPurchasePrice());
                    });

            if (Boolean.TRUE.equals(player.getIsCaptain())) {
                // 팀장 점수도 예산에 포함되어 있었으므로 되돌린다
                team.setRemainingPoints(team.getRemainingPoints() + team.getCaptainScore());
                team.setCaptainScore(0);
            }
            player.setTeam(null);
            teamRepository.save(team);
        }

        playerRepository.saveAll(existingPlayers);
        playerRepository.deleteAll(existingPlayers);
    }

    // ==================== Auction ====================

    /**
     * 매물을 경매에 올린다.
     * 유찰 재경매일 때는 룰북 4-3에 따라 프리미엄가 하한을 '최종가를 0으로 만드는 최댓값'으로 잡는다.
     */
    @Transactional
    public AuctionDto.RoundResponse startAuctionRound(Long tournamentId, AuctionDto.StartRequest request) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));

        List<AuctionRound> busy = auctionRoundRepository.findByTournamentIdAndStatusIn(
                tournamentId, List.of(AuctionRoundStatus.ACTIVE, AuctionRoundStatus.PENDING_ASSIGN));
        if (!busy.isEmpty()) {
            boolean pending = busy.stream().anyMatch(r -> r.getStatus() == AuctionRoundStatus.PENDING_ASSIGN);
            throw new IllegalStateException(pending
                    ? "낙찰팀의 라인 선언이 끝나지 않았습니다."
                    : "이미 진행 중인 경매가 있습니다.");
        }

        Player player = playerRepository.findById(request.getPlayerId())
                .orElseThrow(() -> new IllegalArgumentException("Player not found"));

        if (Boolean.TRUE.equals(player.getIsCaptain())) {
            throw new IllegalStateException("팀장은 경매 대상이 아닙니다.");
        }
        if (player.getStatus() != PlayerStatus.AVAILABLE && player.getStatus() != PlayerStatus.UNSOLD) {
            throw new IllegalStateException("이 선수는 현재 경매에 올릴 수 없습니다: " + player.getStatus());
        }

        if (tournament.getStatus() == TournamentStatus.READY) {
            tournament.setStatus(TournamentStatus.IN_PROGRESS);
            tournamentRepository.save(tournament);
        }

        boolean isReAuction = player.getStatus() == PlayerStatus.UNSOLD;
        int premiumCap = request.getPremiumCap() != null && request.getPremiumCap() > 0
                ? request.getPremiumCap()
                : tournament.getPremiumCap();
        int premiumFloor = isReAuction ? reAuctionFloor(player) : 0;

        AuctionRound round = AuctionRound.builder()
                .tournament(tournament)
                .player(player)
                .roundNumber(auctionRoundRepository.countByTournamentId(tournamentId) + 1)
                .startingPrice(0)
                .premiumFloor(premiumFloor)
                .premiumCap(premiumCap)
                .isReAuction(isReAuction)
                .status(AuctionRoundStatus.ACTIVE)
                .startedAt(LocalDateTime.now())
                .build();
        round = auctionRoundRepository.save(round);

        player.setStatus(PlayerStatus.AUCTIONING);
        playerRepository.save(player);

        AuctionDto.RoundResponse response = toRoundResponse(round);
        broadcast(tournamentId, "ROUND_START", response);
        return response;
    }

    /**
     * 룰북 4-3: "유찰 재경매의 경우 매입 가능한 가격 중 최종가를 0으로 만드는 최댓값을 하한으로 한다."
     * 주/부 라인 기준가 중 가장 싼 쪽이 0원이 되는 값 = -min(기준가).
     */
    private int reAuctionFloor(Player player) {
        List<Integer> candidates = new ArrayList<>();
        for (String line : declaredLines(player)) candidates.add(player.getScoreFor(line));
        if (candidates.isEmpty()) return 0;
        return -Collections.min(candidates);
    }

    /** 매물이 신청한 주/부 포지션. 둘 다 없으면 5라인 전체로 본다. */
    private List<String> declaredLines(Player player) {
        List<String> lines = new ArrayList<>();
        if (player.getMainPosition() != null && LINES.contains(player.getMainPosition())) {
            lines.add(player.getMainPosition());
        }
        if (player.getSubPosition() != null && LINES.contains(player.getSubPosition())
                && !lines.contains(player.getSubPosition())) {
            lines.add(player.getSubPosition());
        }
        return lines.isEmpty() ? new ArrayList<>(LINES) : lines;
    }

    /**
     * 룰북 4-3: 팀장은 매물의 주/부 포지션 중 자기 팀에 빈 라인이 하나 이상 있을 때만 입찰할 수 있다.
     * 조건을 만족하는 팀이 하나도 없으면 그 매물에 한해 조건을 적용하지 않는다.
     */
    private Map<Long, List<String>> eligibleLinesByTeam(AuctionRound round) {
        List<Team> teams = teamRepository.findByTournamentId(round.getTournament().getId());
        List<String> declared = declaredLines(round.getPlayer());

        Map<Long, List<String>> strict = new LinkedHashMap<>();
        for (Team team : teams) {
            List<String> open = team.getOpenLines();
            List<String> allowed = declared.stream().filter(open::contains).collect(Collectors.toList());
            if (!allowed.isEmpty()) strict.put(team.getId(), allowed);
        }
        if (!strict.isEmpty()) return strict;

        // 조건을 만족하는 팀장이 없다 → 이 매물에 한해 빈 라인 아무 곳이나 허용
        Map<Long, List<String>> relaxed = new LinkedHashMap<>();
        for (Team team : teams) {
            List<String> open = team.getOpenLines();
            if (!open.isEmpty()) relaxed.put(team.getId(), open);
        }
        return relaxed;
    }

    /** 팀이 이 프리미엄가로 실제 살 수 있는 가장 싼 최종가. 살 수 있는 라인이 없으면 null. */
    private Integer cheapestFinalPrice(Player player, List<String> allowedLines, int premium) {
        Integer min = null;
        for (String line : allowedLines) {
            int price = finalPrice(player, line, premium);
            if (min == null || price < min) min = price;
        }
        return min;
    }

    /** 최종가 = 기준가 + 프리미엄가 (음수 방지). */
    private int finalPrice(Player player, String line, int premium) {
        return Math.max(0, player.getScoreFor(line) + premium);
    }

    @Transactional
    public AuctionDto.BidResponse placeBid(AuctionDto.BidRequest request) {
        AuctionRound round = auctionRoundRepository.findById(request.getRoundId())
                .orElseThrow(() -> new IllegalArgumentException("Auction round not found"));

        if (round.getStatus() != AuctionRoundStatus.ACTIVE) {
            throw new IllegalStateException("경매가 진행 중이 아닙니다.");
        }

        Team team = teamRepository.findById(request.getTeamId())
                .orElseThrow(() -> new IllegalArgumentException("Team not found"));

        int premium = request.getAmount();
        int floor = round.getPremiumFloor();
        int cap = round.getPremiumCap();
        Player player = round.getPlayer();

        if (premium < floor) {
            throw new IllegalArgumentException("프리미엄가 하한(" + floor + ")보다 낮게 입찰할 수 없습니다.");
        }
        if (premium > cap) {
            throw new IllegalArgumentException("프리미엄가 상한(+" + cap + ")을 초과할 수 없습니다.");
        }

        Map<Long, List<String>> eligible = eligibleLinesByTeam(round);
        List<String> allowedLines = eligible.get(team.getId());
        if (allowedLines == null || allowedLines.isEmpty()) {
            throw new IllegalArgumentException("이 매물의 주/부 라인 중 팀에 빈 라인이 없어 입찰할 수 없습니다.");
        }

        int currentPremium = round.getCurrentPremium();
        boolean hasBids = !round.getBids().isEmpty();
        boolean atCapTie = premium == cap && currentPremium == cap;

        // 이미 최고가인 팀이 또 올리는 건 막는다. 단, 상한 동률 참여는 허용한다(룰북 4-3).
        round.getBids().stream()
                .reduce((a, b) -> a.getBidAmount() >= b.getBidAmount() ? a : b)
                .ifPresent(highest -> {
                    if (highest.getTeam().getId().equals(team.getId()) && !atCapTie) {
                        throw new IllegalArgumentException("이미 최고가 입찰자입니다.");
                    }
                });

        if (atCapTie) {
            boolean already = round.getBids().stream()
                    .anyMatch(b -> b.getTeam().getId().equals(team.getId()) && b.getBidAmount() == cap);
            if (already) throw new IllegalArgumentException("이미 상한가 입찰에 참여했습니다.");
        } else if (premium <= currentPremium && hasBids) {
            throw new IllegalArgumentException("현재 최고 프리미엄가(" + currentPremium + ")보다 높게 입찰해야 합니다.");
        }

        Integer cheapest = cheapestFinalPrice(player, allowedLines, premium);
        if (cheapest == null || team.getRemainingPoints() < cheapest) {
            throw new IllegalArgumentException("포인트가 부족합니다. 최소 필요: " + cheapest + "P / 잔여: " + team.getRemainingPoints());
        }

        Bid bid = bidRepository.save(Bid.builder()
                .auctionRound(round)
                .team(team)
                .bidAmount(premium)
                .build());
        round.getBids().add(bid);

        Map<Long, Integer> teamsPoints = teamRepository.findByTournamentId(round.getTournament().getId())
                .stream()
                .collect(Collectors.toMap(Team::getId, Team::getRemainingPoints));

        AuctionDto.BidResponse response = AuctionDto.BidResponse.builder()
                .bidId(bid.getId())
                .teamId(team.getId())
                .teamName(team.getName())
                .amount(bid.getBidAmount())
                .timestamp(bid.getBidTime().toString())
                .teamsPoints(teamsPoints)
                .build();

        broadcast(round.getTournament().getId(), "NEW_BID", response);
        // 라인별 표시 가격이 프리미엄가와 함께 갱신되도록 라운드 상태도 같이 보낸다
        broadcast(round.getTournament().getId(), "ROUND_UPDATE", toRoundResponse(round));
        return response;
    }

    /**
     * 낙찰 확정. 이 시점에는 아직 포인트를 차감하지 않고,
     * 낙찰팀 팀장이 라인을 선언할 때까지 PENDING_ASSIGN 상태로 기다린다.
     */
    @Transactional
    public AuctionDto.RoundResponse closeAuctionRound(AuctionDto.CloseRequest request) {
        AuctionRound round = auctionRoundRepository.findById(request.getRoundId())
                .orElseThrow(() -> new IllegalArgumentException("Auction round not found"));

        if (round.getStatus() != AuctionRoundStatus.ACTIVE) {
            throw new IllegalStateException("진행 중인 경매만 종료할 수 있습니다.");
        }

        List<Bid> bids = bidRepository.findByAuctionRoundIdOrderByBidTimeDesc(round.getId());
        if (bids.isEmpty()) {
            return passAuctionRound(request.getRoundId());
        }

        int topPremium = bids.stream().mapToInt(Bid::getBidAmount).max().orElseThrow();
        Bid winningBid;
        if (request.getWinningTeamId() != null) {
            winningBid = bids.stream()
                    .filter(b -> b.getBidAmount() == topPremium && b.getTeam().getId().equals(request.getWinningTeamId()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("선택한 팀이 최고가 입찰자가 아닙니다."));
        } else {
            List<Bid> topBids = bids.stream().filter(b -> b.getBidAmount() == topPremium).collect(Collectors.toList());
            long distinctTeams = topBids.stream().map(b -> b.getTeam().getId()).distinct().count();
            if (distinctTeams > 1) {
                throw new IllegalStateException("상한가 동률입니다. 낙찰될 팀을 선택해주세요.");
            }
            winningBid = topBids.get(0);
        }

        round.setStatus(AuctionRoundStatus.PENDING_ASSIGN);
        round.setFinalPremium(topPremium);
        round.setWinningTeam(winningBid.getTeam());
        auctionRoundRepository.save(round);

        AuctionDto.RoundResponse response = toRoundResponse(round);
        broadcast(round.getTournament().getId(), "ROUND_PENDING_ASSIGN", response);
        return response;
    }

    /**
     * 룰북 4-3: "낙찰팀은 즉시 해당 매물을 어느 라인으로 기용할지 선언해야 하며,
     * 선언한 라인의 최종가가 팀 예산에서 차감된다."
     */
    @Transactional
    public AuctionDto.RoundResponse assignLine(AuctionDto.AssignRequest request) {
        AuctionRound round = auctionRoundRepository.findById(request.getRoundId())
                .orElseThrow(() -> new IllegalArgumentException("Auction round not found"));

        if (round.getStatus() != AuctionRoundStatus.PENDING_ASSIGN) {
            throw new IllegalStateException("라인 선언을 기다리는 경매가 아닙니다.");
        }

        Team team = round.getWinningTeam();
        if (team == null) throw new IllegalStateException("낙찰팀이 지정되지 않았습니다.");
        if (request.getTeamId() != null && !request.getTeamId().equals(team.getId())) {
            throw new IllegalArgumentException("낙찰팀만 라인을 선언할 수 있습니다.");
        }

        String line = ExcelRosterParser.mapPosition(request.getPosition());
        if (line.isEmpty()) throw new IllegalArgumentException("알 수 없는 라인입니다: " + request.getPosition());
        if (!team.isLineOpen(line)) throw new IllegalArgumentException("이미 채워진 라인입니다: " + line);

        Player player = round.getPlayer();
        int premium = round.getFinalPremium() != null ? round.getFinalPremium() : 0;
        int basePrice = player.getScoreFor(line);
        int price = finalPrice(player, line, premium);

        if (team.getRemainingPoints() < price) {
            throw new IllegalArgumentException("포인트가 부족합니다. 필요: " + price + "P / 잔여: " + team.getRemainingPoints());
        }

        round.setStatus(AuctionRoundStatus.SOLD);
        round.setAssignedPosition(line);
        round.setFinalPrice(price);
        round.setEndedAt(LocalDateTime.now());
        auctionRoundRepository.save(round);

        player.setStatus(PlayerStatus.SOLD);
        player.setTeam(team);
        player.setAssignedPosition(line);
        player.setSoldPrice(price);
        playerRepository.save(player);

        team.setRemainingPoints(team.getRemainingPoints() - price);

        TeamMember member = TeamMember.builder()
                .team(team)
                .player(player)
                .assignedPosition(line)
                .basePrice(basePrice)
                .premium(premium)
                .purchasePrice(price)
                .build();
        teamMemberRepository.save(member);
        team.getMembers().add(member);
        teamRepository.save(team);

        AuctionDto.RoundResponse response = toRoundResponse(round);
        broadcast(round.getTournament().getId(), "ROUND_SOLD", response);
        return response;
    }

    @Transactional
    public AuctionDto.RoundResponse passAuctionRound(Long roundId) {
        AuctionRound round = auctionRoundRepository.findById(roundId)
                .orElseThrow(() -> new IllegalArgumentException("Auction round not found"));

        round.setStatus(AuctionRoundStatus.UNSOLD);
        round.setEndedAt(LocalDateTime.now());
        round.setWinningTeam(null);
        round.setFinalPremium(null);
        round.setFinalPrice(null);
        auctionRoundRepository.save(round);

        Player player = round.getPlayer();
        player.setStatus(PlayerStatus.UNSOLD);
        playerRepository.save(player);

        AuctionDto.RoundResponse response = toRoundResponse(round);
        broadcast(round.getTournament().getId(), "ROUND_UNSOLD", response);
        return response;
    }

    @Transactional
    public void rollbackAuctionRound(Long roundId) {
        AuctionRound round = auctionRoundRepository.findById(roundId)
                .orElseThrow(() -> new IllegalArgumentException("Auction round not found"));

        if (round.getStatus() == AuctionRoundStatus.ACTIVE) {
            throw new IllegalStateException("진행 중인 경매는 롤백할 수 없습니다.");
        }

        Player player = round.getPlayer();

        if (round.getStatus() == AuctionRoundStatus.SOLD) {
            Team winningTeam = round.getWinningTeam();
            if (winningTeam != null) {
                teamMemberRepository.findByTeamId(winningTeam.getId()).stream()
                        .filter(m -> m.getPlayer().getId().equals(player.getId()))
                        .findFirst()
                        .ifPresent(member -> {
                            winningTeam.setRemainingPoints(winningTeam.getRemainingPoints() + member.getPurchasePrice());
                            winningTeam.getMembers().remove(member);
                            teamMemberRepository.delete(member);
                        });
                teamRepository.save(winningTeam);
            }
        }

        player.setStatus(round.isReAuction() ? PlayerStatus.UNSOLD : PlayerStatus.AVAILABLE);
        player.setTeam(null);
        player.setAssignedPosition(null);
        player.setSoldPrice(null);
        playerRepository.save(player);

        Long tournamentId = round.getTournament().getId();
        bidRepository.deleteAll(bidRepository.findByAuctionRoundIdOrderByBidTimeDesc(roundId));
        auctionRoundRepository.delete(round);

        broadcast(tournamentId, "ROUND_SOLD", null); // 클라이언트 전체 리프레시
    }

    @Transactional
    public void rollbackLastBid(Long roundId) {
        AuctionRound round = auctionRoundRepository.findById(roundId)
                .orElseThrow(() -> new IllegalArgumentException("Auction round not found"));

        if (round.getStatus() != AuctionRoundStatus.ACTIVE) {
            throw new IllegalStateException("진행 중인 경매에서만 입찰을 취소할 수 있습니다.");
        }

        List<Bid> bids = bidRepository.findByAuctionRoundIdOrderByBidTimeDesc(roundId);
        if (bids.isEmpty()) throw new IllegalStateException("취소할 입찰 내역이 없습니다.");

        Bid lastBid = bids.get(0);
        round.getBids().remove(lastBid);
        bidRepository.delete(lastBid);

        broadcast(round.getTournament().getId(), "BID_ROLLBACK", null);
    }

    @Transactional(readOnly = true)
    public List<AuctionDto.BidResponse> getBidHistory(Long roundId) {
        return bidRepository.findByAuctionRoundIdOrderByBidTimeDesc(roundId).stream()
                .map(bid -> AuctionDto.BidResponse.builder()
                        .bidId(bid.getId())
                        .teamId(bid.getTeam().getId())
                        .teamName(bid.getTeam().getName())
                        .amount(bid.getBidAmount())
                        .timestamp(bid.getBidTime().toString())
                        .build())
                .collect(Collectors.toList());
    }

    /** 진행 중인 라운드. 라인 선언 대기 중인 라운드도 포함한다. */
    @Transactional(readOnly = true)
    public AuctionDto.RoundResponse getActiveRound(Long tournamentId) {
        List<AuctionRound> rounds = auctionRoundRepository.findByTournamentIdAndStatusIn(
                tournamentId, List.of(AuctionRoundStatus.ACTIVE, AuctionRoundStatus.PENDING_ASSIGN));
        return rounds.stream().findFirst().map(this::toRoundResponse).orElse(null);
    }

    @Transactional(readOnly = true)
    public List<AuctionDto.RoundResponse> getAuctionHistory(Long tournamentId) {
        return auctionRoundRepository.findByTournamentIdOrderByRoundNumberAsc(tournamentId).stream()
                .filter(r -> r.getStatus() == AuctionRoundStatus.SOLD || r.getStatus() == AuctionRoundStatus.UNSOLD)
                .map(this::toRoundResponse)
                .collect(Collectors.toList());
    }

    /** 관리자 강제 배정. 라인을 지정하면 그 라인 기준가 + 프리미엄으로 차감한다. */
    @Transactional
    public AuctionDto.RoundResponse manualAssignPlayer(Long tournamentId, AuctionDto.ManualAssignRequest request) {
        Tournament tournament = tournamentRepository.findById(tournamentId)
                .orElseThrow(() -> new IllegalArgumentException("Tournament not found"));

        Player player = playerRepository.findById(request.getPlayerId())
                .orElseThrow(() -> new IllegalArgumentException("Player not found"));

        if (player.getStatus() != PlayerStatus.AVAILABLE && player.getStatus() != PlayerStatus.UNSOLD) {
            throw new IllegalStateException("이 선수는 수동 배정할 수 없는 상태입니다: " + player.getStatus());
        }

        Team team = teamRepository.findById(request.getTeamId())
                .orElseThrow(() -> new IllegalArgumentException("Team not found"));
        if (!team.getTournament().getId().equals(tournamentId)) {
            throw new IllegalArgumentException("해당 팀은 이 대회 소속이 아닙니다.");
        }

        String line = ExcelRosterParser.mapPosition(request.getPosition());
        if (line.isEmpty()) line = player.getMainPosition();
        if (line == null || line.isEmpty() || !team.isLineOpen(line)) {
            List<String> open = team.getOpenLines();
            if (open.isEmpty()) throw new IllegalArgumentException("팀에 빈 라인이 없습니다.");
            if (line == null || line.isEmpty()) line = open.get(0);
            else throw new IllegalArgumentException("이미 채워진 라인입니다: " + line);
        }

        int premium = request.getPremium() != null ? request.getPremium() : 0;
        int basePrice = player.getScoreFor(line);
        int price = request.getAmount() != null ? request.getAmount() : Math.max(0, basePrice + premium);

        if (team.getRemainingPoints() < price) {
            throw new IllegalArgumentException("포인트가 부족합니다. 잔여: " + team.getRemainingPoints());
        }

        AuctionRound round = AuctionRound.builder()
                .tournament(tournament)
                .player(player)
                .roundNumber(auctionRoundRepository.countByTournamentId(tournamentId) + 1)
                .startingPrice(0)
                .premiumFloor(0)
                .premiumCap(tournament.getPremiumCap())
                .isReAuction(false)
                .status(AuctionRoundStatus.SOLD)
                .finalPremium(premium)
                .finalPrice(price)
                .assignedPosition(line)
                .winningTeam(team)
                .startedAt(LocalDateTime.now())
                .endedAt(LocalDateTime.now())
                .build();
        round = auctionRoundRepository.save(round);

        player.setStatus(PlayerStatus.SOLD);
        player.setTeam(team);
        player.setAssignedPosition(line);
        player.setSoldPrice(price);
        playerRepository.save(player);

        team.setRemainingPoints(team.getRemainingPoints() - price);

        TeamMember member = TeamMember.builder()
                .team(team)
                .player(player)
                .assignedPosition(line)
                .basePrice(basePrice)
                .premium(premium)
                .purchasePrice(price)
                .build();
        teamMemberRepository.save(member);
        team.getMembers().add(member);
        teamRepository.save(team);

        AuctionDto.RoundResponse response = toRoundResponse(round);
        broadcast(tournamentId, "ROUND_SOLD", response);
        return response;
    }

    // ==================== Broadcasting ====================

    /** 입찰이 거절됐을 때 해당 팀에게 사유를 알린다. (WS 입찰은 응답 채널이 없어 브로드캐스트로 전달) */
    @Transactional(readOnly = true)
    public void broadcastBidRejected(Long roundId, Long teamId, String reason) {
        auctionRoundRepository.findById(roundId).ifPresent(round ->
                broadcast(round.getTournament().getId(), "BID_REJECTED",
                        Map.of("teamId", teamId == null ? -1L : teamId, "reason", reason == null ? "입찰이 거절되었습니다." : reason)));
    }

    private void broadcast(Long tournamentId, String type, Object data) {
        AuctionDto.WsMessage message = AuctionDto.WsMessage.builder()
                .type(type)
                .data(data)
                .build();
        messagingTemplate.convertAndSend("/topic/auction/" + tournamentId, message);
    }

    // ==================== Chat ====================

    public void handleChatMessage(ChatDto.MessageRequest request) {
        String senderName = "관리자";
        if (request.getTeamId() != null) {
            Team team = teamRepository.findById(request.getTeamId()).orElse(null);
            if (team != null) {
                senderName = team.getName() + " (" + team.getCaptainName() + ")";
            }
        }

        ChatDto.MessageResponse response = ChatDto.MessageResponse.builder()
                .tournamentId(request.getTournamentId())
                .teamId(request.getTeamId())
                .senderName(senderName)
                .message(request.getMessage())
                .timestamp(LocalDateTime.now())
                .build();

        broadcast(request.getTournamentId(), "CHAT", response);
    }

    // ==================== Mappers ====================

    private TournamentDto.Response toTournamentResponse(Tournament t) {
        List<TeamDto.Response> teamResponses = t.getTeams() != null
                ? t.getTeams().stream().map(this::toTeamResponse).collect(Collectors.toList())
                : List.of();

        return TournamentDto.Response.builder()
                .id(t.getId())
                .name(t.getName())
                .totalPoints(t.getTotalPoints())
                .bidUnit(t.getBidUnit())
                .maxTeamSize(t.getMaxTeamSize())
                .premiumCap(t.getPremiumCap())
                .status(t.getStatus().name())
                .hasAccessCode(t.getAccessCode() != null && !t.getAccessCode().isBlank())
                .teams(teamResponses)
                .build();
    }

    private TeamDto.Response toTeamResponse(Team t) {
        List<TeamDto.TeamMemberDto> memberDtos = t.getMembers() != null
                ? t.getMembers().stream().map(m -> TeamDto.TeamMemberDto.builder()
                        .playerId(m.getPlayer().getId())
                        .name(m.getPlayer().getName())
                        .summonerName(m.getPlayer().getSummonerName())
                        .assignedPosition(m.getAssignedPosition())
                        .basePrice(m.getBasePrice())
                        .premium(m.getPremium())
                        .purchasePrice(m.getPurchasePrice())
                        .tier(m.getPlayer().getTier())
                        .build())
                .collect(Collectors.toList())
                : List.of();

        return TeamDto.Response.builder()
                .id(t.getId())
                .name(t.getName())
                .captainName(t.getCaptainName())
                .captainPosition(t.getCaptainPosition())
                .captainScore(t.getCaptainScore())
                .remainingPoints(t.getRemainingPoints())
                .filledSlots(t.getFilledSlots())
                .remainingSlots(t.getRemainingSlots())
                .openLines(t.getOpenLines())
                .members(memberDtos)
                .build();
    }

    private Map<String, Integer> lineScoreMap(Player p) {
        Map<String, Integer> scores = new LinkedHashMap<>();
        for (String line : LINES) scores.put(line, p.getScoreFor(line));
        return scores;
    }

    private PlayerDto.Response toPlayerResponse(Player p) {
        return PlayerDto.Response.builder()
                .id(p.getId())
                .name(p.getName())
                .summonerName(p.getSummonerName())
                .tier(p.getTier())
                .rankDivision(p.getRankDivision())
                .lp(p.getLp())
                .mainPosition(p.getMainPosition())
                .subPosition(p.getSubPosition())
                .mostChampions(p.getMostChampions())
                .isNewMember(p.getIsNewMember())
                .isCaptain(p.getIsCaptain())
                .status(p.getStatus().name())
                .teamId(p.getTeam() != null ? p.getTeam().getId() : null)
                .teamName(p.getTeam() != null ? p.getTeam().getName() : null)
                .soldPrice(p.getSoldPrice())
                .assignedPosition(p.getAssignedPosition())
                .profileIconUrl(p.getProfileIconUrl())
                .resolution(p.getResolution())
                .startingScore(p.getStartingScore())
                .lineScores(lineScoreMap(p))
                .mainScore(p.getMainPosition() != null && !p.getMainPosition().isBlank() ? p.getScoreFor(p.getMainPosition()) : null)
                .subScore(p.getSubPosition() != null && !p.getSubPosition().isBlank() ? p.getScoreFor(p.getSubPosition()) : null)
                .build();
    }

    private AuctionDto.RoundResponse toRoundResponse(AuctionRound r) {
        Player p = r.getPlayer();
        int premium = r.getStatus() == AuctionRoundStatus.ACTIVE
                ? r.getCurrentPremium()
                : (r.getFinalPremium() != null ? r.getFinalPremium() : r.getCurrentPremium());

        Bid highestBid = r.getBids() != null
                ? r.getBids().stream().reduce((a, b) -> a.getBidAmount() >= b.getBidAmount() ? a : b).orElse(null)
                : null;

        // 프리미엄가가 올라갈 때마다 갱신되는 라인별 표시 가격 (기준 점수 + 프리미엄가)
        Map<String, Integer> linePrices = new LinkedHashMap<>();
        for (String line : LINES) linePrices.put(line, finalPrice(p, line, premium));

        List<String> assignableLines = r.getStatus() == AuctionRoundStatus.PENDING_ASSIGN && r.getWinningTeam() != null
                ? r.getWinningTeam().getOpenLines()
                : List.of();

        return AuctionDto.RoundResponse.builder()
                .roundId(r.getId())
                .roundNumber(r.getRoundNumber())
                .player(toPlayerResponse(p))
                .currentPremium(premium)
                .premiumFloor(r.getPremiumFloor())
                .premiumCap(r.getPremiumCap())
                .linePrices(linePrices)
                .mainLinePrice(p.getMainPosition() != null && !p.getMainPosition().isBlank()
                        ? finalPrice(p, p.getMainPosition(), premium) : null)
                .subLinePrice(p.getSubPosition() != null && !p.getSubPosition().isBlank()
                        ? finalPrice(p, p.getSubPosition(), premium) : null)
                .highestBidderTeam(highestBid != null ? highestBid.getTeam().getName() : null)
                .highestBidderTeamId(highestBid != null ? highestBid.getTeam().getId() : null)
                .winningTeamId(r.getWinningTeam() != null ? r.getWinningTeam().getId() : null)
                .winningTeamName(r.getWinningTeam() != null ? r.getWinningTeam().getName() : null)
                .finalPremium(r.getFinalPremium())
                .finalPrice(r.getFinalPrice())
                .assignedPosition(r.getAssignedPosition())
                .assignableLines(assignableLines)
                .status(r.getStatus().name())
                .reAuction(r.isReAuction())
                .build();
    }
}
