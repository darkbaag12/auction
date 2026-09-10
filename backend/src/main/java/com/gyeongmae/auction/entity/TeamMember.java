package com.gyeongmae.auction.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "team_member")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TeamMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id", nullable = false)
    private Team team;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "player_id", nullable = false)
    private Player player;

    /** 실제로 배정된 라인. 차감 점수는 이 라인의 기준 점수를 사용한다. */
    private String assignedPosition;

    /** 배정 라인의 기준 점수. */
    @Column(nullable = false)
    @Builder.Default
    private int basePrice = 0;

    /** 경매에서 올라간 프리미엄가. */
    @Column(nullable = false)
    @Builder.Default
    private int premium = 0;

    /** basePrice + premium. 팀 포인트에서 실제로 차감된 값. */
    @Column(nullable = false)
    private int purchasePrice;

    @Column(nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime joinedAt = LocalDateTime.now();
}
