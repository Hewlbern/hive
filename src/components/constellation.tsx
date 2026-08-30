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
  const h = 260;
  const cx = w / 2;
  const cy = h / 2;
  const r = 88;

  return (
    <div className="hive-panel overflow-hidden rounded-3xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Swarm</p>
        <p className="font-mono text-[11px] text-honey">{members.filter((m) => m.online).length} live</p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mx-auto h-[220px] w-full max-w-md">
        <circle cx={cx} cy={cy} r={r + 18} fill="none" stroke="#2a2f22" />
        <circle cx={cx} cy={cy} r={28} fill="#1a1e14" stroke="#f5b042" strokeWidth="1.2" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#f5b042" fontSize="11" fontFamily="IBM Plex Mono, monospace">
          HIVE
        </text>
        {nodes.map((m, i) => {
          const a = (-Math.PI / 2 + (2 * Math.PI * i) / Math.max(nodes.length, 1));
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
                stroke={sharingLink ? "#3dffe8" : "#2a2f22"}
                strokeWidth={sharingLink ? 1.4 : 0.6}
                opacity={sharingLink ? 0.7 : 0.5}
              />
              <circle
                cx={x}
                cy={y}
                r={m.sharing ? 11 : 8}
                fill={m.sharing ? "#f5b042" : "#2a2f22"}
                className={m.sharing ? "animate-node" : undefined}
              />
              {m.id === selfId ? (
                <circle cx={x} cy={y} r={15} fill="none" stroke="#3dffe8" strokeDasharray="2 2" />
              ) : null}
              <text
                x={x}
                y={y + 24}
                textAnchor="middle"
                fill="#f4efe4"
                fontSize="10"
                fontFamily="IBM Plex Mono, monospace"
              >
                {m.name}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-2 divide-y divide-line text-sm">
        {members.length === 0 ? (
          <li className="py-3 text-muted">Waiting for the first person to walk in.</li>
        ) : (
          members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-ink">
                  {m.name}
                  {m.id === selfId ? <span className="ml-2 text-xs text-teal">you</span> : null}
                </p>
                <p className="font-mono text-[11px] text-muted">
                  {m.kind} · {formatGB(m.vramMB)}
                  {m.webgpu ? " · WebGPU" : " · CPU"}
                  {m.layers ? ` · layers ${m.layers[0]}–${m.layers[1] - 1}` : m.sharing ? " · sharing" : " · watching"}
                </p>
              </div>
              <div className="text-right font-mono text-[11px]">
                <p className={m.sharing ? "text-honey" : "text-locked"}>{m.sharing ? "contributor" : "member"}</p>
                <p className="text-muted">
                  {formatTok(m.tokPerSec)} · ₳{m.earnedSession.toFixed(1)}
                </p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
