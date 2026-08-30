"use server";

/** Authenticated entry points for the store. Rules live in lib/game/store.ts. */
import type { Res } from "@/lib/game/guard";
import {
  buyCapacityChipFor,
  buyEnergyCellFor,
  buyEnergyChargeFor,
  convertPortfolioToOptFor,
} from "@/lib/game/store";
import { requireMe } from "@/lib/session";

export async function convertPortfolioToOpt(usdAmount: number): Promise<Res> {
  return convertPortfolioToOptFor((await requireMe()).id, usdAmount);
}

export async function buyEnergyCell(): Promise<Res> {
  return buyEnergyCellFor((await requireMe()).id);
}

export async function buyCapacityChip(): Promise<Res> {
  return buyCapacityChipFor((await requireMe()).id);
}

export async function buyEnergyCharge(): Promise<Res> {
  return buyEnergyChargeFor((await requireMe()).id);
}
