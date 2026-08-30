"use client";

import type { Member } from "@/lib/protocol";
import { formatGB, formatTok } from "@/lib/utils";

export function Constellation({
  members,
  selfId,
}: {
  members: Member[];
  selfId: string;
}) {
  const nodes = members.length ? members : [];
  const w = 360;
  const h = 220;
  const cx = w / 2;
  const cy = h / 2 + 4;
  const r = 78;

  return (
    <div className="sheet overflow-hidden p-6" data-testid="constellation">
      <div className="mb-1 flex items-center justify-between">
        <p className="label">Swarm</p>
        <p className="text-sm text-violet-soft">{members.filter((m) => m.online).length} live</p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mx-auto h-[200px] w-full max-w-md">
        <defs>
          <radialGradient id="hiveGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7c5cff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r + 28} fill="url(#hiveGlow)" />
        <circle cx={cx} cy={cy} r={r + 14} fill="none" stroke="#2a2833" />
        <circle cx={cx} cy={cy} r={26} fill="#14141a" stroke="#7c5cff" strokeWidth="1.4" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#9b87ff" fontSize="11" fontFamily="Plus Jakarta Sans, sans-serif">
          HIVE
        </text>
        {nodes.map((m, i) => {
          const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(nodes.length, 1);
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          const next = nodes[(i + 1) % nodes.length];
          const a2 = -Math.PI / 2 + (2 * Math.PI * ((i + 1) % nodes.length)) / Math.max(nodes.length, 1);
          const x2 = cx + Math.cos(a2) * r;
          const y2 = cy + Math.sin(a2) * r;
          const sharingLink = m.sharing && next?.sharing;
          return (
            <g key={m.id}>
              <line
                x1={x}
                y1={y}
                x2={x2}
                y2={y2}
                stroke={sharingLink ? "#7c5cff" : "#2a2833"}
                strokeWidth={sharingLink ? 1.6 : 0.7}
                opacity={0.8}
              />
              <circle
                cx={x}
                cy={y}
                r={m.sharing ? 11 : 8}
                fill={m.sharing ? "#7c5cff" : "#2a2833"}
                className={m.sharing ? "animate-node" : undefined}
              />
              {m.id === selfId ? (
                <circle cx={x} cy={y} r={16} fill="none" stroke="#9b87ff" strokeDasharray="3 3" />
              ) : null}
              <text
                x={x}
                y={y + 26}
                textAnchor="middle"
                fill="#f4f1fb"
                fontSize="10"
                fontFamily="Plus Jakarta Sans, sans-serif"
              >
                {m.name}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 divide-y divide-line text-sm">
        {members.length === 0 ? (
          <li className="py-3 text-muted">Waiting for the first person to walk in.</li>
        ) : (
          members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p>
                  {m.name}
                  {m.id === selfId ? <span className="ml-2 text-xs text-violet-soft">you</span> : null}
                </p>
                <p className="text-xs text-muted">
                  {m.kind} · {formatGB(m.vramMB)}
                  {m.layers ? ` · layers ${m.layers[0]}–${m.layers[1] - 1}` : m.sharing ? " · sharing" : " · watching"}
                </p>
              </div>
              <div className="text-right text-xs">
                <p className={m.sharing ? "font-semibold text-violet-soft" : "text-locked"}>
                  {m.sharing ? "contributor" : "member"}
                </p>
                <p className="text-muted">
                  {formatTok(m.tokPerSec)} · {m.earnedSession.toFixed(1)} cr
                </p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
