import { CFG } from "./config";

/**
 * The subset of game config the UI needs. Built on the server and shipped inside the
 * state payload — client bundles can't read the server env, so reading CFG directly in a
 * client component would silently fall back to defaults and quote the wrong numbers.
 */
export type PublicCfg = {
  optionEnergyCost: number;
  pvpEnergyCost: number;
  energyRefillSeconds: number;
  initialEnergyCapacity: number;
  successfulOptionXp: number;
  premiumOptPerDollar: number;
  exerciseOptPerDollar: number;
  exercisePayoutMode: "market" | "strike";
  portfolioToOptRatio: number;
  energyCellPrices: number[];
  energyCellStep: number;
  energyChargePrice: number;
  pvpInitialOpt: number;
  pvpWinXp: number;
  pvpWinOpt: number;
  pvpWinPortfolio: number;
};

export function publicCfg(): PublicCfg {
  return {
    optionEnergyCost: CFG.OPTION_ENERGY_COST,
    pvpEnergyCost: CFG.PVP_ENERGY_COST,
    energyRefillSeconds: CFG.ENERGY_REFILL_SECONDS,
    initialEnergyCapacity: CFG.INITIAL_ENERGY_CAPACITY,
    successfulOptionXp: CFG.SUCCESSFUL_OPTION_XP,
    premiumOptPerDollar: CFG.PREMIUM_OPT_PER_DOLLAR,
    exerciseOptPerDollar: CFG.EXERCISE_OPT_PER_DOLLAR,
    exercisePayoutMode: CFG.EXERCISE_PAYOUT_MODE,
    portfolioToOptRatio: CFG.PORTFOLIO_TO_OPT_RATIO,
    energyCellPrices: CFG.ENERGY_CELL_PRICES,
    energyCellStep: CFG.ENERGY_CELL_STEP,
    energyChargePrice: CFG.ENERGY_CHARGE_PRICE,
    pvpInitialOpt: CFG.PVP_INITIAL_OPT,
    pvpWinXp: CFG.PVP_WIN_XP,
    pvpWinOpt: CFG.PVP_WIN_OPT_REWARD,
    pvpWinPortfolio: CFG.PVP_WIN_PORTFOLIO_REWARD,
  };
}
