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
export const MODELS: ModelInfo[] = generated.models as ModelInfo[];

export const modelsByProvider = (p: ProviderId) => MODELS.filter((m) => m.provider === p);
