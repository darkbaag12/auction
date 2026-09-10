'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const ADMIN_PASSWORD = 'qwer704312!';

export default function HomePage() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Admin password gate state
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');

  useEffect(() => {
    async function fetchTournaments() {
      try {
        const ts: any = await api.getTournaments();
        if (ts && ts.length > 0) {
          setTournaments(ts);
          setSelectedTournamentId(ts[ts.length - 1].id);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchTournaments();
  }, []);

  useEffect(() => {
    async function fetchTeams() {
      if (!selectedTournamentId || selectedTournamentId === -1) {
        setTeams([]);
        return;
      }
      try {
        const tm: any = await api.getTeams(selectedTournamentId);
        setTeams(tm);
      } catch (err) {
        console.error(err);
      }
    }
    fetchTeams();
  }, [selectedTournamentId]);

  const handleAdminSubmit = () => {
    if (adminPassword === ADMIN_PASSWORD) {
      sessionStorage.setItem('admin_auth', 'true');
      if (!selectedTournamentId || selectedTournamentId === -1) {
        window.location.href = '/admin?new=true';
      } else {
        window.location.href = `/admin?tournamentId=${selectedTournamentId}`;
      }
    } else {
      setAdminError('비밀번호가 틀렸습니다.');
      setAdminPassword('');
    }
  };

  const handleCaptainEnter = () => {
    if (!selectedTournamentId || selectedTournamentId === -1) {
      alert('대회를 먼저 선택해주세요.');
      return;
    }
    if (!selectedTeamId) {
      alert('팀을 선택해주세요.');
      return;
    }
    window.location.href = `/auction?tournamentId=${selectedTournamentId}&role=CAPTAIN&teamId=${selectedTeamId}`;
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '420px', textAlign: 'center', padding: '48px 40px' }}>
        <div
          style={{ marginBottom: '16px', cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'center' }}
          onClick={() => setShowAdminModal(true)}
          title="관리자 입장"
        >
          <img src="/exp-logo.png" alt="ExP Logo" style={{ height: '80px', width: 'auto' }} />
        </div>
        <h2 style={{ fontSize: '1.6rem', fontWeight: '800', marginBottom: '8px' }}>ExP 팀 경매 프로그램</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '0.95rem' }}>
          대회를 선택하고 팀장으로 입장하세요.
        </p>

        {/* Tournament Selector */}
        <div className="input-group" style={{ marginBottom: '16px', textAlign: 'left' }}>
          <label style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>대회 선택</label>
          <select
            className="input"
            value={selectedTournamentId || ''}
            onChange={(e) => {
              setSelectedTournamentId(Number(e.target.value));
              setSelectedTeamId(null);
            }}
            style={{ padding: '12px 16px', fontSize: '1rem', marginBottom: '8px' }}
          >
            <option value="">대회를 선택하세요</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <label style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>소속 팀 선택</label>
          <select
            className="input"
            value={selectedTeamId || ''}
            onChange={(e) => setSelectedTeamId(Number(e.target.value))}
            style={{ padding: '12px 16px', fontSize: '1rem' }}
            disabled={!selectedTournamentId}
          >
            <option value="">팀을 선택하세요</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name === t.captainName ? t.name : `${t.name} (팀장: ${t.captainName})`}</option>
            ))}
          </select>
        </div>

        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
          onClick={handleCaptainEnter}
          disabled={!selectedTournamentId || !selectedTeamId}
        >
          👥 팀장으로 입장
        </button>
      </div>

      {/* Admin Password Modal */}
      {showAdminModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div className="card" style={{ width: '100%', maxWidth: '360px', padding: '36px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔐</div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '8px' }}>관리자 인증</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '24px' }}>비밀번호를 입력하세요.</p>

            {/* Tournament selector inside admin modal */}
            <div className="input-group" style={{ marginBottom: '12px', textAlign: 'left' }}>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>대회 선택</label>
              <select
                className="input"
                value={selectedTournamentId || -1}
                onChange={(e) => setSelectedTournamentId(Number(e.target.value))}
                style={{ padding: '10px 14px', fontSize: '0.95rem' }}
              >
                <option value={-1}>➕ 새로운 대회 만들기</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <input
              type="password"
              className="input"
              placeholder="비밀번호"
              value={adminPassword}
              onChange={(e) => { setAdminPassword(e.target.value); setAdminError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdminSubmit(); }}
              style={{ padding: '12px 16px', fontSize: '1rem', marginBottom: '8px' }}
              autoFocus
            />
            {adminError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '8px' }}>{adminError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={() => { setShowAdminModal(false); setAdminPassword(''); setAdminError(''); }}
              >
                취소
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={handleAdminSubmit}
              >
                입장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
