"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Coins,
  Flame,
  Lock,
  Radar,
  Star,
  Store,
  Swords,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { EXERCISE_WINDOWS, XP_LEVEL_BASE } from "@/lib/config";
import { duration, num } from "@/lib/fmt";
import { useGame } from "@/components/GameProvider";

/**
 * The guide.
 *
 * Written for someone who has just signed in and wants to play, not for someone auditing the
 * rules — so every number comes from the live config rather than being typed into prose that
 * would drift the first time a value is tuned. Aimed at a five to ten minute read: past that
 * it stops being read, and a player who can then play is the only measure that matters.
 */
export default function GuidePage() {
  const { state } = useGame();
  const cfg = state?.cfg;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header>
        <h1 className="text-2xl font-semibold">📖 How to play</h1>
        <p className="mt-2 text-sm leading-relaxed text-mute">
          OPT is a game about being right, and then about what you do next. You mint option
          cards against real crypto prices, and the market decides. Everything below takes about
          five minutes.
        </p>
        <p className="mt-2 rounded-xl border border-edge bg-black/25 px-3 py-2 text-[11px] leading-relaxed text-mute">
          Nothing here is real. No wallets, no chain, no money. Real prices are used only as the
          external referee that decides whether an option wins.
        </p>
      </header>

      <Section n={1} title="Four resources" icon={Coins}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Res icon={Coins} tone="text-buy" name="OPT" line="The currency.">
            Pays premiums when you mint a Buy card, is earned when you write a Sell card, and is
            burned to claim a win.
          </Res>
          <Res icon={Wallet} tone="text-mint" name="Portfolio" line="Your score, and your money.">
            This is the awkward one on purpose: it&apos;s what ranks you <em>and</em> what you
            spend. Every purchase costs you position.
          </Res>
          <Res icon={Zap} tone="text-gold" name="Energy" line="The throttle.">
            One per card minted. Refills on its own, {cfg ? `+1 every ${Math.round(cfg.energyRefillSeconds / 60)} min` : "over time"}.
            Entering a match costs {cfg?.pvpEnergyCost ?? "a chunk"}.
          </Res>
          <Res icon={Star} tone="text-sell" name="XP" line="Pure progression.">
            A correct call pays XP <em>even if you never claim it</em>. XP is never spent, so it
            only ever goes up — and it&apos;s what raises your level.
          </Res>
        </div>
      </Section>

      <Section n={2} title="The loop" icon={ArrowRight}>
        <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-edge bg-black/25 p-4 text-center text-[11px]">
          {["Mint a card", "Market moves", "It expires", "Claim the win", "Spend or climb"].map(
            (s, i, all) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="rounded-lg border border-buy/40 bg-buy/10 px-2.5 py-1.5 text-buy">
                  {s}
                </span>
                {i < all.length - 1 && <ArrowRight size={12} className="text-mute" />}
              </span>
            )
          )}
        </div>
        <P>
          Spend Energy and OPT to mint a card. Keep it, or list it for another player to buy.
          When it expires the game settles it against the live price. A correct call pays XP
          immediately; claiming it converts the win into Portfolio. Then you spend that Portfolio
          on cards, Energy or more OPT — and every dollar you spend drops you down the board.
        </P>
      </Section>

      <Section n={3} title="Two kinds of card" icon={TrendingUp}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card tone="buy" icon={TrendingUp} title="Buy Option">
            <P small>
              You pay an OPT premium for the right to buy above a strike price. If the price
              finishes <b className="text-buy">above</b> your strike, you win. If not, the card
              expires worthless and you&apos;ve lost the premium — nothing more.
            </P>
            <P small>
              Your risk is capped at what you paid. Selling the card hands the whole position to
              someone else for Portfolio.
            </P>
          </Card>
          <Card tone="sell" icon={TrendingDown} title="Sell Option">
            <P small>
              You <em>receive</em> an OPT premium for taking on an obligation, backed by locked
              Portfolio collateral. If the price finishes at or below the strike, you keep
              everything and the collateral unlocks.
            </P>
            <P small>
              If it finishes above, you pay the difference out of that collateral — capped, so
              you can never go negative.
            </P>
          </Card>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2.5">
          <Lock size={13} className="mt-0.5 shrink-0 text-gold" />
          <P small>
            Handing off a Sell card transfers the <b>obligation</b>, not an asset. The new owner
            locks their own collateral and <em>you pay them</em> a takeover premium to take it.
            That&apos;s why the whole premium history of every card is public — check what a card
            has cost its previous owners before you assume it.
          </P>
        </div>
      </Section>

      <Section n={4} title="Where the premium comes from" icon={Flame}>
        <P>
          You never set your own premium — that would let anyone mint free wins. The engine
          prices every card from two parts:
        </P>
        <pre className="my-3 overflow-x-auto rounded-xl border border-edge bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
{`intrinsic  = how far in the money it already is
time value = room left for the price to move
premium    = (intrinsic + time value) × ${cfg?.premiumOptPerDollar ?? 5}`}
        </pre>
        <P>
          Three levers move it. A strike closer to spot costs more, because it&apos;s likelier to
          land. A bigger amount costs proportionally more — exactly linear, no surprises. A
          longer expiry costs more, but far less than you&apos;d expect: an hour costs roughly
          twice what two minutes does, not twenty times. Volatile assets like DOGE cost more than
          BTC for the same shape of bet.
        </P>
      </Section>

      <Section n={5} title="Claiming a win, and the window" icon={Timer}>
        <P>
          When a Buy card wins you get the XP straight away — that part is yours no matter what.
          Claiming it is separate: you burn OPT equal to the full strike value and receive the
          market value in Portfolio. The profit is the difference, exactly like a real call.
        </P>
        <P>
          <b className="text-gold">You don&apos;t have forever.</b> A win can only be claimed for
          a window after it settles, scaled to how long the card ran:
        </P>
        <div className="my-3 overflow-x-auto">
          <table className="w-full min-w-[320px] border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-mute">
                <th className="border-b border-edge px-2 py-1.5 font-normal">Card ran for</th>
                <th className="border-b border-edge px-2 py-1.5 font-normal">Claim within</th>
              </tr>
            </thead>
            <tbody className="font-mono text-slate-300">
              {EXERCISE_WINDOWS.map((w) => (
                <tr key={w.maxExpiry}>
                  <td className="border-b border-edge/40 px-2 py-1.5">
                    up to {duration(w.maxExpiry)}
                  </td>
                  <td className="border-b border-edge/40 px-2 py-1.5 text-gold">
                    {duration(w.window)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-2 py-1.5">longer</td>
                <td className="px-2 py-1.5 text-gold">
                  {duration(cfg?.maxExerciseWindowSeconds ?? 21600)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <P>
          Miss it and the card is marked <b>LAPSED</b>. It still counts as a win and you keep the
          XP — you just can&apos;t convert it any more. The card shows a countdown while the
          window is open.
        </P>
        <P>
          Short of OPT to claim? The button offers to burn the shortfall out of Portfolio first.
          It asks before it does, because that Portfolio is your rank.
        </P>
      </Section>

      <Section n={6} title="Levels" icon={Star}>
        <P>
          XP raises your level. The first costs {num(XP_LEVEL_BASE, 0)} XP and each one after
          costs more than the last. Levels are pure upside — nothing is ever spent:
        </P>
        <ul className="my-2 space-y-1.5 text-xs text-slate-300">
          <Li>
            <b className="text-gold">Every level</b> — +1 maximum Energy.
          </Li>
          <Li>
            <b className="text-gold">Every 5th level</b> — Energy refills faster, and your OPT
            drops get bigger.
          </Li>
        </ul>
        <P>
          Those drops are the safety net: a small amount of OPT arrives periodically so a player
          with nothing still has a way back in. It only runs while you&apos;re actually playing —
          stop for {cfg?.optDripIdleDays ?? 7} days and it pauses until you come back.
        </P>
      </Section>

      <Section n={7} title="The marketplace" icon={Store}>
        <P>
          Any live card can be listed. A Buy card lists at its computed value by default, because
          the engine already knows what it&apos;s worth — you can override that if you want to
          ask above or below. The For Sale board rates every ask against fair value, so an
          overpriced card looks overpriced.
        </P>
        <P>
          The Store sells Energy capacity, refills, bigger OPT drops, and OPT itself. All of it
          costs Portfolio, which means all of it costs rank. That&apos;s the trade the whole game
          turns on.
        </P>
      </Section>

      <Section n={8} title="PvP" icon={Swords}>
        <P>
          A match is a sealed economy. Everyone starts with identical PvP OPT and $0 PvP
          Portfolio, so months of progress buy no advantage — only the play inside the match
          counts. Entry costs Energy from the main game; inside, Energy doesn&apos;t exist and OPT
          is your only limit. Match cards never touch your global ones.
        </P>
        <P>
          Invite people by username, or press <b className="text-buy">Quick Match</b>{" "}
          <Radar size={12} className="inline text-buy" /> and get paired at random. You&apos;re
          only ever grouped with players who asked for the same size and length. Searching is
          free — Energy is charged the instant a match forms, never for waiting.
        </P>
        <P>
          Ranking is by final PvP Portfolio, and the winner takes a small fixed global reward, so
          one big match can&apos;t distort the main economy.
        </P>
      </Section>

      <Section n={9} title="Two leaderboards" icon={Trophy}>
        <P>
          <b className="text-mint">Portfolio</b> is wealth you built and <em>kept</em>. Spending
          drops you, so a high Portfolio rank means restraint as much as skill.{" "}
          <b className="text-sell">XP</b> only accumulates, and rewards being right regardless of
          what you did about it.
        </P>
        <P>
          They pull in opposite directions, and that&apos;s the design. Topping both means winning
          often and spending almost nothing — which also means never upgrading. Choose.
        </P>
      </Section>

      <div className="flex flex-wrap gap-3 pt-2">
        <Link href="/home" className="btn btn-primary">
          Mint your first card <ArrowRight size={14} className="ml-1 inline" />
        </Link>
        <Link href="/cards" className="btn btn-ghost">
          See what&apos;s on the market
        </Link>
      </div>
    </div>
  );
}

function Section({
  n,
  title,
  icon: Icon,
  children,
}: {
  n: number;
  title: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    // Animated in on mount, not on scroll. A whileInView entrance leaves everything below the
    // fold at opacity 0 until an IntersectionObserver fires — which is a fine trick for
    // decoration and a bad one for the page whose entire job is to be read.
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 26, delay: Math.min(n * 0.05, 0.4) }}
      className="panel p-5"
    >
      <h2 className="mb-3 flex items-center gap-2.5 font-semibold">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-buy/15 font-mono text-xs text-buy">
          {n}
        </span>
        <Icon size={16} className="text-mute" />
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

const P = ({ children, small }: { children: React.ReactNode; small?: boolean }) => (
  <p className={`${small ? "text-[11px]" : "text-xs"} mt-2 leading-relaxed text-mute first:mt-0`}>
    {children}
  </p>
);

const Li = ({ children }: { children: React.ReactNode }) => (
  <li className="flex gap-2">
    <span className="text-buy">·</span>
    <span className="text-mute">{children}</span>
  </li>
);

function Res({
  icon: Icon,
  tone,
  name,
  line,
  children,
}: {
  icon: any;
  tone: string;
  name: string;
  line: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-edge bg-black/25 p-3">
      <div className="mb-1 flex items-center gap-2">
        <Icon size={14} className={tone} />
        <span className={`font-semibold ${tone}`}>{name}</span>
        <span className="text-[11px] text-mute">{line}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-mute">{children}</p>
    </div>
  );
}

function Card({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "buy" | "sell";
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  const c = tone === "buy" ? "border-buy/40 text-buy" : "border-sell/40 text-sell";
  return (
    <div className={`rounded-xl border bg-black/25 p-3.5 ${c.split(" ")[0]}`}>
      <div className={`mb-1.5 flex items-center gap-2 font-semibold ${c.split(" ")[1]}`}>
        <Icon size={15} />
        {title}
      </div>
      {children}
    </div>
  );
}
