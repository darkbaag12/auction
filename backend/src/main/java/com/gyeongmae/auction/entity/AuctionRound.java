package com.gyeongmae.auction.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "auction_round")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuctionRound {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournament tournament;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "player_id", nullable = false)
    private Player player;

    @Column(nullable = false)
    private int roundNumber;

    /**
     * 레거시 컬럼. 프리미엄 경매에서는 항상 0이며, 시작 프리미엄가를 의미한다.
     * (기존 DB 스키마의 NOT NULL 제약 때문에 유지)
     */
    @Column(nullable = false)
    @Builder.Default
    private int startingPrice = 0;

    /**
     * 프리미엄가 하한. 신규 매물은 0.
     * 유찰 재경매는 룰북 4-3에 따라 '최종가를 0으로 만드는 최댓값'(= -min(주/부 기준가))을 쓴다.
     */
    @Column(nullable = false)
    @Builder.Default
    private int premiumFloor = 0;

    /** 이 라운드에서 올릴 수 있는 프리미엄가 상한. */
    @Column(nullable = false)
    @Builder.Default
    private int premiumCap = 20;

    /** 낙찰 확정된 프리미엄가. */
    private Integer finalPremium;

    /** 실제 차감액 (배정 라인 기준 점수 + finalPremium). 라인 배정 시점에 정해진다. */
    private Integer finalPrice;

    /** 라인 배정 결과. */
    private String assignedPosition;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "winning_team_id")
    private Team winningTeam;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private AuctionRoundStatus status = AuctionRoundStatus.WAITING;

    private LocalDateTime startedAt;

    private LocalDateTime endedAt;

    @Column(name = "is_re_auction", nullable = false, columnDefinition = "boolean default false")
    @Builder.Default
    private boolean isReAuction = false;

    @OneToMany(mappedBy = "auctionRound", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<Bid> bids = new ArrayList<>();

    /** 현재 최고 프리미엄가. 입찰이 없으면 하한값. */
    public int getCurrentPremium() {
        return bids.stream()
                .mapToInt(Bid::getBidAmount)
                .max()
                .orElse(premiumFloor);
    }

    public enum AuctionRoundStatus {
        /** 대기 */
        WAITING,
        /** 입찰 진행 중 */
        ACTIVE,
        /** 낙찰 확정, 팀장의 라인 선택 대기 중 */
        PENDING_ASSIGN,
        /** 라인 배정까지 완료 */
        SOLD,
        /** 유찰 */
        UNSOLD
    }
}
