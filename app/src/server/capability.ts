// The capability model's SERVER-PLANE authorization seam (GM-R15).
//
// The graded ladder — player(owner) → builder → wizard → god — is the world
// model's `power` (src/world/types.ts) and its `power_rank`. Two planes
// enforce it, and each has exactly ONE seam so a tier decision is never an
// ad-hoc `if`:
//
//   * the DATA plane: `power_rank` + `_world_require_power` + `_world_controls`
//     in SQL (migrations 02/03/06) — RLS and the audited RPCs are the final
//     wall, checked on every privileged verb.
//   * the TRANSPORT plane: this module — the checks the server makes BEFORE a
//     verb reaches (or instead of) the world of record, where there is no RPC
//     to lean on. Today that is exactly the privileged broadcast (GM-R3,
//     coordinator.announce): a room-fan-out act with no row to gate. Routing
//     it through `can()` keeps the transport plane's tier logic in one place
//     and named, not a bare `powerRank(...) <` inline.
//
// The two planes agree by construction: both read the same ladder
// (world/types.powerRank ⇔ SQL power_rank), and a verb that DOES touch the
// world of record is gated by the RPC, not here — this module never becomes a
// second, drifting copy of the RPC role checks.

import type { Power } from "../world/types.ts";
import { powerRank } from "../world/types.ts";

/** Privileged capabilities enforced on the transport plane (verbs with no
 *  row to gate at the RPC layer). World-mutating privileged verbs (build,
 *  create_player, set_power, destroy) are gated by the RPCs and are NOT
 *  duplicated here — see the module note. */
export type Capability = "broadcast";

/** The minimum tier each transport-plane capability requires (GM-R15). */
export const CAPABILITY_MIN: Record<Capability, Power> = {
  // GM-R3 privileged broadcast: the reference's @wall / wizard announce.
  broadcast: "wizard",
};

/** Does `power` satisfy `capability`? The single predicate the transport
 *  plane asks — the coordinator's announce gate is its only caller today. */
export function can(power: Power, capability: Capability): boolean {
  return powerRank(power) >= powerRank(CAPABILITY_MIN[capability]);
}
