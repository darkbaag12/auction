package com.gyeongmae.auction.repository;

import com.gyeongmae.auction.entity.Team;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TeamRepository extends JpaRepository<Team, Long> {
    List<Team> findByTournamentId(Long tournamentId);

    /** 화면에 보여줄 순서. 낙찰로 포인트가 바뀌어도 순서가 흔들리지 않게 항상 id 순으로 읽는다. */
    List<Team> findByTournamentIdOrderByIdAsc(Long tournamentId);
}
