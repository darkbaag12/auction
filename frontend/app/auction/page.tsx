'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useWebSocket } from '../../hooks/useWebSocket';
import {
  Tournament,
  TeamResponse,
  PlayerResponse,
  AuctionRound,
  BidResponse,
  LINES,
  POSITION_LABELS,
  TIER_COLORS,
} from '../../lib/types';
import { Suspense } from 'react';

export interface ChatMessage {
  id: string; // generated client-side for keys
  senderName: string;
  message: string;
  isMe: boolean;
  timestamp: string;
}

/** 매물이 신청한 주/부 라인. 둘 다 없으면 5라인 전체를 후보로 본다. */
function declaredLines(player: PlayerResponse): string[] {
  const lines = [player.mainPosition, player.subPosition]
    .filter((l): l is string => !!l && (LINES as readonly string[]).includes(l));
  const unique = Array.from(new Set(lines));
  return unique.length > 0 ? unique : [...LINES];
}

/**
 * 룰북 4-3: 팀장은 매물의 주/부 라인 중 자기 팀에 빈 라인이 하나 이상 있을 때만 입찰할 수 있다.
 * 조건을 만족하는 팀이 하나도 없으면 그 매물에 한해 조건을 적용하지 않는다.
 */
function eligibleLinesByTeam(player: PlayerResponse, teams: TeamResponse[]): Record<number, string[]> {
  const declared = declaredLines(player);
  const strict: Record<number, string[]> = {};
  let anyStrict = false;

  for (const team of teams) {
    const allowed = declared.filter((l) => (team.openLines ?? []).includes(l));
    if (allowed.length > 0) {
      strict[team.id] = allowed;
      anyStrict = true;
    }
  }
  if (anyStrict) return strict;

  const relaxed: Record<number, string[]> = {};
  for (const team of teams) {
    if ((team.openLines ?? []).length > 0) relaxed[team.id] = team.openLines;
  }
  return relaxed;
}

