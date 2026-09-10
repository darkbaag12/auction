package com.gyeongmae.auction.dto;

import lombok.*;
import java.util.List;

public class TeamDto {

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class CreateRequest {
        private String name;
        private String captainName;
        private String captainPosition; // 팀장이 차지하는 라인 (optional)
        private Integer startingPoints; // 팀 개별 포인트 (optional)
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class UpdateRequest {
        private String name;
        private String captainName;
        private String captainPosition;
        private Integer remainingPoints;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class Response {
        private Long id;
        private String name;
        private String captainName;
        private String captainPosition;
        /** 팀장 본인 점수 (예산 290점에 포함) */
        private int captainScore;
        private int remainingPoints;
        private int filledSlots;
        private int remainingSlots;
        /** 아직 비어있는 라인 (팀장 라인 제외) */
        private List<String> openLines;
        private List<TeamMemberDto> members;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class TeamMemberDto {
        private Long playerId;
        private String name;
        private String summonerName;
        private String assignedPosition;
        private int basePrice;
        private int premium;
        private int purchasePrice;
        private String tier;
    }
}
