export function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="tile">
      <div className="text-muted text-xs uppercase tracking-wide">{label}</div>
      <div className="stat-num text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-muted text-xs mt-1">{sub}</div>}
    </div>
  );
}
