// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

const REACT_ID = /_r_[0-9a-z]+_|:r[0-9a-z]+:/g;
const ID_ATTRS = ["id", "for", "aria-controls", "aria-labelledby", "aria-describedby"];

/**
 * A DOM subtree ready for `toMatchSnapshot`: React `useId` values (which
 * depend on how many components rendered before, i.e. on test order) are
 * replaced by a stable placeholder.
 */
export function snapshotOf(el: Element | null): Element {
  if (!el) throw new Error("nothing rendered to snapshot");
  const copy = el.cloneNode(true) as Element;
  for (const node of [copy, ...copy.querySelectorAll("*")]) {
    for (const attr of ID_ATTRS) {
      const v = node.getAttribute(attr);
      if (v && REACT_ID.test(v)) node.setAttribute(attr, v.replace(REACT_ID, "_r_id_"));
      REACT_ID.lastIndex = 0;
    }
  }
  return copy;
}
