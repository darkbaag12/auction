'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useWebSocket } from '../../hooks/useWebSocket';
import { Tournament, TeamResponse, PlayerResponse, AuctionRound, BidResponse, LINES, POSITION_LABELS, TIER_COLORS } from '../../lib/types';
import { Suspense } from 'react';

function DashboardContent() {
  const searchParams = useSearchParams();
  const tournamentId = Number(searchParams.get('tournamentId') || '0');

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<TeamResponse[]>([]);
  const [players, setPlayers] = useState<PlayerResponse[]>([]);
  const [activeRound, setActiveRound] = useState<AuctionRound | null>(null);
  const [bidHistory, setBidHistory] = useState<BidResponse[]>([]);

  // Current resolved tournament ID (from URL or latest)
  const [resolvedTournamentId, setResolvedTournamentId] = useState<number | null>(tournamentId || null);
  const { connected, lastMessage } = useWebSocket(resolvedTournamentId || null);

  const fetchData = async () => {
    try {
      let tId = resolvedTournamentId;
      if (!tId) {
        const latestTournament = await api.getLatestTournament() as Tournament;
        if (latestTournament) {
          tId = latestTournament.id;
          setResolvedTournamentId(tId);
        } else {
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

      const round = await api.getActiveRound(tId) as AuctionRound | null;
      if (round) {
        setActiveRound(round);
        const bids = await api.getBidHistory(round.roundId) as BidResponse[];
        setBidHistory(bids);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchData(); }, [resolvedTournamentId]);

  useEffect(() => {
    if (!lastMessage) return;
    const { type, data } = lastMessage as { type: string; data: any };

    switch (type) {
      case 'ROUND_START':
        setActiveRound(data);
        setBidHistory([]);
        break;
      case 'ROUND_UPDATE':
      case 'ROUND_PENDING_ASSIGN':
        setActiveRound(data);
        break;
      case 'NEW_BID':
        setBidHistory((prev) => [data, ...prev]);
        setActiveRound((prev) => prev ? {
          ...prev,
          currentPremium: data.amount,
          highestBidderTeam: data.teamName
        } : null);
        break;
      case 'ROUND_SOLD':
      case 'ROUND_UNSOLD':
        setActiveRound(null);
        setBidHistory([]);
        fetchData();
        break;
    }
  }, [lastMessage]);

  if (!resolvedTournamentId) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="icon">📺</div>
          <p>등록된 대회가 없거나 로딩 중입니다. 먼저 대회를 생성해주세요.</p>
        </div>
      </div>
    );
  }

  const soldPlayers = players.filter(p => p.status === 'SOLD' && !p.isCaptain);
  const availablePlayers = players.filter(p => !p.isCaptain && (p.status === 'AVAILABLE' || p.status === 'UNSOLD'));

  return (
    <div className="container">
      <div className="page-header">
        <h1>📺 {tournament?.name || '대시보드'}</h1>
        <p>
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
          {connected ? 'LIVE 시청 중' : '연결 끊김'}
          {' | '}
          {soldPlayers.length}명 낙찰 / {availablePlayers.length}명 대기
        </p>
      </div>

      {/* Live Auction */}
      {activeRound && (
        <div className="auction-stage animate-in" style={{ marginBottom: '32px' }}>
          <span className="badge badge-auctioning" style={{ fontSize: '0.9rem', marginBottom: '12px', display: 'inline-flex' }}>
            🔴 LIVE — Round #{activeRound.roundNumber}
          </span>
          <h2 style={{ fontSize: '2.2rem', fontWeight: '800', marginBottom: '4px' }}>
            {activeRound.player.name}
          </h2>
          <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            {activeRound.player.summonerName}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <span className="badge badge-tier" style={{
              backgroundColor: `${TIER_COLORS[activeRound.player.tier] || '#666'}22`,
              color: TIER_COLORS[activeRound.player.tier] || '#999',
              border: `1px solid ${TIER_COLORS[activeRound.player.tier] || '#666'}44`,
              fontSize: '0.85rem', padding: '4px 14px',
            }}>
              {activeRound.player.tier} {['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(activeRound.player.tier) ? `${activeRound.player.lp || 0}LP` : activeRound.player.rankDivision}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <span className="badge badge-position" style={{ fontSize: '0.85rem', padding: '4px 14px' }}>
                {POSITION_LABELS[activeRound.player.mainPosition] || activeRound.player.mainPosition}
              </span>
              {activeRound.player.subPosition && activeRound.player.subPosition !== '없음' && activeRound.player.subPosition !== '' && (
                <span className="badge badge-position" style={{ fontSize: '0.85rem', padding: '4px 14px', opacity: 0.7, borderStyle: 'dashed' }}>
                  {POSITION_LABELS[activeRound.player.subPosition] || activeRound.player.subPosition}
                </span>
              )}
            </div>
          </div>

          {activeRound.player.mostChampions && (
            <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '0.9rem' }}>
              모스트: {activeRound.player.mostChampions}
              <span className={activeRound.player.isNewMember ? "badge badge-success" : "badge badge-secondary"} style={{ marginLeft: '8px', fontSize: '0.75rem', padding: '2px 8px' }}>
                신입: {activeRound.player.isNewMember ? 'O' : 'X'}
              </span>
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', flexWrap: 'wrap' }}>
            {[
              { label: '주 라인', line: activeRound.player.mainPosition, price: activeRound.mainLinePrice, accent: 'var(--gold)' },
              { label: '부 라인', line: activeRound.player.subPosition, price: activeRound.subLinePrice, accent: 'var(--accent-light)' },
            ].filter(s => s.line && s.price != null).map(slot => (
              <div key={slot.label}>
                <div className="auction-price-label">
                  {slot.label} · {POSITION_LABELS[slot.line!] || slot.line}
                </div>
                <div className="auction-price flash" style={{ color: slot.accent }}>{slot.price}P</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  기준 {activeRound.player.lineScores?.[slot.line!] ?? 0} + 프리미엄 {activeRound.currentPremium}
                </div>
              </div>
            ))}
          </div>

          {/* 5개 라인 최종가. 주/부 라인이 마감되면 다른 라인으로 갈 수 있어서 전부 띄운다. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', maxWidth: '560px', margin: '20px auto 0' }}>
            {LINES.map((line) => {
              const price = activeRound.linePrices?.[line]
                ?? Math.max(0, (activeRound.player.lineScores?.[line] ?? 0) + activeRound.currentPremium);
              const isMain = line === activeRound.player.mainPosition;
              const isSub = line === activeRound.player.subPosition;
              const openTeams = teams.filter(t => (t.openLines ?? []).includes(line));
              const supply = players.filter(p =>
                !p.isCaptain
                && (p.status === 'AVAILABLE' || p.status === 'UNSOLD')
                && (p.mainPosition === line || p.subPosition === line)
              ).length;
              const squeezed = openTeams.length > 0 && supply === 0;
              const accent = isMain ? 'var(--gold)' : isSub ? 'var(--accent-light)' : 'var(--text-secondary)';

              return (
                <div key={line} style={{
                  border: `1px solid ${squeezed ? 'var(--danger)' : isMain || isSub ? accent : 'var(--border)'}`,
                  background: squeezed ? 'rgba(239,68,68,0.12)' : 'transparent',
                  borderRadius: '8px',
                  padding: '8px 4px',
                  opacity: openTeams.length > 0 ? 1 : 0.35,
                }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {POSITION_LABELS[line]}
                    {isMain && <span style={{ color: 'var(--gold)', marginLeft: '3px', fontWeight: 800 }}>주</span>}
                    {isSub && <span style={{ color: 'var(--accent-light)', marginLeft: '3px', fontWeight: 800 }}>부</span>}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: accent }}>{price}P</div>
                  <div style={{ fontSize: '0.62rem', color: squeezed ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {openTeams.length > 0 ? `빈 팀 ${openTeams.length} · 매물 ${supply}` : '마감'}
                  </div>
                </div>
              );
            })}
          </div>

          {activeRound.status === 'PENDING_ASSIGN' ? (
            <p style={{ color: 'var(--gold)', marginTop: '12px', fontSize: '1.1rem' }}>
              🏆 <strong>{activeRound.winningTeamName}</strong> 낙찰 — 라인 선언 대기 중
            </p>
          ) : activeRound.highestBidderTeam && (
            <p style={{ color: 'var(--text-secondary)', marginTop: '12px', fontSize: '1.1rem' }}>
              최고 입찰: <strong style={{ color: 'var(--accent-light)', fontSize: '1.2rem' }}>{activeRound.highestBidderTeam}</strong>
              {' '}(프리미엄 {activeRound.currentPremium >= 0 ? `+${activeRound.currentPremium}` : activeRound.currentPremium})
            </p>
          )}

          {/* Recent bids */}
          {bidHistory.length > 0 && (
            <div style={{ maxWidth: '400px', margin: '24px auto 0' }}>
              <div className="bid-history" style={{ maxHeight: '200px' }}>
                {bidHistory.slice(0, 5).map((bid, i) => (
                  <div key={bid.bidId || i} className="bid-item">
                    <span className="bid-team">{i === 0 && '👑 '}{bid.teamName}</span>
                    <span className="bid-amount">프리미엄 {bid.amount >= 0 ? `+${bid.amount}` : bid.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Teams Grid */}
      <div className="grid-4" style={{ marginBottom: '32px' }}>
        {teams.map((team) => {
          const positions = [...LINES];
          return (
            <div key={team.id} className="card team-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ fontSize: '1.05rem' }}>{team.name}</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {team.name === team.captainName
                      ? (team.captainPosition ? `팀장 ${POSITION_LABELS[team.captainPosition]}` : '팀장')
                      : team.captainName}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="team-points" style={{ fontSize: '1.3rem' }}>{team.remainingPoints}</div>
                  <div className="team-points-label" style={{ fontSize: '0.65rem' }}>포인트</div>
                </div>
              </div>
              <div className="team-roster">
                {positions.map((pos) => {
                  const member = team.members.find(m => m.assignedPosition === pos);
                  if (!member && team.captainPosition === pos) {
                    return (
                      <div key={pos} className="roster-slot" style={{ background: 'rgba(200,155,60,0.08)' }}>
                        <span className="position-icon">{POSITION_LABELS[pos]}</span>
                        <span className="player-name">{team.captainName}</span>
                        <span className="badge badge-tier" style={{ color: 'var(--gold)', fontSize: '0.6rem', padding: '2px 6px' }}>팀장</span>
                        <span className="player-price">{team.captainScore}P</span>
                      </div>
                    );
                  }
                  return member ? (
                    <div key={pos} className="roster-slot">
                      <span className="position-icon">{POSITION_LABELS[pos]}</span>
                      <span className="player-name">{member.summonerName}</span>
                      <span className="badge badge-tier" style={{
                        backgroundColor: `${TIER_COLORS[member.tier] || '#666'}22`,
                        color: TIER_COLORS[member.tier] || '#999',
                        fontSize: '0.6rem', padding: '2px 6px',
                      }}>
                        {member.tier}
                      </span>
                      <span className="player-price">{member.purchasePrice}P</span>
                    </div>
                  ) : (
                    <div key={pos} className="roster-slot empty">
                      <span className="position-icon">{POSITION_LABELS[pos]}</span>
                      <span className="player-name" style={{ color: 'var(--text-muted)' }}>—</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Available Players */}
      {availablePlayers.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>🎮 대기 중인 선수 ({availablePlayers.length}명)</h2>
          </div>
          <div className="grid-5">
            {availablePlayers.map((p) => (
              <div key={p.id} className="card player-card">
                <div className="player-info">
                  <div className="player-avatar" style={{ borderColor: TIER_COLORS[p.tier] || 'var(--border)' }}>
                    {p.summonerName?.charAt(0) || '?'}
                  </div>
                  <div className="player-details">
                    <h4 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {p.name}
                      <span className={p.isNewMember ? "badge badge-success" : "badge badge-secondary"} style={{ fontSize: '0.6rem', padding: '2px 6px' }}>
                        신입: {p.isNewMember ? 'O' : 'X'}
                      </span>
                    </h4>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>{p.summonerName}</div>
                    <div className="player-meta">
                      <span className="badge badge-tier" style={{
                        backgroundColor: `${TIER_COLORS[p.tier] || '#666'}22`,
                        color: TIER_COLORS[p.tier] || '#999',
                        fontSize: '0.65rem', padding: '2px 6px',
                      }}>
                        {p.tier} {['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(p.tier) ? `${p.lp || 0}LP` : p.rankDivision}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <span className="badge badge-position" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>
                          {POSITION_LABELS[p.mainPosition] || p.mainPosition}
                        </span>
                        {p.subPosition && p.subPosition !== '없음' && p.subPosition !== '' && (
                          <span className="badge badge-position" style={{ fontSize: '0.65rem', padding: '2px 8px', opacity: 0.7, borderStyle: 'dashed' }}>
                            {POSITION_LABELS[p.subPosition] || p.subPosition}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="container"><div className="empty-state"><p>로딩 중...</p></div></div>}>
      <DashboardContent />
    </Suspense>
  );
}
