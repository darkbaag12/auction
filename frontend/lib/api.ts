const getApiBase = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:8080/api`;
  }
  return 'http://localhost:8080/api';
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}${url}`, {
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null as T;
  const text = await res.text();
  return text && text.trim() ? JSON.parse(text) : (null as T);
}

export const api = {
  // Tournament
  createTournament: (data: { name: string; totalPoints: number; bidUnit: number; maxTeamSize: number; premiumCap?: number }) =>
    request('/tournaments', { method: 'POST', body: JSON.stringify(data) }),

  getTournaments: () =>
    request('/tournaments'),

  deleteTournament: (id: number) =>
    request(`/tournaments/${id}`, { method: 'DELETE' }),

  getTournament: (id: number) =>
    request(`/tournaments/${id}`),

  getLatestTournament: () =>
    request('/tournaments/latest'),

  verifyAccessCode: (id: number, code: string) =>
    request(`/tournaments/${id}/verify-code`, { method: 'POST', body: JSON.stringify({ code }) }),

  setAccessCode: (id: number, code: string) =>
    request(`/tournaments/${id}/access-code`, { method: 'PUT', body: JSON.stringify({ code }) }),
  // Team
  createTeam: (tournamentId: number, data: { name: string; captainName: string; captainPosition?: string; startingPoints?: number }) =>
    request(`/tournaments/${tournamentId}/teams`, { method: 'POST', body: JSON.stringify(data) }),

  updateTeam: (
    tournamentId: number,
    teamId: number,
    data: { name?: string; captainName?: string; captainPosition?: string; remainingPoints?: number },
  ) => request(`/tournaments/${tournamentId}/teams/${teamId}`, { method: 'PUT', body: JSON.stringify(data) }),

  getTeams: (tournamentId: number) =>
    request(`/tournaments/${tournamentId}/teams`),

  deleteTeam: (tournamentId: number, teamId: number) =>
    request(`/tournaments/${tournamentId}/teams/${teamId}`, { method: 'DELETE' }),

  // Player
  // Player
  createPlayer: (tournamentId: number, data: unknown) =>
    request(`/tournaments/${tournamentId}/players`, { method: 'POST', body: JSON.stringify(data) }),

  manualAssignPlayer: (
    tournamentId: number,
    data: { playerId: number; teamId: number; position?: string; premium?: number; amount?: number },
  ) =>
    request(`/tournaments/${tournamentId}/players/manual-assign`, { method: 'POST', body: JSON.stringify(data) }),

  createPlayersBulk: (tournamentId: number, data: unknown[]) =>
    request(`/tournaments/${tournamentId}/players/bulk`, { method: 'POST', body: JSON.stringify(data) }),

  deleteAllPlayers: (tournamentId: number) =>
    request(`/tournaments/${tournamentId}/players`, { method: 'DELETE' }),

  importPlayersFromExcel: async (tournamentId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${getApiBase()}/tournaments/${tournamentId}/players/import`, {
      method: 'POST',
      body: formData,
      // Do not set Content-Type header; fetch will set it automatically with boundary for FormData
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${res.status}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },

  getPlayers: (tournamentId: number) =>
    request(`/tournaments/${tournamentId}/players`),

  // Auction
  startAuction: (tournamentId: number, data: { playerId: number; premiumCap?: number }) =>
    request(`/tournaments/${tournamentId}/auction/start`, { method: 'POST', body: JSON.stringify(data) }),

  /** 낙찰팀 팀장이 라인을 선언한다 (룰북 4-3) */
  assignLine: (roundId: number, teamId: number, position: string) =>
    request('/auction/assign', { method: 'POST', body: JSON.stringify({ roundId, teamId, position }) }),

  closeAuction: (roundId: number, winningTeamId?: number) =>
    request('/auction/close', { method: 'POST', body: JSON.stringify({ roundId, winningTeamId }) }),

  passAuction: (roundId: number) =>
    request('/auction/pass', { method: 'POST', body: JSON.stringify({ roundId }) }),

  getActiveRound: (tournamentId: number) =>
    request(`/tournaments/${tournamentId}/auction/active`),

  getBidHistory: (roundId: number) =>
    request(`/auction/${roundId}/bids`),

  getAuctionHistory: (tournamentId: number) =>
    request(`/tournaments/${tournamentId}/auction/history`),

  rollbackAuction: (roundId: number) =>
    request(`/auction/${roundId}/rollback`, { method: 'DELETE' }),

  rollbackLastBid: (roundId: number) =>
    request(`/auction/${roundId}/bids/latest`, { method: 'DELETE' }),
};
