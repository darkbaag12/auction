'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:8080/ws`;
  }
  return 'http://localhost:8080/ws';
};

export interface WsMessage {
  type: string;
  data: unknown;
}

export function useWebSocket(
  tournamentId: number | null,
  role?: 'HOST' | 'CAPTAIN' | null,
  teamId?: number | null,
  onConnectError?: (errorMsg: string) => void,
) {
  const clientRef = useRef<Client | null>(null);
  const [connected, setConnected] = useState(false);

  /**
   * 받은 메시지를 큐에 쌓아두고, 소비하는 쪽에서 한 번에 비운다.
   *
   * 상태 슬롯 하나에 마지막 메시지만 담으면 메시지가 유실된다.
   * SockJS는 여러 STOMP 프레임을 한 전송 단위에 묶어 보낼 수 있고, 그러면
   * setState가 같은 tick에서 배칭되어 마지막 것만 렌더에 반영된다.
   * 입찰 한 번에 NEW_BID + ROUND_UPDATE가 연달아 오는 구조라
   * 이 경우 NEW_BID(누가 얼마에 걸었는지)가 통째로 씹힌다.
   */
  const queueRef = useRef<WsMessage[]>([]);
  const [messageVersion, setMessageVersion] = useState(0);

  /** 쌓인 메시지를 순서대로 꺼내고 큐를 비운다. */
  const drainMessages = useCallback((): WsMessage[] => {
    if (queueRef.current.length === 0) return [];
    const pending = queueRef.current;
    queueRef.current = [];
    return pending;
  }, []);

  // 콜백은 렌더마다 새로 만들어지므로 ref로 최신 것을 들고 있는다
  const onConnectErrorRef = useRef(onConnectError);
  onConnectErrorRef.current = onConnectError;

  useEffect(() => {
    if (!tournamentId) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(getWsUrl()) as WebSocket,
      connectHeaders: {
        ...(role ? { role: role } : {}),
        ...(teamId ? { teamId: String(teamId) } : {}),
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: () => {
        setConnected(true);
        client.subscribe(`/topic/auction/${tournamentId}`, (message) => {
          const parsed: WsMessage = JSON.parse(message.body);
          queueRef.current.push(parsed);
          // 여러 번 호출돼 배칭되더라도 큐에는 전부 남아 있으므로 유실되지 않는다
          setMessageVersion((v) => v + 1);
        });
      },
      onDisconnect: () => {
        setConnected(false);
      },
      onStompError: (frame) => {
        console.error('STOMP error:', frame);
        const errorText = (frame.headers?.message || '') + (frame.body || '');
        if (errorText.includes('ALREADY_CONNECTED')) {
          client.deactivate(); // Stop reconnecting
          onConnectErrorRef.current?.('이미 접속 중인 팀장입니다. (중복 접속 불가)');
        }
      },
      onWebSocketError: (event) => {
        console.error('WebSocket Error', event);
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, [tournamentId, role, teamId]);

  const sendBid = useCallback((roundId: number, teamId: number, amount: number) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish({
        destination: '/app/bid',
        body: JSON.stringify({ roundId, teamId, amount }),
      });
    }
  }, []);

  const sendChatMessage = useCallback((tournamentId: number, teamId: number | null, message: string) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish({
        destination: '/app/chat',
        body: JSON.stringify({ tournamentId, teamId, message }),
      });
    }
  }, []);

  return { connected, messageVersion, drainMessages, sendBid, sendChatMessage };
}
