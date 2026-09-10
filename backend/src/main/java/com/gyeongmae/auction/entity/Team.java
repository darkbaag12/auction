package com.gyeongmae.auction.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "team")
@Getter @Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Team {

    /** 팀이 채워야 하는 5개 라인. */
    public static final List<String> LINES = List.of("TOP", "JUNGLE", "MID", "ADC", "SUPPORT");

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournament tournament;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String captainName;

    /** 팀장 본인이 맡는 라인. 나머지 4라인을 경매로 채운다. */
    private String captainPosition;

    /** 팀장 본인 점수. 룰북 4-3에 따라 팀 예산 290점에 포함된다. */
    @Column(nullable = false)
    @Builder.Default
    private int captainScore = 0;

    @Column(nullable = false)
    private int remainingPoints;

    @Column(nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @OneToMany(mappedBy = "team", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<TeamMember> members = new ArrayList<>();

    public int getFilledSlots() {
        return members.size();
    }

    /**
     * 팀장 라인과 이미 영입한 선수 라인을 제외한, 아직 비어있는 라인.
     * 룰북 4-3: 낙찰팀은 라인을 선언해야 하고, 이후 같은 라인 매물에는 재입찰할 수 없다.
     */
    public List<String> getOpenLines() {
        List<String> open = new ArrayList<>(LINES);
        if (captainPosition != null && !captainPosition.isBlank()) {
            open.remove(captainPosition.toUpperCase());
        }
        for (TeamMember m : members) {
            if (m.getAssignedPosition() != null) {
                open.remove(m.getAssignedPosition().toUpperCase());
            }
        }
        return open;
    }

    /** 남은 슬롯 = 비어있는 라인 수. */
    public int getRemainingSlots() {
        return getOpenLines().size();
    }

    public boolean isLineOpen(String position) {
        return position != null && getOpenLines().contains(position.toUpperCase());
    }
}
