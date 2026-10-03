// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { createContext } from "react";

/** Set by PanelShell: hides the panel it wraps. The panel's header renders it
 *  as its last cell, so the close affordance never floats over other actions. */
export const PanelCloseContext = createContext<(() => void) | null>(null);
