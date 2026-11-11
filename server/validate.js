// The server's score checks, before anything is signed. The plugin repeats the ones it can check on chain
// (ceiling, heights, ranges). There are no accounts, so this can't stop a determined cheater; it rejects scores the
// blocks of the run make impossible, and runs played faster than the chain.
import { MAX_KILLS_PER_BLOCK, MAX_MULT, MAX_POWER, maxScore } from '../public/rules.js';

export const INITIALS_RE = /^[A-Z0-9]{1,3}$/;
export const MIN_SECONDS_PER_BLOCK = 0.35; // blocks are 500ms; allows for jitter and catch-up bursts
const int = (v) => Number.isSafeInteger(v);

export function validateScore({ run, body, tip, now }) {
  if (!run) return { ok: false, error: 'unknown or already used run' };
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad body' };
  const initials = String(body.initials ?? '').toUpperCase().trim();
  if (!INITIALS_RE.test(initials)) return { ok: false, error: 'initials must be 1-3 letters or digits' };
  const { score, endHeight, kills, bestMultiplier, powerLevel } = body;
  if (![score, endHeight, kills, bestMultiplier, powerLevel].every(int)) return { ok: false, error: 'bad numbers' };
  if (endHeight <= run.startHeight || endHeight > tip) return { ok: false, error: 'endHeight must be after the start and not past the tip' };
  const blocks = endHeight - run.startHeight;
  if (score < 0 || score > maxScore(blocks)) return { ok: false, error: 'score is higher than those blocks allow' };
  if (kills < 0 || kills > blocks * MAX_KILLS_PER_BLOCK + 3) return { ok: false, error: 'more kills than invaders' };
  if (bestMultiplier < 1 || bestMultiplier > MAX_MULT) return { ok: false, error: 'bad multiplier' };
  if (powerLevel < 1 || powerLevel > MAX_POWER) return { ok: false, error: 'bad power level' };
  const seconds = (now - run.startedAt) / 1000;
  if (seconds < blocks * MIN_SECONDS_PER_BLOCK) return { ok: false, error: 'run was faster than the chain' };
  return { ok: true, fields: { initials, score, startHeight: run.startHeight, endHeight, kills, bestMultiplier, powerLevel } };
}
