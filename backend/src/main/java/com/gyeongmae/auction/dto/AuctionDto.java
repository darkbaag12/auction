package com.gyeongmae.auction.dto;

import lombok.*;
import java.util.List;
import java.util.Map;

public class AuctionDto {

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class StartRequest {
        private Long playerId;
        /** 이 라운드의 프리미엄가 상한 (미지정 시 대회 기본값) */
        private Integer premiumCap;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class CloseRequest {
        private Long roundId;
        private Long winningTeamId;
    }

    /** 팀장이 프리미엄가를 올린다. amount = 프리미엄가 (기준 점수 미포함) */
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class BidRequest {
        private Long roundId;
        private Long teamId;
        private int amount;
    }

    /** 낙찰 후 팀장이 자기 팀의 라인을 고른다. */
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class AssignRequest {
        private Long roundId;
        private Long teamId;
        private String position; // TOP / JUNGLE / MID / ADC / SUPPORT
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class RoundResponse {
        private Long roundId;
        private int roundNumber;
        private PlayerDto.Response player;
        /** 현재 최고 프리미엄가 */
        private int currentPremium;
        /** 프리미엄가 하한 (유찰 재경매는 음수) */
        private int premiumFloor;
        /** 프리미엄가 상한 */
        private int premiumCap;
        /** 현재 프리미엄가 기준, 라인별 표시 가격 (기준 점수 + 프리미엄가) */
        private Map<String, Integer> linePrices;
        /** 주 라인 표시 가격 */
        private Integer mainLinePrice;
        /** 부 라인 표시 가격 */
        private Integer subLinePrice;
        private String highestBidderTeam;
        private Long highestBidderTeamId;
        /** 낙찰 확정된 팀 (PENDING_ASSIGN / SOLD 일 때) */
        private Long winningTeamId;
        private String winningTeamName;
        private Integer finalPremium;
        private Integer finalPrice;
        private String assignedPosition;
        /** 낙찰팀이 고를 수 있는 라인들 */
        private List<String> assignableLines;
        private String status;
        private boolean reAuction;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class BidResponse {
        private Long bidId;
        private Long teamId;
        private String teamName;
        /** 프리미엄가 */
        private int amount;
        private String timestamp;
        private java.util.Map<Long, Integer> teamsPoints;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class WsMessage {
        private String type;
        private Object data;
    }

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class ManualAssignRequest {
        private Long playerId;
        private Long teamId;
        private String position;
        /** 프리미엄가 (미지정 시 0). 실제 차감액 = 라인 기준 점수 + premium */
        private Integer premium;
        /** 지정 시 라인 점수/프리미엄 계산을 무시하고 이 금액을 차감 */
        private Integer amount;
    }
}
