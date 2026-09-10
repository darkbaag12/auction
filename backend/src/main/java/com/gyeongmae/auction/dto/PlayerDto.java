package com.gyeongmae.auction.dto;

import lombok.*;
import java.util.Map;

public class PlayerDto {

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class CreateRequest {
        private String name;
        private String summonerName;
        private String tier;
        private String rankDivision;
        private int lp;
        private String mainPosition;
        private String subPosition;
        private String mostChampions;
        private Boolean isNewMember;
        private String profileIconUrl;
        private String resolution;
        private Integer startingScore;
        /** 라인별 기준 점수. key: TOP/JUNGLE/MID/ADC/SUPPORT */
        private Map<String, Integer> lineScores;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class Response {
        private Long id;
        private String name;
        private String summonerName;
        private String tier;
        private String rankDivision;
        private int lp;
        private String mainPosition;
        private String subPosition;
        private String mostChampions;
        private Boolean isNewMember;
        private Boolean isCaptain;
        private String status;
        private Long teamId;
        private String teamName;
        private Integer soldPrice;
        private String assignedPosition;
        private String profileIconUrl;
        private String resolution;
        private Integer startingScore;
        /** 라인별 기준 점수. key: TOP/JUNGLE/MID/ADC/SUPPORT */
        private Map<String, Integer> lineScores;
        /** 주 라인 기준 점수 */
        private Integer mainScore;
        /** 부 라인 기준 점수 */
        private Integer subScore;
    }
}
