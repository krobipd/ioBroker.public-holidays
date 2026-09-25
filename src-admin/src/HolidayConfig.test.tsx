/**
 * The guided card against the REAL `@iobroker/json-config` ConfigGeneric, in jsdom.
 *
 * The card's pure logic (cascade, exclude list, preview) is covered from `src/`. What lives only in
 * the interplay with json-config is HOW the card writes back — and that is where audit finding B1
 * (v0.16.0) sat: `ConfigGeneric.onChange` snapshots `props.data` per call, so two calls in the same
 * tick both start from the unchanged record and the second write wins over the first. A country
 * change that cleared state and region in two calls left the state standing; in 12 countries the
 * old code was valid there and the adapter published a foreign region's holidays without a word.
 * These tests drive the published ConfigGeneric (no mock of it) through the same parent contract
 * admin's JsonConfigComponent offers: the whole record comes back through `onChange(data)`.
 *
 * Runs via `npm run test:admin` (src-admin/vitest.config.ts) — it needs src-admin/node_modules.
 */
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18n } from "@iobroker/gui-components";

import HolidayConfig from "./HolidayConfig";
import { getCountryOptions, getStateOptions } from "./scope-options";
import en from "./i18n/en.json";

type Data = Record<string, unknown>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// MUI's useMediaQuery needs matchMedia, which jsdom does not implement.
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
// What admin's ConfigCustom does for `schema.i18n: true`: load the card's own dictionary.
I18n.setLanguage("en");
I18n.extendTranslations(en, "en");

/**
 * Stands in for admin's JsonConfigComponent: owns the record, hands it to the card as `data` and
 * adopts whatever the card writes back through the whole-record `onChange(data)`.
 */
class Parent extends React.Component<{ initial: Data; onWrite: (data: Data) => void }, { data: Data }> {
  state = { data: { ...this.props.initial } };

  /**
   * What "discard changes" does in admin: the record jumps back to the saved one.
   *
   * @param data the saved record
   */
  reset(data: Data): void {
    this.setState({ data: { ...data } });
  }

  render(): React.ReactNode {
    return React.createElement(HolidayConfig as unknown as React.ComponentType<Record<string, unknown>>, {
      oContext: {
        adapterName: "public-holidays",
        socket: {},
        instance: 0,
        themeType: "light",
        isFloatComma: true,
        dateFormat: "",
        forceUpdate: () => {},
        systemConfig: { country: "Germany", language: "en" },
        theme: {},
        _themeName: "light",
        onCommandRunning: () => {},
      },
      alive: true,
      changed: false,
      themeName: "light",
      common: {},
      attr: "_holidayCard",
      data: this.state.data,
      originalData: this.props.initial,
      onError: () => {},
      schema: { type: "custom", url: "custom/customComponents.js", name: "HolidayConfig", i18n: true },
      onChange: (data: Data) => {
        this.props.onWrite(data);
        this.setState({ data });
      },
    });
  }
}

interface Mounted {
  container: HTMLElement;
  parent: Parent;
  /** Every whole-record write the card made, in order. */
  writes: Data[];
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

async function mount(initial: Data): Promise<Mounted> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const writes: Data[] = [];
  let parent: Parent | null = null;
  act(() => {
    root!.render(
      React.createElement(Parent, {
        initial,
        onWrite: (data: Data) => void writes.push(data),
        ref: (p: Parent | null) => (parent = p),
      } as React.ComponentProps<typeof Parent> & { ref: (p: Parent | null) => void }),
    );
  });
  // ConfigGeneric.render() returns null until its `calculatedValues` timeout (50 ms) has fired —
  // before that the card is not mounted at all.
  await settle(200);
  return { container, parent: parent!, writes };
}

afterEach(() => {
  if (root) {
    const r = root;
    act(() => r.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

/**
 * The text input of the picker with the given label, or null when the card does not show it.
 *
 * @param el the mounted card
 * @param label the picker's label text (card i18n, English)
 */
function picker(el: HTMLElement, label: string): HTMLInputElement | null {
  const tag = Array.from(el.querySelectorAll("label")).find(l => l.textContent?.startsWith(label));
  const input = tag ? document.getElementById(tag.htmlFor) : null;
  return input instanceof HTMLInputElement ? input : null;
}

/**
 * The option a keyboard pick lands on: MUI opens the list on the current value, so ArrowDown
 * moves to the entry AFTER it.
 *
 * @param options the picker's options in display order
 * @param current the currently selected value
 */
function optionAfter(options: { value: string }[], current: string): string {
  return options[options.findIndex(o => o.value === current) + 1].value;
}

/**
 * Selects the next option of an MUI Autocomplete the way a keyboard user does.
 *
 * @param input the picker's text input
 */
function pickNextOption(input: HTMLInputElement): void {
  // The first ArrowDown only opens the list (the listbox does not exist yet when the highlight is
  // computed), the second one moves the highlight past the current value, Enter selects it —
  // measured on MUI 9 in jsdom.
  for (const key of ["ArrowDown", "ArrowDown", "Enter"]) {
    act(() => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }
}

describe("HolidayConfig writes through the real ConfigGeneric", () => {
  const lang = I18n.getLanguage();
  const nextCountry = optionAfter(getCountryOptions(lang), "DE");
  const nextState = optionAfter(getStateOptions("DE", lang), "BY");

  it("clears state AND region in the same write as the country change (audit B1)", async () => {
    const {
      container: el,
      parent,
      writes,
    } = await mount({
      country: "DE",
      state: "BY",
      region: "A",
      typePublic: true,
      excludeHolidays: [],
    });
    pickNextOption(picker(el, en.ph_hc_country_label)!);
    await settle(100);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ country: nextCountry, state: "", region: "" });
    expect(parent.state.data).toMatchObject({ country: nextCountry, state: "", region: "" });
  });

  it("clears the region in the same write as the state change", async () => {
    const {
      container: el,
      parent,
      writes,
    } = await mount({
      country: "DE",
      state: "BY",
      region: "A",
      typePublic: true,
      excludeHolidays: [],
    });
    pickNextOption(picker(el, en.ph_hc_state_label)!);
    await settle(100);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ country: "DE", state: nextState, region: "" });
    expect(parent.state.data.region).toBe("");
  });

  it("does not write a value that was already stale when the card opened, but shows it (F13)", async () => {
    // JP has no states at all — the stale state must still be visible (no `…Options.length` guard).
    const { container: el, writes } = await mount({
      country: "JP",
      state: "BY",
      region: "",
      typePublic: true,
      excludeHolidays: [],
    });
    await settle(300);

    expect(writes).toHaveLength(0);
    expect(el.textContent).toContain("BY");
    // JP has neither states nor regions, so neither picker is on the card — the hint is the only trace.
    expect(picker(el, en.ph_hc_state_label)).toBeNull();
    expect(picker(el, en.ph_hc_region_label)).toBeNull();
  });

  it("does not write when the record jumps back (admin 'discard changes')", async () => {
    const saved = { country: "DE", state: "BY", region: "A", typePublic: true, excludeHolidays: [] };
    const { parent, writes } = await mount(saved);
    act(() => parent.reset({ ...saved, country: "AT", state: "", region: "" }));
    await settle(100);
    act(() => parent.reset(saved));
    await settle(300);

    expect(writes).toHaveLength(0);
    expect(parent.state.data).toMatchObject({ country: "DE", state: "BY", region: "A" });
  });
});
