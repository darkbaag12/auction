export interface Tournament {
  id: number;
  name: string;
  /** 팀 예산. 룰북 4-3 기준 290점 (팀장 본인 점수 포함) */
  totalPoints: number;
  bidUnit: number;
  maxTeamSize: number;
  /** 프리미엄가 상한 (룰북 4-3: +20) */
  premiumCap: number;
  status: string;
  hasAccessCode: boolean;
  teams: TeamResponse[];
}

export interface TeamResponse {
  id: number;
  name: string;
  captainName: string;
  /** 팀장 본인이 맡는 라인 */
  captainPosition: string | null;
  /** 팀장 본인 점수 (예산에 이미 반영됨) */
  captainScore: number;
  remainingPoints: number;
  filledSlots: number;
  remainingSlots: number;
  /** 아직 비어있는 라인 */
  openLines: string[];
  members: TeamMember[];
}

export interface TeamMember {
  playerId: number;
  name: string;
  summonerName: string;
  assignedPosition: string;
  /** 배정 라인의 기준 점수 */
  basePrice: number;
  /** 낙찰된 프리미엄가 */
  premium: number;
  /** basePrice + premium (실제 차감액) */
  purchasePrice: number;
  tier: string;
}

export interface PlayerResponse {
  id: number;
  name: string;
  summonerName: string;
  tier: string;
  rankDivision: string;
  lp: number;
  mainPosition: string;
  subPosition: string;
  mostChampions: string;
  isNewMember: boolean;
  isCaptain: boolean;
  status: string;
  teamId: number | null;
  teamName: string | null;
  soldPrice: number | null;
  assignedPosition: string | null;
  profileIconUrl: string | null;
  resolution?: string;
  /** 주 라인 기준 점수 (요약 표기용) */
  startingScore?: number;
  /** 라인별 기준 점수 */
  lineScores: Record<string, number>;
  mainScore: number | null;
  subScore: number | null;
}

export interface AuctionRound {
  roundId: number;
  roundNumber: number;
  player: PlayerResponse;
  /** 현재 최고 프리미엄가 */
  currentPremium: number;
  /** 프리미엄가 하한 (유찰 재경매는 음수) */
  premiumFloor: number;
  /** 프리미엄가 상한 */
  premiumCap: number;
  /** 라인별 표시 가격 = 기준 점수 + 현재 프리미엄가 */
  linePrices: Record<string, number>;
  mainLinePrice: number | null;
  subLinePrice: number | null;
  highestBidderTeam: string | null;
  highestBidderTeamId: number | null;
  winningTeamId: number | null;
  winningTeamName: string | null;
  finalPremium: number | null;
  finalPrice: number | null;
  assignedPosition: string | null;
  /** 낙찰팀이 선언할 수 있는 라인 */
  assignableLines: string[];
  status: 'WAITING' | 'ACTIVE' | 'PENDING_ASSIGN' | 'SOLD' | 'UNSOLD' | string;
  reAuction: boolean;
}

export interface BidResponse {
  bidId: number;
  teamId: number;
  teamName: string;
  /** 프리미엄가 */
  amount: number;
  timestamp: string;
  teamsPoints?: Record<string, number>;
}

export const LINES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const;

export const POSITION_LABELS: Record<string, string> = {
  TOP: '탑',
  JUNGLE: '정글',
  MID: '미드',
  ADC: '원딜',
  SUPPORT: '서폿',
  DUELIST: '타격대',
  INITIATOR: '척후대',
  CONTROLLER: '전략가',
  SENTINEL: '감시자',
  FLEX: '올라운더',
};

export const TIER_COLORS: Record<string, string> = {
  IRON: '#5e5148',
  BRONZE: '#8c5a3c',
  SILVER: '#8b9bae',
  GOLD: '#c89b3c',
  PLATINUM: '#4e9996',
  EMERALD: '#009e6b',
  DIAMOND: '#576cce',
  ASCENDANT: '#2b846e',
  IMMORTAL: '#b83d5a',
  RADIANT: '#fff9c4',
  MASTER: '#9d48e0',
  GRANDMASTER: '#e04848',
  CHALLENGER: '#f4c874',
  UNRANKED: '#6b7280',
};

export const TIER_LABELS: Record<string, string> = {
  IRON: '아이언',
  BRONZE: '브론즈',
  SILVER: '실버',
  GOLD: '골드',
  PLATINUM: '플래티넘',
  EMERALD: '에메랄드',
  DIAMOND: '다이아몬드',
  ASCENDANT: '초월자',
  IMMORTAL: '불멸',
  RADIANT: '레디언트',
  MASTER: '마스터',
  GRANDMASTER: '그랜드마스터',
  CHALLENGER: '챌린저',
  UNRANKED: '언랭',
};
