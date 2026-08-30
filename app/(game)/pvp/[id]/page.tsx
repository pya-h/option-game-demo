import MatchRoom from "@/components/MatchRoom";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatchRoom matchId={parseInt(id, 10)} />;
}
