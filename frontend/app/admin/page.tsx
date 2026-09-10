'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { Tournament, TeamResponse, PlayerResponse, LINES, POSITION_LABELS, TIER_COLORS, TIER_LABELS } from '../../lib/types';
import { Suspense } from 'react';

function AdminContent() {
  const searchParams = useSearchParams();
  const tournamentId = Number(searchParams.get('tournamentId') || '0');
  const isNewMode = searchParams.get('new') === 'true';

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [teams, setTeams] = useState<TeamResponse[]>([]);
  const [players, setPlayers] = useState<PlayerResponse[]>([]);
  const [auctionHistory, setAuctionHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin auth check
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isAuth = sessionStorage.getItem('admin_auth');
      if (isAuth !== 'true') {
        window.location.href = '/';
      }
    }
  }, []);

  // Tournament Creation Form
  const [tournamentName, setTournamentName] = useState('');
  // 룰북 4-3: 팀장 본인 점수를 포함해 총 290점
  const [totalPoints, setTotalPoints] = useState(290);
  const [bidUnit, setBidUnit] = useState(1);
  const [maxTeamSize, setMaxTeamSize] = useState(5);
  const [premiumCap, setPremiumCap] = useState(20);
  const [isCreating, setIsCreating] = useState(false);

  // Team form
  const [teamName, setTeamName] = useState('');
  const [captainName, setCaptainName] = useState('');
  const [captainPosition, setCaptainPosition] = useState('TOP');
  const [startingPoints, setStartingPoints] = useState<string>('');

  // Player form
  const [playerName, setPlayerName] = useState('');
  const [playerTier, setPlayerTier] = useState('GOLD');
  const [playerDivision, setPlayerDivision] = useState('4');
  const [playerPosition, setPlayerPosition] = useState('MID');
  const [playerSubPosition, setPlayerSubPosition] = useState('');
  const [playerChampions, setPlayerChampions] = useState('');

  // Manual Assign form
  const [showManualAssign, setShowManualAssign] = useState(false);
  const [manualAssignPlayerId, setManualAssignPlayerId] = useState<number | ''>('');
  const [manualAssignTeamId, setManualAssignTeamId] = useState<number | ''>('');
  const [manualAssignPosition, setManualAssignPosition] = useState<string>('');
  const [manualAssignPremium, setManualAssignPremium] = useState<number | ''>(0);

  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [error, setError] = useState('');

  // Current resolved tournament ID (from URL or latest)
  const [resolvedTournamentId, setResolvedTournamentId] = useState<number | null>(tournamentId || null);

  // File upload state
  const [isUploading, setIsUploading] = useState(false);

  // Player search filter
  const [playerSearchTerm, setPlayerSearchTerm] = useState('');

  const fetchData = async () => {
    try {
      let tId = resolvedTournamentId;
      if (!tId) {
        // If ?new=true, don't auto-fetch — keep blank for new tournament creation
        if (isNewMode) {
          setLoading(false);
          return;
        }
        const latestTournament = await api.getLatestTournament() as Tournament;
        if (latestTournament) {
          tId = latestTournament.id;
          setResolvedTournamentId(tId);
        } else {
          setLoading(false);
          return;
        }
      }
      
      const [t, tm, pl, history] = await Promise.all([
        api.getTournament(tId) as Promise<Tournament>,
        api.getTeams(tId) as Promise<TeamResponse[]>,
        api.getPlayers(tId) as Promise<PlayerResponse[]>,
        api.getAuctionHistory(tId) as Promise<any[]>,
      ]);
      setTournament(t);
      setTeams(tm);
      setPlayers(pl);
      setAuctionHistory(history);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [resolvedTournamentId]);

  const handleCreateTournament = async () => {
    if (!tournamentName.trim()) {
      setError('대회명을 입력해주세요.');
      return;
    }
    setIsCreating(true);
    setError('');
    try {
      const result: any = await api.createTournament({
        name: tournamentName,
        totalPoints,
        bidUnit,
        maxTeamSize,
        premiumCap,
      });
      setResolvedTournamentId(result.id);
      window.location.href = `/admin?tournamentId=${result.id}`;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddTeam = async () => {
    if (!teamName.trim() || !captainName.trim() || !resolvedTournamentId) return;
    try {
      const sp = startingPoints.trim() ? parseInt(startingPoints, 10) : undefined;
      await api.createTeam(resolvedTournamentId, {
        name: teamName,
        captainName,
        captainPosition,
        startingPoints: sp
      });
      setTeamName(''); setCaptainName(''); setStartingPoints(''); setShowAddTeam(false);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteTeam = async (teamId: number) => {
    if (!resolvedTournamentId) return;
    if (!window.confirm('정말 이 팀을 삭제하시겠습니까? (소속된 선수 정보도 함께 삭제될 수 있습니다.)')) return;
    try {
      await api.deleteTeam(resolvedTournamentId, teamId);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRollback = async (roundId: number) => {
    if (!window.confirm('이 경매 라운드를 정말 롤백하시겠습니까?\n사용한 포인트가 복구되고, 선수는 대기 상태로 돌아갑니다.')) return;
    try {
      await api.rollbackAuction(roundId);
      fetchData();
    } catch (err: any) {
      setError(`롤백 실패: ${err.message}`);
    }
  };

  const handleAddPlayer = async () => {
    if (!playerName.trim() || !resolvedTournamentId) return;
    try {
      await api.createPlayer(resolvedTournamentId, {
        name: playerName,
        summonerName: playerName,
        tier: `${playerTier} ${playerDivision}`,
        rankDivision: playerDivision,
        lp: 0,
        mainPosition: playerPosition,
        subPosition: playerSubPosition,
        mostChampions: playerChampions,
        profileIconUrl: null,
      });
      setPlayerName(''); setPlayerChampions(''); setShowAddPlayer(false);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteAllPlayers = async () => {
    if (!resolvedTournamentId) return;
    if (!window.confirm('등록된 모든 선수를 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
    if (!window.confirm('다시 한번 확인합니다. 모든 선수를 삭제합니까?')) return;
    try {
      await api.deleteAllPlayers(resolvedTournamentId);
      fetchData();
    } catch (err: any) {
      setError(`전체 삭제 실패: ${err.message}`);
    }
  };

  const manualAssignPlayer = players.find(p => p.id === Number(manualAssignPlayerId));
  const manualAssignTeam = teams.find(t => t.id === Number(manualAssignTeamId));
  const manualAssignBase = manualAssignPlayer && manualAssignPosition
    ? (manualAssignPlayer.lineScores?.[manualAssignPosition] ?? 0)
    : 0;
  const manualAssignFinal = Math.max(0, manualAssignBase + Number(manualAssignPremium || 0));

  const handleManualAssign = async () => {
    if (!resolvedTournamentId || manualAssignPlayerId === '' || manualAssignTeamId === '' || !manualAssignPosition) {
      setError('선수 / 팀 / 라인을 모두 선택해주세요.');
      return;
    }
    if (!window.confirm(`이 선수를 ${POSITION_LABELS[manualAssignPosition]} 라인으로 배정합니다.
차감 포인트: ${manualAssignFinal}P`)) return;

    try {
      await api.manualAssignPlayer(resolvedTournamentId, {
        playerId: Number(manualAssignPlayerId),
        teamId: Number(manualAssignTeamId),
        position: manualAssignPosition,
        premium: Number(manualAssignPremium || 0),
      });
      setShowManualAssign(false);
      setManualAssignPlayerId('');
      setManualAssignTeamId('');
      setManualAssignPosition('');
      setManualAssignPremium(0);
      fetchData();
      alert('수동 배정이 완료되었습니다.');
    } catch (err: any) {
      setError(`수동 배정 실패: ${err.message}`);
    }
  };

  /** 팀장이 맡을 라인 변경. 팀장 점수가 예산에 포함되므로 차액이 자동 반영된다. */
  const handleChangeCaptainLine = async (teamId: number, position: string) => {
    if (!resolvedTournamentId) return;
    try {
      await api.updateTeam(resolvedTournamentId, teamId, { captainPosition: position });
      fetchData();
    } catch (err: any) {
      setError(`팀장 라인 변경 실패: ${err.message}`);
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resolvedTournamentId) return;

    setIsUploading(true);
    setError('');
    try {
      await api.importPlayersFromExcel(resolvedTournamentId, file);
      fetchData();
      alert('엑셀 데이터를 성공적으로 불러왔습니다.');
    } catch (err: any) {
      setError(`업로드 실패: ${err.message}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteTournament = async () => {
    if (!resolvedTournamentId) return;
    if (!confirm(`'${tournament?.name}' 대회를 삭제하시겠습니까?\n선수, 팀 등 모든 데이터가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await (api as any).deleteTournament(resolvedTournamentId);
      alert('대회가 삭제되었습니다.');
      window.location.href = '/';
    } catch (err: any) {
      setError(`삭제 실패: ${err.message}`);
    }
  };

  if (!resolvedTournamentId && !loading) {
    return (
      <div className="container" style={{ marginTop: '48px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div className="card animate-in">
            <div className="card-header">
              <h2>🏆 새 대회 생성</h2>
            </div>
            
            <div className="input-group">
              <label>대회명</label>
              <input
                className="input"
                placeholder="예: 제1회 ExP 경매"
                value={tournamentName}
                onChange={(e) => setTournamentName(e.target.value)}
              />
            </div>

            <div className="grid-3">
              <div className="input-group">
                <label>팀당 포인트</label>
                <input
                  className="input"
                  type="number"
                  value={totalPoints}
                  onChange={(e) => setTotalPoints(Number(e.target.value))}
                />
              </div>
              <div className="input-group">
                <label>입찰 단위</label>
                <input
                  className="input"
                  type="number"
                  value={bidUnit}
                  onChange={(e) => setBidUnit(Number(e.target.value))}
                />
              </div>
              <div className="input-group">
                <label>팀 인원</label>
                <input
                  className="input"
                  type="number"
                  value={maxTeamSize}
                  onChange={(e) => setMaxTeamSize(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="input-group">
              <label>프리미엄가 상한 (룰북 4-3: +20)</label>
              <input
                className="input"
                type="number"
                value={premiumCap}
                onChange={(e) => setPremiumCap(Number(e.target.value))}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                팀장은 기준가가 아닌 프리미엄가만 올립니다. 최종가 = 라인 기준 점수 + 프리미엄가.
              </p>
            </div>

            {error && (
              <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</p>
            )}

            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: '8px' }}
              onClick={handleCreateTournament}
              disabled={isCreating}
            >
              {isCreating ? '생성 중...' : '🚀 대회 생성'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container">
        <div className="empty-state"><p>로딩 중...</p></div>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '24px' }}>
      <div className="page-header" style={{ position: 'relative' }}>
        <a href="/" className="btn btn-outline btn-sm" style={{ position: 'absolute', left: 0, top: '32px' }}>
          🏠 홈으로
        </a>
        <a href={`/auction?tournamentId=${resolvedTournamentId}&role=HOST`} className="btn btn-primary btn-sm" style={{ position: 'absolute', right: 0, top: '32px' }}>
          🔨 경매장 가기
        </a>
        <h1>⚙️ 대회 관리</h1>
        <p style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {tournament?.name} | 팀 예산: {tournament?.totalPoints}P (팀장 점수 포함) | 프리미엄 상한: +{tournament?.premiumCap} | 팀 인원: {tournament?.maxTeamSize}
          <button
            className="btn btn-sm"
            style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', padding: '4px 10px', fontSize: '0.8rem' }}
            onClick={handleDeleteTournament}
          >
            🗑️ 대회 삭제
          </button>
        </p>
      </div>

      {error && <p style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: '16px' }}>{error}</p>}

      {/* Teams Section */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h2>👥 팀 관리 ({teams.length}팀)</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddTeam(true)}>+ 팀 추가</button>
        </div>

        {teams.length === 0 ? (
          <div className="empty-state"><p>등록된 팀이 없습니다.</p></div>
        ) : (
          <div className="grid-3">
            {teams.map((team) => (
              <div key={team.id} className="team-card-horizontal" style={{ position: 'relative' }}>
                <div className="team-card-horizontal-header">
                  <h3 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {team.name} <span style={{fontSize: '0.85rem', color: 'var(--text-muted)'}}>({team.captainName})</span>
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className="points" style={{ fontSize: '0.95rem' }}>
                      잔여: <span style={{color: 'var(--gold)', fontWeight: 800}}>{team.remainingPoints} pt</span>
                    </div>
                    <button 
                      onClick={() => handleDeleteTeam(team.id)} 
                      style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', padding: 0 }}
                      title="팀 삭제"
                    >
                      ✖
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <span>팀장 라인</span>
                  <select
                    className="input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', width: 'auto' }}
                    value={team.captainPosition ?? ''}
                    onChange={(e) => handleChangeCaptainLine(team.id, e.target.value)}
                  >
                    <option value="">미지정</option>
                    {LINES.map((l) => (
                      <option key={l} value={l}>{POSITION_LABELS[l]}</option>
                    ))}
                  </select>
                  <span>팀장 점수 <strong style={{ color: 'var(--gold)' }}>{team.captainScore}P</strong></span>
                </div>
                <div className="team-card-roster-list" style={{ marginTop: '12px' }}>
                  {LINES.map((line) => {
                    const m = team.members.find(mem => mem.assignedPosition === line);
                    if (m) {
                      const playerRecord = players.find(p => p.id === m.playerId);
                      const displayName = m.name || playerRecord?.name || m.summonerName;
                      return (
                        <div key={line} className="roster-list-item">
                          <div className="player-pic" style={{ fontSize: '0.7rem', fontWeight: 800 }}>{POSITION_LABELS[line]}</div>
                          <div className="player-info">
                            <div className="player-name-row">
                              <span className="player-name">{displayName}</span>
                              {m.tier && (
                                <span style={{ fontSize: '0.65rem', color: TIER_COLORS[m.tier] || 'var(--text-muted)', fontWeight: 800, border: `1px solid ${TIER_COLORS[m.tier]}`, borderRadius: '4px', padding: '2px 6px' }}>
                                  {m.tier}
                                </span>
                              )}
                            </div>
                            <span className="summoner-name">@{m.summonerName}</span>
                          </div>
                          <div className="bid-info">
                            <span className="bid-label">기준 {m.basePrice} {m.premium >= 0 ? `+${m.premium}` : m.premium}</span>
                            <span className="bid-price">{m.purchasePrice} pt</span>
                          </div>
                        </div>
                      );
                    }
                    if (team.captainPosition === line) {
                      return (
                        <div key={line} className="roster-list-item" style={{ background: 'rgba(200,155,60,0.08)' }}>
                          <div className="player-pic" style={{ fontSize: '0.7rem', fontWeight: 800, borderColor: 'var(--gold)' }}>{POSITION_LABELS[line]}</div>
                          <div className="player-info">
                            <div className="player-name-row">
                              <span className="player-name">{team.captainName}</span>
                              <span style={{ fontSize: '0.65rem', color: 'var(--gold)', fontWeight: 800, border: '1px solid var(--gold)', borderRadius: '4px', padding: '2px 6px' }}>팀장</span>
                            </div>
                          </div>
                          <div className="bid-info">
                            <span className="bid-price">{team.captainScore} pt</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={line} className="roster-list-item" style={{ opacity: 0.45 }}>
                        <div className="player-pic" style={{ borderStyle: 'dashed', fontSize: '0.7rem', fontWeight: 800 }}>{POSITION_LABELS[line]}</div>
                        <div className="player-info">
                          <div className="player-name-row">
                            <span className="player-name" style={{ color: 'var(--text-muted)' }}>빈 라인</span>
                          </div>
                        </div>
                        <div className="bid-info"></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auction History / Rollback Section */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h2>🕒 경매 기록 및 롤백 ({auctionHistory.length}건)</h2>
        </div>
        {auctionHistory.length === 0 ? (
          <div className="empty-state"><p>최근 종료된 경매가 없습니다.</p></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>라운드</th>
                <th>선수 (소환사명)</th>
                <th>낙찰 팀</th>
                <th>배정 라인</th>
                <th>낙찰가</th>
                <th>상태</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {[...auctionHistory].reverse().map((round) => (
                <tr key={round.roundId}>
                  <td>#{round.roundNumber}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{round.player.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{round.player.summonerName}</div>
                  </td>
                  <td style={{ fontWeight: 600, color: round.winningTeamName ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {round.winningTeamName || round.highestBidderTeam || '-'}
                  </td>
                  <td>
                    {round.assignedPosition
                      ? <span className="badge badge-position">{POSITION_LABELS[round.assignedPosition] || round.assignedPosition}</span>
                      : '-'}
                  </td>
                  <td style={{ color: 'var(--gold)', fontWeight: 600 }}>
                    {round.finalPrice != null ? `${round.finalPrice}P` : '-'}
                    {round.finalPremium != null && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                        (프리미엄 {round.finalPremium >= 0 ? `+${round.finalPremium}` : round.finalPremium})
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge badge-${round.status.toLowerCase()}`}>{round.status}</span>
                  </td>
                  <td>
                    <button 
                      className="btn btn-sm btn-outline danger" 
                      onClick={() => handleRollback(round.roundId)}
                    >
                      ↩ 롤백
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Players Section */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h2>🎮 선수 관리 ({players.length}명)</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              className="input"
              placeholder="이름/소환사명 검색..."
              value={playerSearchTerm}
              onChange={(e) => setPlayerSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              style={{ padding: '6px 12px', width: '200px' }}
            />
            <button type="button" className="btn btn-warning btn-sm" onClick={() => setShowManualAssign(true)}>⚡ 수동 배정</button>
            <label className={`btn btn-secondary btn-sm ${isUploading ? 'loading' : ''}`} style={{ cursor: 'pointer', margin: 0 }}>
              {isUploading ? '업로드 중...' : '엑셀 업로드'}
              <input 
                type="file" 
                accept=".xlsx, .xls" 
                style={{ display: 'none' }} 
                onChange={handleExcelUpload} 
                disabled={isUploading}
              />
            </label>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddPlayer(true)}>+ 선수 추가</button>
            {players.length > 0 && (
              <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteAllPlayers}>🗑️ 전부 삭제</button>
            )}
          </div>
        </div>

        {players.length === 0 ? (
          <div className="empty-state"><p>등록된 선수가 없습니다.</p></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>성명 (소환사명)</th>
                <th>티어</th>
                <th>포지션</th>
                <th>라인별 기준 점수 (탑/정글/미드/원딜/서폿)</th>
                <th>모스트</th>
                <th>상태</th>
                <th>팀</th>
                <th>낙찰가</th>
              </tr>
            </thead>
            <tbody>
              {players.filter(p => playerSearchTerm === '' || p.name.includes(playerSearchTerm) || p.summonerName.includes(playerSearchTerm)).map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {p.name}
                      {p.isCaptain && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--gold)', border: '1px solid var(--gold)', borderRadius: '4px', padding: '1px 5px' }}>팀장</span>
                      )}
                      {p.isNewMember && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--success)', border: '1px solid var(--success)', borderRadius: '4px', padding: '1px 5px' }}>신입</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{p.summonerName}</div>
                  </td>
                  <td>
                    <span className="badge badge-tier" style={{
                      backgroundColor: `${TIER_COLORS[p.tier] || '#666'}22`,
                      color: TIER_COLORS[p.tier] || '#999',
                      border: `1px solid ${TIER_COLORS[p.tier] || '#666'}44`
                    }}>
                      {TIER_LABELS[p.tier] || p.tier} {['MASTER', 'GRANDMASTER', 'CHALLENGER', 'IMMORTAL', 'RADIANT'].includes(p.tier) ? `${p.lp || 0}LP` : p.rankDivision}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <span className="badge badge-position">{POSITION_LABELS[p.mainPosition] || p.mainPosition}</span>
                      {p.subPosition && p.subPosition !== '없음' && p.subPosition !== '' && (
                        <span className="badge badge-position" style={{ opacity: 0.7, borderStyle: 'dashed' }}>
                          {POSITION_LABELS[p.subPosition] || p.subPosition}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.8rem', letterSpacing: '0.02em' }}>
                    {LINES.map((line, i) => (
                      <span key={line}>
                        {i > 0 && <span style={{ color: 'var(--text-muted)' }}> / </span>}
                        <span style={{
                          fontWeight: line === p.mainPosition ? 800 : 400,
                          color: line === p.mainPosition ? 'var(--gold)' : line === p.subPosition ? 'var(--accent-light)' : 'var(--text-secondary)',
                        }}>
                          {p.lineScores?.[line] ?? '-'}
                        </span>
                      </span>
                    ))}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {p.mostChampions || '-'}
                  </td>
                  <td>
                    <span className={`badge badge-${p.status.toLowerCase()}`}>{p.status}</span>
                  </td>
                  <td>
                    {p.teamName || '-'}
                    {p.assignedPosition && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                        ({POSITION_LABELS[p.assignedPosition] || p.assignedPosition})
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{p.soldPrice != null ? `${p.soldPrice}P` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Team Modal */}
      {showAddTeam && (
        <div className="modal-overlay" onClick={() => setShowAddTeam(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>팀 추가</h2>
            <div className="input-group">
              <label>팀명</label>
              <input className="input" placeholder="예: 블루팀" value={teamName}
                onChange={(e) => setTeamName(e.target.value)} />
            </div>
            <div className="input-group">
              <label>팀장 닉네임</label>
              <input className="input" placeholder="예: 스트리머A" value={captainName}
                onChange={(e) => setCaptainName(e.target.value)} />
            </div>
            <div className="input-group">
              <label>팀장이 맡을 라인</label>
              <select className="input" value={captainPosition} onChange={(e) => setCaptainPosition(e.target.value)}>
                {LINES.map((l) => <option key={l} value={l}>{POSITION_LABELS[l]}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>초기 포인트 (선택, 기본: 대회설정값 {tournament?.totalPoints ?? 290}P)</label>
              <input type="number" className="input" placeholder="예: 290" value={startingPoints}
                onChange={(e) => setStartingPoints(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowAddTeam(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleAddTeam}>추가</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Player Modal */}
      {showAddPlayer && (
        <div className="modal-overlay" onClick={() => setShowAddPlayer(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>선수 추가</h2>
            <div className="input-group">
              <label>소환사명</label>
              <input className="input" placeholder="소환사명" value={playerName}
                onChange={(e) => setPlayerName(e.target.value)} />
            </div>
            <div className="grid-3">
              <div className="input-group">
                <label>티어</label>
                <select className="input" value={playerTier} onChange={(e) => setPlayerTier(e.target.value)}>
                  {['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'].map((t) => (
                    <option key={t} value={t}>{TIER_LABELS[t] || t}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>등급</label>
                <select className="input" value={playerDivision} onChange={(e) => setPlayerDivision(e.target.value)}>
                  {['1', '2', '3', '4'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label>주 포지션</label>
                <select className="input" value={playerPosition} onChange={(e) => setPlayerPosition(e.target.value)}>
                  {LINES.map((l) => <option key={l} value={l}>{POSITION_LABELS[l]}</option>)}
                </select>
              </div>
            </div>
            <div className="input-group">
              <label>부 포지션</label>
              <select className="input" value={playerSubPosition} onChange={(e) => setPlayerSubPosition(e.target.value)}>
                <option value="">없음</option>
                {LINES.map((l) => <option key={l} value={l}>{POSITION_LABELS[l]}</option>)}
              </select>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              라인별 기준 점수는 룰북 3-2 기준 점수표에서 티어에 맞춰 자동 계산됩니다.
            </p>
            <div className="input-group">
              <label>모스트 챔피언</label>
              <input className="input" placeholder="예: 야스오, 제드, 리신" value={playerChampions}
                onChange={(e) => setPlayerChampions(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowAddPlayer(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleAddPlayer}>추가</button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Assign Modal */}
      {showManualAssign && (
        <div className="modal-overlay" onClick={() => setShowManualAssign(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>⚡ 선수 수동 배정</h2>
            <div className="input-group">
              <label>대상 선수</label>
              <select
                className="input"
                value={manualAssignPlayerId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setManualAssignPlayerId(id);
                  const picked = players.find(p => p.id === id);
                  setManualAssignPosition(picked?.mainPosition || '');
                }}
              >
                <option value="">선수 선택 (대기/유찰 상태만)</option>
                {players.filter(p => !p.isCaptain && (p.status === 'AVAILABLE' || p.status === 'UNSOLD')).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.summonerName}) - 주 {POSITION_LABELS[p.mainPosition] || p.mainPosition} {p.mainScore ?? '-'}P
                    {p.subPosition ? ` / 부 ${POSITION_LABELS[p.subPosition]} ${p.subScore ?? '-'}P` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label>대상 팀</label>
              <select className="input" value={manualAssignTeamId} onChange={(e) => setManualAssignTeamId(Number(e.target.value))}>
                <option value="">팀 선택</option>
                {teams.filter(t => t.remainingSlots > 0).map(t => (
                  <option key={t.id} value={t.id}>{t.name} (잔여: {t.remainingPoints}P, 빈 라인: {t.openLines.map(l => POSITION_LABELS[l]).join('·')})</option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label>배정 라인</label>
              <select className="input" value={manualAssignPosition} onChange={(e) => setManualAssignPosition(e.target.value)}>
                <option value="">라인 선택</option>
                {(manualAssignTeam ? manualAssignTeam.openLines : [...LINES]).map(l => (
                  <option key={l} value={l}>
                    {POSITION_LABELS[l]} — 기준 {manualAssignPlayer?.lineScores?.[l] ?? '-'}P
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label>프리미엄가</label>
              <input type="number" className="input" placeholder="예: 5" value={manualAssignPremium} onChange={(e) => setManualAssignPremium(Number(e.target.value))} />
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              차감 포인트: <strong style={{ color: 'var(--gold)' }}>{manualAssignFinal}P</strong>
              {' '}(기준 {manualAssignBase} {Number(manualAssignPremium || 0) >= 0 ? `+${Number(manualAssignPremium || 0)}` : Number(manualAssignPremium || 0)})
            </p>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowManualAssign(false)}>취소</button>
              <button className="btn btn-warning" onClick={handleManualAssign}>강제 배정</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="container"><div className="empty-state"><p>로딩 중...</p></div></div>}>
      <AdminContent />
    </Suspense>
  );
}
