package com.gyeongmae.auction.repository;

import com.gyeongmae.auction.entity.AuctionRound;
import com.gyeongmae.auction.entity.AuctionRound.AuctionRoundStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface AuctionRoundRepository extends JpaRepository<AuctionRound, Long> {
    List<AuctionRound> findByTournamentIdOrderByRoundNumberAsc(Long tournamentId);
    Optional<AuctionRound> findByTournamentIdAndStatus(Long tournamentId, AuctionRoundStatus status);
    List<AuctionRound> findByTournamentIdAndStatusIn(Long tournamentId, List<AuctionRoundStatus> statuses);
    int countByTournamentId(Long tournamentId);

    /** 이 선수가 지금까지 유찰된 횟수. 재경매 할인 적용 시점을 판단하는 데 쓴다. */
    int countByPlayerIdAndStatus(Long playerId, AuctionRoundStatus status);
    List<AuctionRound> findByWinningTeamId(Long teamId);
}
