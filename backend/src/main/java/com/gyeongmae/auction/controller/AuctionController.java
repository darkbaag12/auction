package com.gyeongmae.auction.controller;

import com.gyeongmae.auction.dto.*;
import com.gyeongmae.auction.service.AuctionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class AuctionController {

    private final AuctionService auctionService;

    // ==================== Tournament ====================

    @PostMapping("/tournaments")
    public ResponseEntity<TournamentDto.Response> createTournament(@RequestBody TournamentDto.CreateRequest request) {
        return ResponseEntity.ok(auctionService.createTournament(request));
    }

    @GetMapping("/tournaments")
    public ResponseEntity<List<TournamentDto.Response>> getTournaments() {
        return ResponseEntity.ok(auctionService.getTournaments());
    }

    @GetMapping("/tournaments/{id}")
    public ResponseEntity<TournamentDto.Response> getTournament(@PathVariable Long id) {
        return ResponseEntity.ok(auctionService.getTournament(id));
    }

    @GetMapping("/tournaments/latest")
    public ResponseEntity<TournamentDto.Response> getLatestTournament() {
        TournamentDto.Response response = auctionService.getLatestTournament();
        return response != null ? ResponseEntity.ok(response) : ResponseEntity.noContent().build();
    }

    @PostMapping("/tournaments/{id}/verify-code")
    public ResponseEntity<Void> verifyAccessCode(
            @PathVariable Long id,
            @RequestBody TournamentDto.VerifyRequest request) {
        boolean valid = auctionService.verifyAccessCode(id, request.getCode());
        return valid ? ResponseEntity.ok().build() : ResponseEntity.status(403).build();
    }

    @PutMapping("/tournaments/{id}/access-code")
    public ResponseEntity<Void> setAccessCode(
            @PathVariable Long id,
            @RequestBody TournamentDto.VerifyRequest request) {
        auctionService.setAccessCode(id, request.getCode());
        return ResponseEntity.ok().build();
    }

    @DeleteMapping("/tournaments/{id}")
    public ResponseEntity<Void> deleteTournament(@PathVariable Long id) {
        auctionService.deleteTournament(id);
        return ResponseEntity.ok().build();
    }

    // ==================== Team ====================

    @PostMapping("/tournaments/{tournamentId}/teams")
    public ResponseEntity<TeamDto.Response> createTeam(
            @PathVariable Long tournamentId,
            @RequestBody TeamDto.CreateRequest request) {
        return ResponseEntity.ok(auctionService.createTeam(tournamentId, request));
    }

    @GetMapping("/tournaments/{tournamentId}/teams")
    public ResponseEntity<List<TeamDto.Response>> getTeams(@PathVariable Long tournamentId) {
        return ResponseEntity.ok(auctionService.getTeams(tournamentId));
    }

    @PutMapping("/tournaments/{tournamentId}/teams/{teamId}")
    public ResponseEntity<TeamDto.Response> updateTeam(
            @PathVariable Long tournamentId,
            @PathVariable Long teamId,
            @RequestBody TeamDto.UpdateRequest request) {
        return ResponseEntity.ok(auctionService.updateTeam(tournamentId, teamId, request));
    }

    @DeleteMapping("/tournaments/{tournamentId}/teams/{teamId}")
    public ResponseEntity<Void> deleteTeam(@PathVariable Long tournamentId, @PathVariable Long teamId) {
        auctionService.deleteTeam(tournamentId, teamId);
        return ResponseEntity.noContent().build();
    }

    // ==================== Player ====================

    @PostMapping("/tournaments/{tournamentId}/players")
    public ResponseEntity<PlayerDto.Response> createPlayer(
            @PathVariable Long tournamentId,
            @RequestBody PlayerDto.CreateRequest request) {
        return ResponseEntity.ok(auctionService.createPlayer(tournamentId, request));
    }

    @PostMapping("/tournaments/{tournamentId}/players/import")
    public ResponseEntity<List<PlayerDto.Response>> importPlayersFromExcel(
            @PathVariable Long tournamentId,
            @RequestParam("file") org.springframework.web.multipart.MultipartFile file) {
        return ResponseEntity.ok(auctionService.importPlayersFromExcel(tournamentId, file));
    }

    @PostMapping("/tournaments/{tournamentId}/players/bulk")
    public ResponseEntity<List<PlayerDto.Response>> createPlayersBulk(
            @PathVariable Long tournamentId,
            @RequestBody List<PlayerDto.CreateRequest> requests) {
        return ResponseEntity.ok(auctionService.createPlayersBulk(tournamentId, requests));
    }

    @GetMapping("/tournaments/{tournamentId}/players")
    public ResponseEntity<List<PlayerDto.Response>> getPlayers(@PathVariable Long tournamentId) {
        return ResponseEntity.ok(auctionService.getPlayers(tournamentId));
    }

    @DeleteMapping("/tournaments/{tournamentId}/players")
    public ResponseEntity<Void> deleteAllPlayers(@PathVariable Long tournamentId) {
        auctionService.deleteAllPlayers(tournamentId);
        return ResponseEntity.noContent().build();
    }

    // ==================== Auction ====================

    @PostMapping("/tournaments/{tournamentId}/auction/start")
    public ResponseEntity<AuctionDto.RoundResponse> startAuction(
            @PathVariable Long tournamentId,
            @RequestBody AuctionDto.StartRequest request) {
        return ResponseEntity.ok(auctionService.startAuctionRound(tournamentId, request));
    }

    @PostMapping("/auction/close")
    public ResponseEntity<AuctionDto.RoundResponse> closeAuction(@RequestBody AuctionDto.CloseRequest request) {
        return ResponseEntity.ok(auctionService.closeAuctionRound(request));
    }

    /** 낙찰팀 팀장이 라인을 선언한다 (룰북 4-3). */
    @PostMapping("/auction/assign")
    public ResponseEntity<AuctionDto.RoundResponse> assignLine(@RequestBody AuctionDto.AssignRequest request) {
        return ResponseEntity.ok(auctionService.assignLine(request));
    }

    @PostMapping("/auction/pass")
    public ResponseEntity<AuctionDto.RoundResponse> passAuction(@RequestBody AuctionDto.CloseRequest request) {
        return ResponseEntity.ok(auctionService.passAuctionRound(request.getRoundId()));
    }

    @GetMapping("/auction/{roundId}/bids")
    public ResponseEntity<List<AuctionDto.BidResponse>> getBidHistory(@PathVariable Long roundId) {
        return ResponseEntity.ok(auctionService.getBidHistory(roundId));
    }

    @DeleteMapping("/auction/{roundId}/bids/latest")
    public ResponseEntity<Void> rollbackLastBid(@PathVariable Long roundId) {
        auctionService.rollbackLastBid(roundId);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/tournaments/{tournamentId}/auction/active")
    public ResponseEntity<AuctionDto.RoundResponse> getActiveRound(@PathVariable Long tournamentId) {
        AuctionDto.RoundResponse response = auctionService.getActiveRound(tournamentId);
        return response != null ? ResponseEntity.ok(response) : ResponseEntity.noContent().build();
    }

    @GetMapping("/tournaments/{tournamentId}/auction/history")
    public ResponseEntity<List<AuctionDto.RoundResponse>> getAuctionHistory(@PathVariable Long tournamentId) {
        return ResponseEntity.ok(auctionService.getAuctionHistory(tournamentId));
    }

    @PostMapping("/tournaments/{tournamentId}/players/manual-assign")
    public ResponseEntity<AuctionDto.RoundResponse> manualAssignPlayer(
            @PathVariable Long tournamentId,
            @RequestBody AuctionDto.ManualAssignRequest request) {
        return ResponseEntity.ok(auctionService.manualAssignPlayer(tournamentId, request));
    }

    @DeleteMapping("/auction/{roundId}/rollback")
    public ResponseEntity<Void> rollbackAuctionRound(@PathVariable Long roundId) {
        auctionService.rollbackAuctionRound(roundId);
        return ResponseEntity.ok().build();
    }
}
