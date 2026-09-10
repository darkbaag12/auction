package com.gyeongmae.auction.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "tournament")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Tournament {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    private String accessCode; // 참여 코드 (없으면 제한없음)

    @Column(nullable = false)
    @Builder.Default
    private int totalPoints = 290; // 룰북 4-3: 팀장 본인 점수 포함 총 290점

    @Column(nullable = false)
    @Builder.Default
    private int bidUnit = 5;

    @Column(nullable = false)
    @Builder.Default
    private int maxTeamSize = 5;

    /** 팀장이 올릴 수 있는 프리미엄가 상한. */
    @Column(nullable = false)
    @Builder.Default
    private int premiumCap = 20;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private TournamentStatus status = TournamentStatus.READY;

    @Column(nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @OneToMany(mappedBy = "tournament", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<Team> teams = new ArrayList<>();

    @OneToMany(mappedBy = "tournament", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<Player> players = new ArrayList<>();

    @OneToMany(mappedBy = "tournament", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<AuctionRound> auctionRounds = new ArrayList<>();

    public enum TournamentStatus {
        READY, IN_PROGRESS, FINISHED
    }
}
