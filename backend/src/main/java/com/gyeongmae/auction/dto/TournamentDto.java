package com.gyeongmae.auction.dto;

import lombok.*;
import java.util.List;

public class TournamentDto {

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class CreateRequest {
        private String name;
        private int totalPoints;
        private int bidUnit;
        private int maxTeamSize;
        private Integer premiumCap; // 프리미엄가 상한 (기본 20)
        private String accessCode; // 선택적 참여 코드
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class Response {
        private Long id;
        private String name;
        private int totalPoints;
        private int bidUnit;
        private int maxTeamSize;
        private int premiumCap;
        private String status;
        private boolean hasAccessCode; // 코드 세팅 여부 (frontend에서 UI 반영)
        private List<TeamDto.Response> teams;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class VerifyRequest {
        private String code;
    }
}
