import { redirect } from "next/navigation";
import { GameProvider } from "@/components/GameProvider";
import Confetti from "@/components/Confetti";
import LevelUp from "@/components/LevelUp";
import LiveMatchBar from "@/components/LiveMatchBar";
import Nav from "@/components/Nav";
import PriceTicker from "@/components/PriceTicker";
import ResourceBar from "@/components/ResourceBar";
import Toaster from "@/components/Toaster";
import { currentUserId } from "@/lib/session";

export default async function GameLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentUserId())) redirect("/");

  return (
    <GameProvider>
      <div className="mx-auto flex min-h-screen max-w-[88rem] flex-col px-4 pb-16">
        <Nav />
        <LiveMatchBar />
        <PriceTicker />
        <ResourceBar />
        <main className="mt-5 flex-1">{children}</main>
        <footer className="mt-10 text-center text-[11px] text-mute">
          OPT is a game. Virtual assets only — nothing here is real money or real crypto.
        </footer>
      </div>
      <Toaster />
      <Confetti />
      <LevelUp />
    </GameProvider>
  );
}
