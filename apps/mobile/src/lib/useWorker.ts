import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalRequest,
  ClientMessage,
  MachineSummary,
  ServerMessage,
  TurnUsage,
  WorkerNotification,
  Workspace,
} from "@ai-workspace/protocol";

export type ConnStatus = "connecting" | "connected" | "disconnected" | "unauthorized";

export interface ChatMsg {
  role: "user" | "agent" | "tool" | "reasoning";
  text: string;
  tool?: string;
  target?: string;
  usage?: TurnUsage;
}

export interface WorkerTarget {
  url: string;
  token: string;
}

export interface WorkerConn {
  status: ConnStatus;
  machine: MachineSummary | null;
  workspaces: Workspace[];
  /** Chat transcripts keyed by sessionId. */
  messages: Record<string, ChatMsg[]>;
  approvals: ApprovalRequest[];
  notices: WorkerNotification[];
  /** Whether a turn is currently running, keyed by workspaceId activeTask. */
  send: (workspaceId: string, sessionId: string, text: string) => void;
  resolveApproval: (id: string, approved: boolean) => void;
  openWorkspace: (path: string) => Promise<Workspace>;
  createSession: (workspaceId: string) => Promise<string>;
}

const CLIENT_ID = "otter-mobile";

/** Append streamed agent text to the trailing agent turn, or start one. */
function appendAgentDelta(prev: ChatMsg[], text: string): ChatMsg[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "agent") {
    return [...prev.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...prev, { role: "agent", text }];
}

function attachUsage(prev: ChatMsg[], usage: TurnUsage): ChatMsg[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i]!.role === "agent") {
      const next = [...prev];
      next[i] = { ...next[i]!, usage };
      return next;
    }
  }
  return prev;
}

/**
 * One live connection to a Worker over WebSocket.
 *
 * This is the mobile counterpart to the Desktop's multiplexer, pared down to a
 * single machine: it speaks the same wire protocol, authenticates with the
 * pairing code, and keeps just what a phone needs on screen — the machine, its
 * workspaces, the chat transcripts, and above all the approvals. It reconnects
 * on drop so the app survives the network flapping as you move around.
 */
export function useWorker(target: WorkerTarget | null): WorkerConn {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [machine, setMachine] = useState<MachineSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMsg[]>>({});
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [notices, setNotices] = useState<WorkerNotification[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const pending = useRef<Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>>(
    new Map(),
  );
  const reqSeq = useRef(0);

  const emit = useCallback((msg: ClientMessage) => {
    const sock = socketRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!target) return;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let unauthorized = false;

    const open = () => {
      setStatus("connecting");
      const sock = new WebSocket(target.url);
      socketRef.current = sock;

      sock.onopen = () => {
        sock.send(JSON.stringify({ type: "hello", clientId: CLIENT_ID, token: target.token } satisfies ClientMessage));
      };

      sock.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case "auth.result":
            if (msg.ok) {
              setStatus("connected");
              sock.send(JSON.stringify({ type: "subscribe", workerId: "local" } satisfies ClientMessage));
            } else {
              unauthorized = true;
              setStatus("unauthorized");
              sock.close();
            }
            break;
          case "machine":
            setMachine(msg.machine);
            break;
          case "workspaces":
            setWorkspaces(msg.items);
            break;
          case "workspace.opened":
          case "workspace.error":
          case "session.created": {
            const p = pending.current.get(msg.requestId);
            pending.current.delete(msg.requestId);
            if (msg.type === "workspace.error") p?.reject(new Error(msg.message));
            else if (msg.type === "workspace.opened") p?.resolve(msg.workspace);
            else p?.resolve(msg.sessionId);
            break;
          }
          case "chat.history":
            setMessages((m) => ({ ...m, [msg.sessionId]: msg.messages.map(toChatMsg) }));
            break;
          case "chat.delta":
            setMessages((m) => ({ ...m, [msg.sessionId]: appendAgentDelta(m[msg.sessionId] ?? [], msg.text) }));
            break;
          case "chat.tool":
            setMessages((m) => ({
              ...m,
              [msg.sessionId]: [...(m[msg.sessionId] ?? []), { role: "tool", text: "", tool: msg.tool, target: msg.target }],
            }));
            break;
          case "chat.reasoning":
            // Encrypted thinking arrives empty; ignore rather than show a blank.
            break;
          case "chat.usage":
            setMessages((m) => ({ ...m, [msg.sessionId]: attachUsage(m[msg.sessionId] ?? [], msg.usage) }));
            break;
          case "approval.request":
            setApprovals((a) => (a.some((x) => x.id === msg.request.id) ? a : [msg.request, ...a]));
            break;
          case "approval.resolved":
            setApprovals((a) => a.filter((x) => x.id !== msg.requestId));
            break;
          case "notification":
            setNotices((n) => [msg.notification, ...n].slice(0, 50));
            break;
          default:
            break;
        }
      };

      sock.onclose = () => {
        socketRef.current = null;
        if (disposed || unauthorized) return;
        setStatus("disconnected");
        retry = setTimeout(open, 1500);
      };
      sock.onerror = () => sock.close();
    };

    open();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [target?.url, target?.token]);

  const request = useCallback(
    <T,>(build: (requestId: string) => ClientMessage): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const requestId = `m${++reqSeq.current}`;
        pending.current.set(requestId, { resolve, reject });
        emit(build(requestId));
        setTimeout(() => {
          if (pending.current.delete(requestId)) reject(new Error("request timed out"));
        }, 15000);
      }),
    [emit],
  );

  const send = useCallback(
    (workspaceId: string, sessionId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((m) => ({
        ...m,
        [sessionId]: [...(m[sessionId] ?? []), { role: "user", text: trimmed }, { role: "agent", text: "" }],
      }));
      emit({ type: "chat.send", workspaceId, sessionId, text: trimmed });
    },
    [emit],
  );

  const resolveApproval = useCallback(
    (id: string, approved: boolean) => {
      setApprovals((a) => a.filter((x) => x.id !== id));
      emit({ type: "approval.resolve", requestId: id, approved });
    },
    [emit],
  );

  const openWorkspace = useCallback(
    (path: string) => request<Workspace>((requestId) => ({ type: "workspace.open", requestId, path })),
    [request],
  );

  const createSession = useCallback(
    (workspaceId: string) => request<string>((requestId) => ({ type: "session.create", requestId, workspaceId })),
    [request],
  );

  return { status, machine, workspaces, messages, approvals, notices, send, resolveApproval, openWorkspace, createSession };
}

function toChatMsg(t: {
  role: "user" | "agent" | "tool" | "reasoning";
  text: string;
  tool?: string;
  target?: string;
  usage?: TurnUsage;
}): ChatMsg {
  return { role: t.role, text: t.text, tool: t.tool, target: t.target, usage: t.usage };
}
