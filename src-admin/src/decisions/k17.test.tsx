// K17 — the areas date-holidays cannot load are warned about and marked in the card.
// The card half: an area whose key the library cannot load is marked in the picker options, and the location tier
// shows the warning for it.
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { getRegionOptions } from "../scope-options";
import { LocationTier } from "../Tiers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({
  matches: false,
  media: "",
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

/** A state with one loadable region and one whose key is written in mixed case, as in the library's data. */
const makeHd = (() => ({
  getRegions: () => ({ CHC: "Christchurch", Timaru: "Timaru" }),
})) as unknown as NonNullable<Parameters<typeof getRegionOptions>[3]>;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) {
    const r = root;
    act(() => r.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

describe("K17 an area the library cannot load is marked in the card", () => {
  it("K17: the mixed-case region is marked unloadable, the other is not", () => {
    const options = getRegionOptions("NZ", "CAN", "en", makeHd);
    expect(options.find(o => o.value === "Timaru")?.unloadable).toBe(true);
    expect(options.find(o => o.value === "CHC")?.unloadable).toBeUndefined();
  });

  it("K17: the location tier shows the warning for the marked area", () => {
    const options = getRegionOptions("NZ", "CAN", "en", makeHd);
    const timaru = options.find(o => o.value === "Timaru") ?? null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        React.createElement(LocationTier, {
          t: (key: string) => key,
          countryOptions: [{ value: "NZ", label: "New Zealand (NZ)" }],
          stateOptions: [{ value: "CAN", label: "Canterbury (CAN)" }],
          regionOptions: options,
          countryOption: { value: "NZ", label: "New Zealand (NZ)" },
          stateOption: { value: "CAN", label: "Canterbury (CAN)" },
          regionOption: timaru,
          staleState: "",
          staleRegion: "",
          unloadable: !!timaru?.unloadable,
          detected: null,
          systemCountry: "",
          onChangeMany: () => undefined,
        }),
      );
    });
    expect(container.textContent).toContain("ph_hc_scope_unloadable");
  });
});
