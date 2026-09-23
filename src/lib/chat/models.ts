// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ModelInfo, ProviderId } from "@/types/chat";

import generated from "./models.generated.json";

/**
 * Curated list of chat-capable models, baked at build time from
 * https://models.dev/api.json. Refresh by running
 * `node scripts/fetch-models.mjs`.
 *
 * The runtime never reaches out to models.dev — important for enterprise
 * deployments behind strict outbound policies.
 */
/** Billy on Maestro Deck Cloud. The server picks the actual model; this is
 *  the one entry the picker shows for it. */
export const MAESTRODECK_MODEL: ModelInfo = {
  id: "billy",
  label: "Billy",
  provider: "maestrodeck",
  contextWindow: 128_000,
};

export const MODELS: ModelInfo[] = [MAESTRODECK_MODEL, ...(generated.models as ModelInfo[])];

export const modelsByProvider = (p: ProviderId) => MODELS.filter((m) => m.provider === p);
