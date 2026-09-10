package com.gyeongmae.auction.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "player")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Player {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournament tournament;

    @Column(nullable = false)
    private String summonerName;

    private String name; // 실명(성명)

    private String tier;

    private String rankDivision;

    private int lp;

    private String mainPosition;

    private String subPosition;

    @Column(columnDefinition = "TEXT")
    private String mostChampions;

    @Column(nullable = false)
    @Builder.Default
    private Boolean isNewMember = false; // 신입회원 여부

    @Column(nullable = false)
    @Builder.Default
    private Boolean isCaptain = false; // 팀장 여부 (경매 풀에서 제외)

    private Integer startingScore; // 주 라인 기준 점수 (하위 호환 / 요약 표기용)

    // 라인별 기준 점수 (엑셀 '참가자별 점수표' / '응답 시트'에서 파싱)
    private Integer scoreTop;
    private Integer scoreJungle;
    private Integer scoreMid;
    private Integer scoreAdc;
    private Integer scoreSupport;

    @Column(columnDefinition = "TEXT")
    private String resolution; // 각오 한마디

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private PlayerStatus status = PlayerStatus.AVAILABLE;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id")
    private Team team;

    private Integer soldPrice;

    /** 낙찰 후 팀장이 선언한 라인. 팀장 본인 레코드는 팀장이 맡은 라인. */
    private String assignedPosition;

    private String profileIconUrl;

    @Column(nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    /** 해당 라인의 기준 점수. 값이 없으면 startingScore, 그것도 없으면 0. */
    public int getScoreFor(String position) {
        Integer score = switch (position == null ? "" : position.toUpperCase()) {
            case "TOP" -> scoreTop;
            case "JUNGLE" -> scoreJungle;
            case "MID" -> scoreMid;
            case "ADC" -> scoreAdc;
            case "SUPPORT" -> scoreSupport;
            default -> null;
        };
        if (score != null) return score;
        return startingScore != null ? startingScore : 0;
    }

    public enum PlayerStatus {
        AVAILABLE, AUCTIONING, SOLD, UNSOLD
    }
}
