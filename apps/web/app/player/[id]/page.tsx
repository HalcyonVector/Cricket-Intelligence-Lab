import { getPlayer } from "@/lib/api";
import { StatTile } from "@/components/StatTile";
import { PhaseStrip } from "@/components/charts/PhaseStrip";

export default async function PlayerPage({ params }: { params: { id: string } }) {
  const { data, meta } = await getPlayer(params.id);
  const overall = data.batting?.find((b: any) => b.split === "overall");
  const phases = (data.batting ?? []).filter((b: any) => b.split?.startsWith("phase"));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Player Intelligence · {params.id}</h1>
      {meta.low_confidence && (
        <div className="text-warn text-sm">Low sample ({meta.sample?.balls} balls) — interpret with caution.</div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Runs" value={overall?.runs ?? "—"} />
        <StatTile label="Average" value={overall?.avg ?? "—"} />
        <StatTile label="Strike Rate" value={overall?.strike_rate ?? "—"} />
        <StatTile label="Boundary %" value={overall?.boundary_pct ?? "—"} sub="of balls faced" />
      </div>
      {phases.length > 0 && <PhaseStrip data={phases} />}
    </div>
  );
}
