const BASE = process.env.NEXT_PUBLIC_API ?? "http://localhost:8000";

export async function getPlayer(id: string, format = "ipl") {
  const r = await fetch(`${BASE}/v1/players/${id}?format=${format}`, { next: { revalidate: 3600 } });
  if (!r.ok) throw new Error("player fetch failed");
  return r.json();
}
export async function searchPlayers(q: string) {
  const r = await fetch(`${BASE}/v1/players?q=${encodeURIComponent(q)}`);
  return r.json();
}