const finalPriceFor = (player: PlayerResponse, line: string, premium: number) =>
  Math.max(0, (player.lineScores?.[line] ?? 0) + premium);

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function AuctionContent() {
  const searchParams = useSearchParams();
  const tournamentId = Number(searchParams.get('tournamentId') || '0');
  const role = searchParams.get('role') as 'HOST' | 'CAPTAIN' | null;
  const myTeamId = Number(searchParams.get('teamId')) || null;

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<TeamResponse[]>([]);
  const [players, setPlayers] = useState<PlayerResponse[]>([]);
  const [activeRound, setActiveRound] = useState<AuctionRound | null>(null);
  const [bidHistory, setBidHistory] = useState<BidResponse[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showAllTeams, setShowAllTeams] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const getFormattedTier = (tier?: string, rankDivision?: string, lp?: number) => {
    if (!tier || tier === 'UNRANKED') return 'UNRANKED';
    if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) {
      return `${tier} ${lp ?? 0}`;
    }
    return `${tier} ${rankDivision ?? ''}`.trim();
  };

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [premium, setPremium] = useState<number | string>(0);
  const [error, setError] = useState('');
  const [showTiebreaker, setShowTiebreaker] = useState(false);
  const [tiedTeams, setTiedTeams] = useState<TeamResponse[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [chatPosition, setChatPosition] = useState({ x: 0, y: 0 });
  const [isDraggingChat, setIsDraggingChat] = useState(false);
  const dragStartRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0 });
  const [poolFilter, setPoolFilter] = useState<'ALL' | 'HIGH' | 'LOW'>('ALL');

  const logEndRef = useRef<HTMLDivElement>(null);
  const isInputFocusedRef = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleChatDragStart = (e: React.MouseEvent) => {
    setIsDraggingChat(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: chatPosition.x,
      initialY: chatPosition.y,
    };
  };

  useEffect(() => {
    const handleDragMove = (e: MouseEvent) => {
      if (!isDraggingChat) return;
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;

      let nextX = dragStartRef.current.initialX + dx;
      let nextY = dragStartRef.current.initialY + dy;

      if (nextX > 400) nextX = 400;
      if (nextX < -(window.innerWidth - 720)) nextX = -(window.innerWidth - 720);
      if (nextY > 24) nextY = 24;
      if (nextY < -(window.innerHeight - 424)) nextY = -(window.innerHeight - 424);

      setChatPosition({ x: nextX, y: nextY });
    };
    const handleDragEnd = () => setIsDraggingChat(false);

    if (isDraggingChat) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
    }
    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };
  }, [isDraggingChat]);

  const [resolvedTournamentId, setResolvedTournamentId] = useState<number | null>(tournamentId || null);
  const { connected, lastMessage, sendBid, sendChatMessage } = useWebSocket(
    resolvedTournamentId || null,
    role,
    myTeamId,
    (errMsg) => {
      alert(errMsg);
      window.location.href = '/';
    },
  );

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !resolvedTournamentId) return;
    sendChatMessage(resolvedTournamentId, myTeamId, chatInput.trim());
    setChatInput('');
  };

  const fetchData = async () => {
    try {
      let tId = resolvedTournamentId;
      if (!tId) {
        const latestTournament = (await api.getLatestTournament()) as Tournament;
        if (latestTournament) {
          tId = latestTournament.id;
          setResolvedTournamentId(tId);
        } else {
          window.location.href = '/';
          return;
        }
      }

      const [t, tm, pl] = await Promise.all([
        api.getTournament(tId) as Promise<Tournament>,
        api.getTeams(tId) as Promise<TeamResponse[]>,
        api.getPlayers(tId) as Promise<PlayerResponse[]>,
      ]);
      setTournament(t);
      setTeams(tm);
      setPlayers(pl);

      const round = (await api.getActiveRound(tId)) as AuctionRound | null;
      setActiveRound(round);
      if (round) {
        const bids = (await api.getBidHistory(round.roundId)) as BidResponse[];
        setBidHistory(bids);
        if (!isInputFocusedRef.current) setPremium(round.currentPremium);
      } else {
        setBidHistory([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    fetchData();
  }, [resolvedTournamentId]);

  useEffect(() => {
    if (!lastMessage) return;
    const { type, data } = lastMessage as { type: string; data: any };

    switch (type) {
      case 'ROUND_START':
        setActiveRound(data);
        setBidHistory([]);
        setPremium(data.premiumFloor ?? 0);
        setError('');
        break;
      case 'ROUND_UPDATE':
        // 프리미엄가가 오를 때마다 라인별 표시 가격을 서버 값으로 갱신
        setActiveRound(data);
        break;
      case 'NEW_BID':
        setBidHistory((prev) => [data, ...prev]);
        setActiveRound((prev) =>
          prev
            ? { ...prev, currentPremium: data.amount, highestBidderTeam: data.teamName, highestBidderTeamId: data.teamId }
            : null,
        );
        if (data.teamsPoints) {
          setTeams((prevTeams) =>
            prevTeams.map((t) => {
              const updatedPoints = data.teamsPoints[String(t.id)];
              return updatedPoints !== undefined ? { ...t, remainingPoints: updatedPoints } : t;
            }),
          );
        }
        break;
      case 'ROUND_PENDING_ASSIGN':
        setActiveRound(data);
        setShowTiebreaker(false);
        break;
      case 'ROUND_SOLD':
      case 'ROUND_UNSOLD':
        setActiveRound(null);
        setBidHistory([]);
        fetchData();
        break;
      case 'BID_REJECTED': {
        // 내 팀(호스트는 선택한 팀)의 입찰이 거절된 경우에만 표시
        const rejectedTeamId = Number(data?.teamId);
        const mine = role === 'CAPTAIN' ? myTeamId : selectedTeamId;
        if (mine != null && rejectedTeamId === mine) {
          setError(`입찰 거절: ${data?.reason ?? '알 수 없는 이유'}`);
        }
        break;
      }
      case 'TEAMS_UPDATED':
      case 'BID_ROLLBACK':
        fetchData();
        break;
      case 'CHAT':
        setChatMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString() + Math.random().toString(),
            senderName: data.senderName,
            message: data.message,
            isMe: data.teamId === myTeamId,
            timestamp: data.timestamp,
          },
        ]);
        break;
    }
  }, [lastMessage, myTeamId, role, selectedTeamId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bidHistory, activeRound]);

  // ==================== 파생 값 ====================

  const isPendingAssign = activeRound?.status === 'PENDING_ASSIGN';
  const targetTeamId = role === 'CAPTAIN' ? myTeamId : selectedTeamId;
  const targetTeam = teams.find((t) => t.id === targetTeamId) ?? null;

  const eligibility = activeRound ? eligibleLinesByTeam(activeRound.player, teams) : {};
  const myEligibleLines = targetTeamId ? eligibility[targetTeamId] ?? [] : [];

  /**
   * 아직 그 라인이 빈 팀은 있는데, 그 라인을 주/부로 신청한 매물이 다 팔린 라인.
   * (예: 주포지션 원딜인 인원이 전부 낙찰되면 남은 원딜 자리는 다른 라인 선수로 채워야 한다)
   */
  const squeezedLines = LINES.filter((line) => {
    const hasOpenSlot = teams.some((t) => (t.openLines ?? []).includes(line));
    const hasSupply = players.some(
      (p) =>
        !p.isCaptain &&
        (p.status === 'AVAILABLE' || p.status === 'UNSOLD') &&
        (p.mainPosition === line || p.subPosition === line),
    );
    return hasOpenSlot && !hasSupply;
  });

  const premiumValue = typeof premium === 'string' ? (premium === '-' || premium === '' ? 0 : Number(premium)) : premium;

  /** 이 팀이 이 프리미엄가로 살 수 있는 가장 싼 최종가 */
  const cheapestFinalPrice =
    activeRound && myEligibleLines.length > 0
      ? Math.min(...myEligibleLines.map((l) => finalPriceFor(activeRound.player, l, premiumValue)))
      : null;

  const clampPremium = (value: number) => {
    if (!activeRound) return value;
    let next = Math.max(activeRound.premiumFloor, Math.min(activeRound.premiumCap, value));

    // 잔여 포인트로 감당 못하는 프리미엄가는 올리지 못하게 막는다
    if (targetTeam && myEligibleLines.length > 0) {
      const cheapestBase = Math.min(...myEligibleLines.map((l) => activeRound.player.lineScores?.[l] ?? 0));
      const affordable = targetTeam.remainingPoints - cheapestBase;
      if (next > affordable) next = Math.max(activeRound.premiumFloor, affordable);
    }
    return next;
  };

  const updatePremium = (valueOrUpdater: number | ((prev: number) => number)) => {
    setPremium((prev) => {
      const current = typeof prev === 'string' ? (prev === '-' || prev === '' ? 0 : Number(prev)) : prev;
      const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(current) : valueOrUpdater;
      return clampPremium(next);
    });
  };

  // ==================== 액션 ====================

  const handleStartAuction = async () => {
    if (!selectedPlayerId) return;
    setError('');
    try {
      await api.startAuction(resolvedTournamentId!, { playerId: selectedPlayerId });
      setSelectedPlayerId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePlaceBid = () => {
    if (!activeRound || !targetTeamId) return;
    sendBid(activeRound.roundId, targetTeamId, premiumValue);
  };

  const handleClose = async (explicitWinningTeamId?: number) => {
    if (!activeRound) return;

    // 룰북 4-3: 상한(+20) 동률이 2팀 이상이면 낙찰될 팀을 고른다
    if (!explicitWinningTeamId && activeRound.currentPremium === activeRound.premiumCap) {
      const serverBids = (await api.getBidHistory(activeRound.roundId)) as BidResponse[];
      const topBids = serverBids.filter((b) => b.amount === activeRound.premiumCap);
      const uniqueTopTeamIds = Array.from(new Set(topBids.map((b) => b.teamId)));

      if (uniqueTopTeamIds.length > 1) {
        setTiedTeams(uniqueTopTeamIds.map((id) => teams.find((t) => t.id === id)).filter(Boolean) as TeamResponse[]);
        setShowTiebreaker(true);
        return;
      }
    }

    try {
      setShowTiebreaker(false);
      await api.closeAuction(activeRound.roundId, explicitWinningTeamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAssignLine = async (line: string) => {
    if (!activeRound || !activeRound.winningTeamId) return;
    const price = finalPriceFor(activeRound.player, line, activeRound.finalPremium ?? 0);
    if (!window.confirm(`${POSITION_LABELS[line]} 라인으로 기용합니다.\n차감 포인트: ${price}P`)) return;
    try {
      await api.assignLine(activeRound.roundId, activeRound.winningTeamId, line);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePass = async () => {
    if (!activeRound) return;
    try {
      await api.passAuction(activeRound.roundId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRollbackLastBid = async () => {
    if (!activeRound || bidHistory.length === 0) return;
    if (!window.confirm('가장 최근 입찰을 취소하시겠습니까?')) return;
    try {
      await api.rollbackLastBid(activeRound.roundId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!resolvedTournamentId) {
    return <div style={{ height: '100vh', background: 'var(--bg-primary)' }}></div>;
  }

  const matchesSearch = (p: PlayerResponse) =>
    searchTerm === '' || p.name.includes(searchTerm) || p.summonerName.includes(searchTerm);

  const freshPlayers = players.filter((p) => p.status === 'AVAILABLE' && !p.isCaptain && matchesSearch(p));
  const unsoldPlayers = players.filter((p) => p.status === 'UNSOLD' && !p.isCaptain && matchesSearch(p));

  const HIGH_TIERS = ['DIAMOND', 'ASCENDANT', 'IMMORTAL', 'RADIANT', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const isHighTier = (tier: string) => HIGH_TIERS.includes(tier);

  const filteredFreshPlayers = freshPlayers.filter(
    (p) => poolFilter === 'ALL' || (poolFilter === 'HIGH' ? isHighTier(p.tier) : !isHighTier(p.tier)),
  );
  const filteredUnsoldPlayers = unsoldPlayers.filter(
    (p) => poolFilter === 'ALL' || (poolFilter === 'HIGH' ? isHighTier(p.tier) : !isHighTier(p.tier)),
  );
  const isReAuctionPhase = filteredFreshPlayers.length === 0 && filteredUnsoldPlayers.length > 0;
  const currentPool = isReAuctionPhase ? filteredUnsoldPlayers : filteredFreshPlayers;

  const handleRandomSelect = () => {
    if (currentPool.length === 0) return;
    setSelectedPlayerId(currentPool[Math.floor(Math.random() * currentPool.length)].id);
  };

  /** 팀 로스터를 5라인 슬롯으로 그린다. 팀장 라인은 팀장 본인이 차지한다. */
  const renderRosterSlots = (team: TeamResponse, compact = false) =>
    LINES.map((line) => {
      const member = team.members.find((m) => m.assignedPosition === line);
      const isCaptainLine = team.captainPosition === line;

      if (member) {
        const playerRecord = players.find((p) => p.id === member.playerId);
        const displayName = member.name || playerRecord?.name || member.summonerName;
        return (
          <div key={line} className="roster-list-item" style={compact ? { padding: '8px' } : undefined}>
            <div className="player-pic" style={{ fontSize: '0.7rem', fontWeight: 800 }}>
              {POSITION_LABELS[line]}
            </div>
            <div className="player-info">
              <div className="player-name-row">
                <span className="player-name">{displayName}</span>
                {member.tier && (
                  <span
                    style={{
                      fontSize: '0.65rem',
                      color: TIER_COLORS[member.tier] || 'var(--text-muted)',
                      fontWeight: 800,
                      border: `1px solid ${TIER_COLORS[member.tier]}`,
                      borderRadius: '4px',
                      padding: '2px 6px',
                    }}
                  >
                    {getFormattedTier(member.tier, playerRecord?.rankDivision, playerRecord?.lp)}
                  </span>
                )}
              </div>
              <span className="summoner-name">@{member.summonerName}</span>
            </div>
            <div className="bid-info">
              <span className="bid-label">
                기준 {member.basePrice} {signed(member.premium)}
              </span>
              <span className="bid-price">{member.purchasePrice} pt</span>
            </div>
          </div>
        );
      }

      if (isCaptainLine) {
        return (
          <div key={line} className="roster-list-item" style={{ background: 'rgba(200,155,60,0.08)' }}>
            <div className="player-pic" style={{ fontSize: '0.7rem', fontWeight: 800, borderColor: 'var(--gold)' }}>
              {POSITION_LABELS[line]}
            </div>
            <div className="player-info">
              <div className="player-name-row">
                <span className="player-name">{team.captainName}</span>
                <span
                  style={{
                    fontSize: '0.65rem',
                    color: 'var(--gold)',
                    fontWeight: 800,
                    border: '1px solid var(--gold)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                  }}
                >
                  팀장
                </span>
              </div>
            </div>
            <div className="bid-info">
              <span className="bid-label">팀장 점수</span>
              <span className="bid-price">{team.captainScore} pt</span>
            </div>
          </div>
        );
      }

      return (
        <div key={line} className="roster-list-item" style={{ opacity: 0.45 }}>
          <div className="player-pic" style={{ borderStyle: 'dashed', fontSize: '0.7rem', fontWeight: 800 }}>
            {POSITION_LABELS[line]}
          </div>
          <div className="player-info">
            <div className="player-name-row">
              <span className="player-name" style={{ color: 'var(--text-muted)' }}>
                빈 라인
              </span>
            </div>
          </div>
          <div className="bid-info"></div>
        </div>
      );
    });

  return (
    <div className="auction-layout-wrapper">
      {/* Sidebar: Teams Grid */}
      <div className="auction-sidebar">
        <button
          className="btn btn-outline"
          onClick={() => setShowAllTeams(true)}
          style={{ width: '100%', padding: '12px', marginBottom: '8px', borderStyle: 'dashed', color: 'var(--text-primary)' }}
        >
          👁️ 전체 팀 구성 보기
        </button>
        {teams.map((team) => {
          const canBid = activeRound && (eligibility[team.id]?.length ?? 0) > 0;
          return (
            <div
              key={team.id}
              className="team-card-horizontal"
              style={
                activeRound && !canBid
                  ? { opacity: 0.55 }
                  : team.id === activeRound?.winningTeamId && isPendingAssign
                    ? { boxShadow: '0 0 0 2px var(--gold)' }
                    : undefined
              }
            >
              <div className="team-card-horizontal-header">
                <h3 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {team.name}
                  {team.name !== team.captainName && (
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>({team.captainName})</span>
                  )}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div className="points" style={{ fontSize: '0.95rem' }}>
                    잔여: <span style={{ color: 'var(--gold)', fontWeight: 800 }}>{team.remainingPoints} pt</span>
                  </div>
                </div>
              </div>
              <div className="team-card-roster-list" style={{ marginTop: '12px' }}>
                {renderRosterSlots(team)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Area */}
      <div className="auction-main">
        {error && <div style={{ color: 'var(--danger)', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}

        {activeRound ? (
          <div style={{ maxWidth: '860px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* 매물 프로필 */}
            <div className="auction-target-profile animate-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px', marginBottom: '16px' }}>
                <div
                  className="avatar-large"
                  style={{ borderColor: TIER_COLORS[activeRound.player.tier] || 'var(--border)', margin: 0 }}
                >
                  {activeRound.player.summonerName?.charAt(0) || '?'}
                </div>
                {activeRound.player.resolution && (
                  <div
                    style={{
                      fontStyle: 'italic',
                      color: 'var(--text-secondary)',
                      maxWidth: '400px',
                      lineHeight: '1.5',
                      fontSize: '1.1rem',
                      background: 'rgba(255, 255, 255, 0.05)',
                      padding: '12px 20px',
                      borderRadius: '8px',
                      borderLeft: '4px solid var(--accent)',
                    }}
                  >
                    &ldquo;{activeRound.player.resolution}&rdquo;
                  </div>
                )}
              </div>
              <h2
                style={{
                  fontSize: '2.5rem',
                  fontWeight: 800,
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                }}
              >
                {activeRound.player.name}
                {activeRound.player.isNewMember && (
                  <span style={{ fontSize: '1.2rem', color: 'var(--success)', border: '1px solid var(--success)', padding: '2px 8px', borderRadius: '4px' }}>
                    신입
                  </span>
                )}
                {activeRound.reAuction && (
                  <span style={{ fontSize: '1.1rem', color: 'var(--danger)', border: '1px solid var(--danger)', padding: '2px 8px', borderRadius: '4px' }}>
                    재경매
                  </span>
                )}
              </h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                <span
                  className="badge badge-tier"
                  style={{
                    backgroundColor: `${TIER_COLORS[activeRound.player.tier] || '#666'}22`,
                    color: TIER_COLORS[activeRound.player.tier] || '#999',
                    border: `1px solid ${TIER_COLORS[activeRound.player.tier] || '#666'}44`,
                    padding: '4px 12px',
                    fontSize: '0.85rem',
                  }}
                >
                  {getFormattedTier(activeRound.player.tier, activeRound.player.rankDivision, activeRound.player.lp)}
                </span>
                {activeRound.player.mostChampions && activeRound.player.mostChampions !== '없음' && activeRound.player.mostChampions !== '-' && (
                  <span
                    className="badge"
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.85rem',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    모스트: {activeRound.player.mostChampions}
                  </span>
                )}
              </div>

              {/* 주/부 라인 실시간 가격 — 프리미엄가가 오를 때마다 갱신 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: activeRound.subLinePrice != null ? '1fr 1fr' : '1fr',
                  gap: '16px',
                  marginTop: '24px',
                  width: '100%',
                }}
              >
                {[
                  { label: '주 라인', line: activeRound.player.mainPosition, price: activeRound.mainLinePrice, accent: 'var(--gold)' },
                  { label: '부 라인', line: activeRound.player.subPosition, price: activeRound.subLinePrice, accent: 'var(--accent)' },
                ]
                  .filter((s) => s.line && s.price != null)
                  .map((slot) => (
                    <div
                      key={slot.label}
                      style={{
                        background: 'var(--bg-secondary)',
                        border: `1px solid ${slot.accent}55`,
                        borderRadius: '12px',
                        padding: '16px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                        {slot.label} · {POSITION_LABELS[slot.line!] || slot.line}
                      </div>
                      <div style={{ fontSize: '2.4rem', fontWeight: 900, color: slot.accent, lineHeight: 1.2 }}>
                        {slot.price}
                        <span style={{ fontSize: '1rem', marginLeft: '2px' }}>P</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        기준 {activeRound.player.lineScores?.[slot.line!] ?? 0} {signed(activeRound.currentPremium)} 프리미엄
                      </div>
                    </div>
                  ))}
              </div>

              {/*
                전체 라인 최종가.
                주/부 라인이 팀들에서 다 차버리면 룰북 4-3에 따라 빈 라인 아무 곳이나 지정할 수 있으므로,
                5개 라인 가격을 모두 띄워서 팀장이 어디로 데려갈지 판단할 수 있게 한다.
              */}
              <div style={{ marginTop: '16px', width: '100%' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.08em' }}>
                  라인별 최종가
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                  {LINES.map((line) => {
                    const price = activeRound.linePrices?.[line] ?? finalPriceFor(activeRound.player, line, activeRound.currentPremium);
                    const isMain = line === activeRound.player.mainPosition;
                    const isSub = line === activeRound.player.subPosition;
                    // 수요: 이 라인이 아직 비어있는 팀 수
                    const openTeams = teams.filter((t) => (t.openLines ?? []).includes(line));
                    // 공급: 이 라인을 주/부로 신청한, 아직 안 팔린 매물 수
                    const supply = players.filter(
                      (p) =>
                        !p.isCaptain &&
                        (p.status === 'AVAILABLE' || p.status === 'UNSOLD') &&
                        (p.mainPosition === line || p.subPosition === line),
                    ).length;
                    // 갈 팀은 남았는데 그 라인 매물이 동난 상태 → 다른 라인 선수를 데려와야 한다
                    const squeezed = openTeams.length > 0 && supply === 0;
                    const openForMe = (targetTeam?.openLines ?? []).includes(line);
                    const accent = isMain ? 'var(--gold)' : isSub ? 'var(--accent)' : 'var(--text-secondary)';

                    return (
                      <div
                        key={line}
                        title={
                          openTeams.length > 0
                            ? `빈 팀: ${openTeams.map((t) => t.name).join(', ')}
이 라인을 주/부로 신청한 잔여 매물: ${supply}명`
                            : '전 팀 마감'
                        }
                        style={{
                          background: squeezed ? 'rgba(239,68,68,0.12)' : openForMe ? 'rgba(255,255,255,0.07)' : 'transparent',
                          border: `1px solid ${squeezed ? 'var(--danger)' : isMain || isSub ? accent : 'var(--border)'}`,
                          borderRadius: '8px',
                          padding: '8px 4px',
                          textAlign: 'center',
                          opacity: openTeams.length > 0 ? 1 : 0.35,
                        }}
                      >
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {POSITION_LABELS[line]}
                          {isMain && <span style={{ color: 'var(--gold)', marginLeft: '3px', fontWeight: 800 }}>주</span>}
                          {isSub && <span style={{ color: 'var(--accent)', marginLeft: '3px', fontWeight: 800 }}>부</span>}
                        </div>
                        <div style={{ fontSize: '1.15rem', fontWeight: 800, color: accent, lineHeight: 1.3 }}>
                          {price}
                          <span style={{ fontSize: '0.7rem' }}>P</span>
                        </div>
                        <div style={{ fontSize: '0.62rem', color: squeezed ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {openTeams.length > 0 ? `빈 팀 ${openTeams.length} · 매물 ${supply}` : '마감'}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!declaredLines(activeRound.player).some((l) => teams.some((t) => (t.openLines ?? []).includes(l))) && (
                  <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--danger)', textAlign: 'center' }}>
                    주·부 라인이 전 팀 마감 — 이 매물에 한해 빈 라인 아무 곳이나 지정할 수 있습니다 (룰북 4-3)
                  </div>
                )}
                {squeezedLines.length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--danger)', textAlign: 'center' }}>
                    ⚠ {squeezedLines.map((l) => POSITION_LABELS[l]).join('·')} 매물 소진 — 남은 자리는 다른 라인 선수로 채워야 합니다
                  </div>
                )}
              </div>

              <div style={{ marginTop: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                현재 프리미엄가{' '}
                <strong style={{ color: 'var(--gold)', fontSize: '1.1rem' }}>{signed(activeRound.currentPremium)}</strong>
                <span style={{ color: 'var(--text-muted)' }}>
                  {' '}
                  (범위 {signed(activeRound.premiumFloor)} ~ +{activeRound.premiumCap})
                </span>
                {activeRound.highestBidderTeam && (
                  <>
                    {' · 최고 입찰 '}
                    <strong style={{ color: 'var(--accent-light)' }}>{activeRound.highestBidderTeam}</strong>
                  </>
                )}
              </div>
            </div>

            {/* 경매 로그 */}
            <div className="terminal-log-window">
              <div className="terminal-log-window-header">
                경매 로그 <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} style={{ marginLeft: '8px' }}></span>
              </div>
              <div className="log-line highlight">
                {POSITION_LABELS[activeRound.player.mainPosition] || activeRound.player.mainPosition} - {activeRound.player.name} 경매 시작
                (프리미엄 하한 {signed(activeRound.premiumFloor)})
              </div>
              {[...bidHistory].reverse().map((bid, i) => (
                <div key={bid.bidId || i} className="log-line">
                  [{bid.teamName}] 프리미엄 <span style={{ color: 'var(--gold)', fontWeight: 'bold' }}>{signed(bid.amount)}</span>
                  {' → 주 '}
                  {finalPriceFor(activeRound.player, activeRound.player.mainPosition, bid.amount)}P
                  {activeRound.player.subPosition && (
                    <> / 부 {finalPriceFor(activeRound.player, activeRound.player.subPosition, bid.amount)}P</>
                  )}
                </div>
              ))}
              {isPendingAssign && (
                <div className="log-line highlight" style={{ color: 'var(--gold)' }}>
                  {activeRound.winningTeamName} 낙찰 (프리미엄 {signed(activeRound.finalPremium ?? 0)}) — 라인 선언 대기 중
                </div>
              )}
              <div ref={logEndRef} />
            </div>

            {/* 라인 선언 패널 (룰북 4-3) */}
            {isPendingAssign ? (
              <div className="auction-controls-panel">
                {role === 'HOST' || myTeamId === activeRound.winningTeamId ? (
                  <>
                    <div style={{ textAlign: 'center', marginBottom: '12px', fontSize: '1rem', color: 'var(--text-primary)' }}>
                      <strong style={{ color: 'var(--gold)' }}>{activeRound.winningTeamName}</strong> 낙찰 — 기용할 라인을 선언하세요
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(activeRound.assignableLines.length, 1)}, 1fr)`, gap: '10px' }}>
                      {activeRound.assignableLines.map((line) => {
                        const price = finalPriceFor(activeRound.player, line, activeRound.finalPremium ?? 0);
                        const winningTeam = teams.find((t) => t.id === activeRound.winningTeamId);
                        const affordable = !winningTeam || winningTeam.remainingPoints >= price;
                        const isDeclared = line === activeRound.player.mainPosition || line === activeRound.player.subPosition;
                        return (
                          <button
                            key={line}
                            className="btn btn-primary"
                            onClick={() => handleAssignLine(line)}
                            disabled={!affordable}
                            style={{
                              flexDirection: 'column',
                              padding: '14px 8px',
                              justifyContent: 'center',
                              opacity: affordable ? 1 : 0.4,
                              border: isDeclared ? '2px solid var(--gold)' : undefined,
                            }}
                          >
                            <span style={{ fontSize: '1rem', fontWeight: 800 }}>
                              {POSITION_LABELS[line]}
                              {isDeclared && <span style={{ fontSize: '0.7rem', marginLeft: '4px' }}>★</span>}
                            </span>
                            <span style={{ fontSize: '0.85rem' }}>{price}P</span>
                          </button>
                        );
                      })}
                      {activeRound.assignableLines.length === 0 && (
                        <div style={{ color: 'var(--danger)', textAlign: 'center' }}>선언 가능한 빈 라인이 없습니다.</div>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
                      ★ 표시는 매물이 신청한 주/부 라인입니다. 선언한 라인의 최종가가 팀 예산에서 차감됩니다.
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '16px' }}>
                    ⏳ <strong style={{ color: 'var(--gold)' }}>{activeRound.winningTeamName}</strong> 팀장의 라인 선언을 기다리는 중...
                  </div>
                )}
              </div>
            ) : (
              /* 입찰 패널 — 팀장이 올리는 값은 프리미엄가 */
              <div className="auction-controls-panel">
                <div className="team-chip-group">
                  {teams.map((t) => {
                    const canBid = (eligibility[t.id]?.length ?? 0) > 0;
                    return (
                      <div
                        key={t.id}
                        className={`team-chip ${
                          role === 'CAPTAIN'
                            ? myTeamId === t.id
                              ? 'active'
                              : 'disabled'
                            : selectedTeamId === t.id
                              ? 'active'
                              : ''
                        }`}
                        title={canBid ? undefined : '이 매물의 주/부 라인이 팀에 남아있지 않습니다'}
                        style={!canBid ? { opacity: 0.4, textDecoration: 'line-through' } : undefined}
                        onClick={() => role === 'HOST' && canBid && setSelectedTeamId(t.id)}
                      >
                        {t.name}
                      </div>
                    );
                  })}
                </div>

                <div className="quick-bid-group">
                  <button className="btn-quick-bid" onClick={() => updatePremium(activeRound.premiumFloor)}>
                    하한 {signed(activeRound.premiumFloor)}
                  </button>
                  <button className="btn-quick-bid" onClick={() => updatePremium((b) => b + 1)}>+1</button>
                  <button className="btn-quick-bid" onClick={() => updatePremium((b) => b + 2)}>+2</button>
                  <button className="btn-quick-bid" onClick={() => updatePremium((b) => b + 5)}>+5</button>
                  <button className="btn-quick-bid" onClick={() => updatePremium(activeRound.premiumCap)}>
                    상한 +{activeRound.premiumCap}
                  </button>

                  <div className="bid-input-container" style={{ margin: '0 8px' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="bid-input"
                      value={premium}
                      onFocus={() => {
                        isInputFocusedRef.current = true;
                      }}
                      onBlur={() => {
                        isInputFocusedRef.current = false;
                      }}
                      onChange={(e) => {
                        const sanitized = e.target.value.replace(/(?!^)-/g, '').replace(/[^-0-9]/g, '');
                        if (sanitized === '-' || sanitized === '') {
                          setPremium(sanitized);
                        } else {
                          const parsed = parseInt(sanitized, 10);
                          if (!isNaN(parsed)) updatePremium(parsed);
                        }
                      }}
                    />
                    <span>P</span>
                  </div>

                  {(() => {
                    const targetTeamName = targetTeam?.name;
                    const atCap = premiumValue === activeRound.premiumCap;
                    const isHighestBidder =
                      !!activeRound.highestBidderTeam && targetTeamName === activeRound.highestBidderTeam && !atCap;
                    const alreadyBiddedCap =
                      atCap && bidHistory.some((b) => b.teamId === targetTeamId && b.amount === activeRound.premiumCap);
                    const noBidsYet = bidHistory.length === 0;
                    const invalidAmount =
                      !noBidsYet && premiumValue <= activeRound.currentPremium && !(atCap && activeRound.currentPremium === activeRound.premiumCap);
                    const notEligible = myEligibleLines.length === 0;
                    const cantAfford = cheapestFinalPrice != null && targetTeam != null && targetTeam.remainingPoints < cheapestFinalPrice;

                    const mainPrice = finalPriceFor(activeRound.player, activeRound.player.mainPosition, premiumValue);
                    const subPrice = activeRound.player.subPosition
                      ? finalPriceFor(activeRound.player, activeRound.player.subPosition, premiumValue)
                      : null;

                    let label = `입찰 ${signed(premiumValue)} → 주 ${mainPrice}P`;
                    if (subPrice != null) label += ` / 부 ${subPrice}P`;
                    if (notEligible) label = '입찰 불가 (빈 라인 없음)';
                    else if (isHighestBidder) label = '최고가 입찰자';
                    else if (alreadyBiddedCap) label = '상한가 입찰 완료';
                    else if (cantAfford) label = '포인트 부족';

                    return (
                      <button
                        className="btn-submit-bid"
                        onClick={handlePlaceBid}
                        disabled={Boolean(!targetTeamId || invalidAmount || alreadyBiddedCap || isHighestBidder || notEligible || cantAfford)}
                      >
                        {label}
                      </button>
                    );
                  })()}
                </div>

                {role === 'HOST' && (
                  <div className="host-controls-group">
                    <button className="btn-host" onClick={handleRollbackLastBid} disabled={bidHistory.length === 0}>
                      입찰 취소
                    </button>
                    <button className="btn-host success" onClick={() => handleClose()} disabled={bidHistory.length === 0}>
                      낙찰
                    </button>
                    <button className="btn-host danger" onClick={handlePass}>
                      유찰
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : role === 'HOST' ? (
          <div style={{ maxWidth: '600px', margin: '0 auto', width: '100%', paddingTop: '48px' }}>
            <div className="card">
              <div className="card-header">
                <h2>🎯 새 경매 시작</h2>
              </div>
              {currentPool.length === 0 ? (
                <div className="empty-state">
                  <p>{players.length === 0 ? '경매 가능한 선수가 없습니다.' : '모든 선수 경매가 종료되었습니다.'}</p>
                </div>
              ) : (
                <>
                  {isReAuctionPhase && (
                    <div
                      style={{
                        background: 'var(--danger)',
                        color: 'white',
                        padding: '8px',
                        borderRadius: '4px',
                        textAlign: 'center',
                        marginBottom: '16px',
                        fontWeight: 'bold',
                      }}
                    >
                      🔥 유찰자 추가 경매가 진행 중입니다 🔥
                    </div>
                  )}
                  <div className="input-group">
                    <label>풀 필터 설정</label>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <button className={`btn ${poolFilter === 'ALL' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPoolFilter('ALL')} style={{ flex: 1 }}>
                        전체
                      </button>
                      <button className={`btn ${poolFilter === 'HIGH' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPoolFilter('HIGH')} style={{ flex: 1 }}>
                        다이아 이상
                      </button>
                      <button className={`btn ${poolFilter === 'LOW' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setPoolFilter('LOW')} style={{ flex: 1 }}>
                        다이아 미만
                      </button>
                    </div>
                    <label>대상 선수 ({currentPool.length}명)</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <select className="input" value={selectedPlayerId || ''} onChange={(e) => setSelectedPlayerId(Number(e.target.value))} style={{ flex: 1 }}>
                        <option value="">선수 선택</option>
                        {currentPool.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.tier} · 주 {POSITION_LABELS[p.mainPosition] || p.mainPosition} {p.mainScore ?? '-'}P
                            {p.subPosition ? ` / 부 ${POSITION_LABELS[p.subPosition]} ${p.subScore ?? '-'}P` : ''})
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-secondary" onClick={handleRandomSelect} style={{ whiteSpace: 'nowrap' }}>
                        🎲 랜덤 뽑기
                      </button>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    시작 가격은 선수의 라인별 기준 점수로 자동 결정됩니다. 팀장은 프리미엄가(0 ~ +{tournament?.premiumCap ?? 20})만 올립니다.
                  </p>
                  <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '16px' }} onClick={handleStartAuction} disabled={!selectedPlayerId}>
                    🚀 경매 시작
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '4rem', marginBottom: '16px' }}>⏳</div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>경매 대기 중...</h2>
            <p style={{ marginTop: '8px' }}>호스트가 다음 선수를 올릴 때까지 기다려주세요.</p>
          </div>
        )}
      </div>

      {/* Right Sidebar: Player Pools */}
      <div className="auction-right-sidebar">
        <div style={{ marginBottom: '16px' }}>
          <input type="text" className="input" placeholder="이름으로 선수 검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>

        {[
          { title: '대기 명단', list: freshPlayers, height: '40vh', dim: false },
          { title: '유찰 명단', list: unsoldPlayers, height: '30vh', dim: true },
        ].map((section) => (
          <div key={section.title} className="right-sidebar-section" style={section.dim ? { marginTop: '24px' } : undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
              <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>
                {section.title} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{section.list.length}명</span>
              </h4>
            </div>
            <div className="vertical-player-list" style={{ minHeight: '100px', height: section.height, overflowY: 'auto', marginTop: '12px' }}>
              {section.list.map((p) => (
                <div key={p.id} className="player-list-item" style={section.dim ? { opacity: 0.8 } : undefined}>
                  <div className="player-list-avatar" style={{ borderColor: TIER_COLORS[p.tier] || 'var(--border)' }}>
                    {p.summonerName?.charAt(0) || '?'}
                  </div>
                  <div className="player-list-info" style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span className="player-list-name">
                        {p.name}
                        {p.isNewMember && (
                          <span style={{ marginLeft: '4px', fontSize: '0.7rem', color: 'var(--success)', border: '1px solid var(--success)', padding: '0 4px', borderRadius: '4px' }}>
                            신입
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: TIER_COLORS[p.tier] || 'var(--text-muted)' }}>
                        {getFormattedTier(p.tier, p.rankDivision, p.lp)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="badge-position" style={{ padding: '2px 6px', fontSize: '0.7rem', borderRadius: '4px' }}>
                        주 {POSITION_LABELS[p.mainPosition] || p.mainPosition || '-'} {p.mainScore ?? '-'}P
                      </span>
                      {p.subPosition && (
                        <span className="badge-position" style={{ padding: '2px 6px', fontSize: '0.7rem', borderRadius: '4px', opacity: 0.7 }}>
                          부 {POSITION_LABELS[p.subPosition] || p.subPosition} {p.subScore ?? '-'}P
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {section.list.length === 0 && <div style={{ padding: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>없음</div>}
            </div>
          </div>
        ))}
      </div>

      {/* All Teams Modal */}
      {showAllTeams && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', flexDirection: 'column', padding: '40px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>전체 팀 로스터 현황 ({teams.length}팀)</h2>
            <button className="btn btn-primary" onClick={() => setShowAllTeams(false)} style={{ fontSize: '1rem', padding: '10px 24px', background: 'var(--danger)', border: 'none' }}>
              닫기
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', alignItems: 'start' }}>
            {teams.map((team) => {
              const spent = team.captainScore + team.members.reduce((sum, m) => sum + m.purchasePrice, 0);
              return (
                <div key={team.id} className="team-card-horizontal" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                  <div className="team-card-header">
                    <h3 className="team-name" style={{ color: 'var(--text-primary)' }}>
                      {team.name}
                      {team.name !== team.captainName && (
                        <span className="captain-name" style={{ color: 'var(--text-muted)' }}>({team.captainName})</span>
                      )}
                    </h3>
                    <div className="team-points-rem" style={{ color: 'var(--text-muted)' }}>
                      사용 {spent} / 잔여 <span style={{ color: 'var(--gold)' }}>{team.remainingPoints} pt</span>
                    </div>
                  </div>
                  <div className="team-roster-list">{renderRosterSlots(team, true)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showTiebreaker && activeRound && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-secondary)', padding: '32px', borderRadius: '12px', minWidth: '400px', textAlign: 'center', border: '1px solid var(--border)' }}>
            <h2 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>🏆 상한가 동률 발생!</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
              여러 팀이 상한 프리미엄가(+{activeRound.premiumCap})로 입찰했습니다.
              <br />
              이 매물을 낙찰시킬 팀을 선택해주세요.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {tiedTeams.map((t) => (
                <button key={t.id} className="btn btn-primary" onClick={() => handleClose(t.id)} style={{ width: '100%', padding: '16px', justifyContent: 'center', fontSize: '1.1rem' }}>
                  {t.name === t.captainName ? t.name : `${t.name} (${t.captainName})`} 팀에게 낙찰!
                </button>
              ))}
            </div>
            <button className="btn btn-secondary" onClick={() => setShowTiebreaker(false)} style={{ marginTop: '24px', width: '100%', justifyContent: 'center' }}>
              취소 (다시 대기)
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '400px',
          transform: `translate(${chatPosition.x}px, ${chatPosition.y}px)`,
          width: '320px',
          height: '400px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 50,
        }}
      >
        <div
          onMouseDown={handleChatDragStart}
          style={{
            padding: '12px 16px',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: isDraggingChat ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
        >
          <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)' }}>💬 팀장 단톡방</h4>
          <div style={{ background: connected ? 'var(--success)' : 'var(--danger)', width: 8, height: 8, borderRadius: '50%' }} />
        </div>

        <div style={{ flex: 1, padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {chatMessages.length === 0 && (
            <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>팀장님들과 대화를 시작해보세요!</div>
          )}
          {chatMessages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.isMe ? 'flex-end' : 'flex-start', width: '100%' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 4px 2px 4px' }}>{msg.senderName}</span>
              <div
                style={{
                  background: msg.isMe ? 'var(--accent)' : 'var(--bg-card)',
                  color: msg.isMe ? '#000000' : 'var(--text-primary)',
                  border: msg.isMe ? 'none' : '1px solid var(--border)',
                  padding: '6px 10px',
                  borderRadius: '12px',
                  borderTopRightRadius: msg.isMe ? '2px' : '12px',
                  borderTopLeftRadius: !msg.isMe ? '2px' : '12px',
                  maxWidth: '85%',
                  wordBreak: 'break-word',
                  fontSize: '0.85rem',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                {msg.message}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <form onSubmit={handleSendChat} style={{ display: 'flex', padding: '8px', background: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={!connected}
            placeholder="메시지 입력..."
            style={{ flex: 1, border: 'none', outline: 'none', padding: '8px', fontSize: '0.85rem', color: 'var(--text-primary)', backgroundColor: 'transparent' }}
          />
          <button
            type="submit"
            disabled={!connected || !chatInput.trim()}
            style={{
              background: 'var(--accent)',
              color: '#000000',
              border: 'none',
              borderRadius: '4px',
              padding: '0 12px',
              fontWeight: 600,
              cursor: !connected || !chatInput.trim() ? 'not-allowed' : 'pointer',
              opacity: !connected || !chatInput.trim() ? 0.5 : 1,
            }}
          >
            전송
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AuctionPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', background: 'var(--bg-primary)' }}></div>}>
      <AuctionContent />
    </Suspense>
  );
}
