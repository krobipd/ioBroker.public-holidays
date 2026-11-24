/**
 * The calendar list against the REAL `@iobroker/json-config` ConfigGeneric, in jsdom.
 *
 * The card's pure logic (cascade, exclude list, preview, list operations) is covered by its own
 * tests. What lives only in the interplay with json-config is HOW the card writes back — and that is
 * where audit finding B1 (v0.16.0) sat: `ConfigGeneric.onChange` snapshots `props.data` per call, so
 * two calls in the same tick both start from the unchanged record and the second write wins over the
 * first. A country change that cleared state and region in two calls left the state standing; in 12
 * countries the old code was valid there and the adapter published a foreign region's holidays
 * without a word. These tests drive the published ConfigGeneric (no mock of it) through the same
 * parent contract admin's JsonConfigComponent offers: the whole record comes back through
 * `onChange(data)`, errors through `onError(attr, error)`.
 *
 * Runs via `npm run test:admin` (src-admin/vitest.config.ts) — it needs src-admin/node_modules.
 */
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18n } from "@iobroker/gui-components";

import CalendarsConfig from "./CalendarsConfig";
import TreeChanges from "./TreeChanges";
import { buildPreviewHolidays, getCountryOptions, getStateOptions } from "./scope-options";
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
 * One calendar record around the given settings, its name the user's own unless the test asks for
 * the automatic one.
 *
 * @param settings location, types, excludes, bridge days
 * @param extra uid, name, its auto flag and id
 * @returns the record
 */
function calendar(settings: Data, extra: Data = {}): Data {
  return { uid: "c1", name: "Mine", nameAuto: false, id: "mine", ...settings, ...extra };
}

/**
 * The native record with these calendars.
 *
 * @param calendars the calendar records
 * @returns the record
 */
function native(...calendars: Data[]): Data {
  return { calendars, deleteRecordedStates: true, deleteRecordedHistory: false };
}

/**
 * The calendars of a written record.
 *
 * @param data the record
 * @returns its list
 */
function calendarsOf(data: Data): Data[] {
  return data.calendars as Data[];
}

interface ParentProps {
  component: unknown;
  initial: Data;
  saved: Data;
  onWrite: (data: Data) => void;
  onError: (attr: string | undefined, error?: string) => void;
  systemConfig?: Record<string, unknown>;
}

/**
 * Stands in for admin's JsonConfigComponent: owns the record, hands it to the card as `data` and
 * adopts whatever the card writes back through the whole-record `onChange(data)`.
 */
class Parent extends React.Component<ParentProps, { data: Data }> {
  state = { data: JSON.parse(JSON.stringify(this.props.initial)) as Data };

  /**
   * What "discard changes" does in admin: the record jumps back to the saved one.
   *
   * @param data the saved record
   */
  reset(data: Data): void {
    this.setState({ data: JSON.parse(JSON.stringify(data)) as Data });
  }

  render(): React.ReactNode {
    return React.createElement(this.props.component as React.ComponentType<Record<string, unknown>>, {
      oContext: {
        adapterName: "public-holidays",
        socket: {},
        instance: 0,
        themeType: "light",
        isFloatComma: true,
        dateFormat: "",
        forceUpdate: () => {},
        systemConfig: this.props.systemConfig ?? { country: "Germany", language: "en" },
        theme: {},
        _themeName: "light",
        onCommandRunning: () => {},
      },
      alive: true,
      changed: false,
      themeName: "light",
      common: {},
      attr: "_calendars",
      data: this.state.data,
      originalData: this.props.saved,
      onError: this.props.onError,
      schema: { type: "custom", url: "custom/customComponents.js", name: "CalendarsConfig", i18n: true },
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
  /** Every error report, in order. */
  errors: Array<string | undefined>;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

async function mount(
  initial: Data,
  systemConfig?: Record<string, unknown>,
  options: { saved?: Data; component?: unknown } = {},
): Promise<Mounted> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const writes: Data[] = [];
  const errors: Array<string | undefined> = [];
  let parent: Parent | null = null;
  act(() => {
    root!.render(
      React.createElement(Parent, {
        component: options.component ?? CalendarsConfig,
        initial,
        saved: options.saved ?? initial,
        systemConfig,
        onWrite: (data: Data) => void writes.push(data),
        onError: (_attr: string | undefined, error?: string) => void errors.push(error),
        ref: (p: Parent | null) => (parent = p),
      } as ParentProps & { ref: (p: Parent | null) => void }),
    );
  });
  // ConfigGeneric.render() returns null until its `calculatedValues` timeout (50 ms) has fired —
  // before that the card is not mounted at all.
  await settle(200);
  return { container, parent: parent!, writes, errors };
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
 * The element with the given data-testid.
 *
 * @param el the mounted card
 * @param id the test id
 * @returns the element, or null
 */
function byTestId(el: HTMLElement, id: string): HTMLElement | null {
  return el.querySelector(`[data-testid="${id}"]`);
}

/**
 * A click on an element.
 *
 * @param target the element
 */
function click(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Typing into a text field the way React sees it: the native value setter, then an input event.
 *
 * @param input the field
 * @param value what the field holds afterwards
 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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

describe("the calendar card writes through the real ConfigGeneric", () => {
  const lang = I18n.getLanguage();
  const nextCountry = optionAfter(getCountryOptions(lang), "DE");
  const nextState = optionAfter(getStateOptions("DE", lang), "BY");

  it("clears state AND region in the same write as the country change (audit B1)", async () => {
    const {
      container: el,
      parent,
      writes,
    } = await mount(
      native(calendar({ country: "DE", state: "BY", region: "A", typePublic: true, excludeHolidays: [] })),
    );
    pickNextOption(picker(el, en.ph_hc_country_label)!);
    await settle(100);

    expect(writes).toHaveLength(1);
    expect(calendarsOf(writes[0])[0]).toMatchObject({ country: nextCountry, state: "", region: "" });
    expect(calendarsOf(parent.state.data)[0]).toMatchObject({ country: nextCountry, state: "", region: "" });
  });

  it("clears the region in the same write as the state change", async () => {
    const {
      container: el,
      parent,
      writes,
    } = await mount(
      native(calendar({ country: "DE", state: "BY", region: "A", typePublic: true, excludeHolidays: [] })),
    );
    pickNextOption(picker(el, en.ph_hc_state_label)!);
    await settle(100);

    expect(writes).toHaveLength(1);
    expect(calendarsOf(writes[0])[0]).toMatchObject({ country: "DE", state: nextState, region: "" });
    expect(calendarsOf(parent.state.data)[0].region).toBe("");
  });

  it("an automatic name and the folder follow the location in the same write", async () => {
    const { container: el, writes } = await mount(
      native(
        calendar(
          { country: "DE", state: "BY", region: "", typePublic: true, excludeHolidays: [] },
          { name: "Germany · Bayern", nameAuto: true, id: "de-by-public" },
        ),
      ),
    );
    pickNextOption(picker(el, en.ph_hc_state_label)!);
    await settle(100);

    expect(writes).toHaveLength(1);
    const written = calendarsOf(writes[0])[0];
    expect(written.id).toBe(`de-${nextState.toLowerCase()}-public`);
    expect(written.name).toMatch(/^Germany · /);
    expect(written.name).not.toBe("Germany · Bayern");
    expect(written.nameAuto).toBe(true);
  });

  it("a name the user gave stays when the location changes; the folder follows", async () => {
    const { container: el, writes } = await mount(
      native(calendar({ country: "DE", state: "BY", region: "", typePublic: true, excludeHolidays: [] })),
    );
    pickNextOption(picker(el, en.ph_hc_state_label)!);
    await settle(100);

    expect(calendarsOf(writes[0])[0]).toMatchObject({ name: "Mine", id: `de-${nextState.toLowerCase()}-public` });
  });

  it("does not write a value that was already stale when the card opened, but shows it (F13)", async () => {
    // JP has no states at all — the stale state must still be visible (no `…Options.length` guard).
    const { container: el, writes } = await mount(
      native(calendar({ country: "JP", state: "BY", region: "", typePublic: true, excludeHolidays: [] })),
    );
    await settle(300);

    expect(writes).toHaveLength(0);
    expect(el.textContent).toContain("BY");
    // JP has neither states nor regions, so neither picker is on the card — the hint is the only trace.
    expect(picker(el, en.ph_hc_state_label)).toBeNull();
    expect(picker(el, en.ph_hc_region_label)).toBeNull();
  });

  it("opening a calendar whose name was never saved writes nothing and shows the standard name", async () => {
    const { container: el, writes } = await mount(
      native(
        calendar(
          { country: "DE", state: "BY", region: "", typePublic: true, excludeHolidays: [] },
          { name: "", nameAuto: true, id: "de-by-public" },
        ),
      ),
    );
    await settle(300);

    expect(writes).toHaveLength(0);
    expect((byTestId(el, "cal-0-name") as HTMLInputElement).value).toBe("Germany · Bayern");
  });

  it("does not write when the record jumps back (admin 'discard changes')", async () => {
    const saved = native(calendar({ country: "DE", state: "BY", region: "A", typePublic: true, excludeHolidays: [] }));
    const { parent, writes } = await mount(saved);
    act(() =>
      parent.reset(native(calendar({ country: "AT", state: "", region: "", typePublic: true, excludeHolidays: [] }))),
    );
    await settle(100);
    act(() => parent.reset(saved));
    await settle(300);

    expect(writes).toHaveLength(0);
    expect(calendarsOf(parent.state.data)[0]).toMatchObject({ country: "DE", state: "BY", region: "A" });
  });
});

describe("the calendar list", () => {
  const two = native(
    calendar({ country: "DE", typePublic: true, excludeHolidays: [] }, { uid: "c1", name: "One", id: "one" }),
    calendar({ country: "AT", typeBank: true, excludeHolidays: [] }, { uid: "c2", name: "Two", id: "two" }),
  );

  it("adds a calendar at the end as the card started out, with the standard name and id", async () => {
    const { container: el, writes } = await mount(two);
    click(byTestId(el, "cal-add")!);
    await settle(100);

    expect(writes).toHaveLength(1);
    const list = calendarsOf(writes[0]);
    expect(list).toHaveLength(3);
    expect(list[2]).toMatchObject({
      uid: "c3",
      country: "",
      typePublic: true,
      typeBank: false,
      nameAuto: true,
      id: "system-public",
      name: "System country",
    });
    // the new calendar is open: its pickers are on the page
    expect(byTestId(el, "cal-2-name")).not.toBeNull();
  });

  it("a new calendar never takes the uid of one deleted in the same edit", async () => {
    const { container: el, writes } = await mount(native(calendarsOf(two)[0]), undefined, { saved: two });
    click(byTestId(el, "cal-add")!);
    await settle(100);

    expect(calendarsOf(writes[0])[1].uid).toBe("c3");
  });

  it("copies a calendar below it with all settings, the name with the suffix, the standard folder", async () => {
    const { container: el, writes } = await mount(two);
    click(byTestId(el, "cal-0")!.querySelector(".MuiAccordionSummary-root")!);
    await settle(50);
    click(byTestId(el, "cal-0-copy")!);
    await settle(100);

    const list = calendarsOf(writes[0]);
    expect(list.map(c => c.id)).toEqual(["one", "de-public", "two"]);
    expect(list[1]).toMatchObject({ uid: "c3", name: "One (copy)", nameAuto: false, country: "DE", typePublic: true });
  });

  it("deletes a calendar at once, without asking", async () => {
    const { container: el, writes } = await mount(two);
    click(byTestId(el, "cal-0")!.querySelector(".MuiAccordionSummary-root")!);
    await settle(50);
    click(byTestId(el, "cal-0-delete")!);
    await settle(100);

    expect(calendarsOf(writes[0]).map(c => c.id)).toEqual(["two"]);
  });

  it("the arrows change only the order", async () => {
    const { container: el, writes } = await mount(two);
    click(byTestId(el, "cal-1")!.querySelector(".MuiAccordionSummary-root")!);
    await settle(50);
    click(byTestId(el, "cal-1-up")!);
    await settle(100);

    expect(calendarsOf(writes[0]).map(c => c.id)).toEqual(["two", "one"]);
    expect(calendarsOf(writes[0])[0]).toEqual(calendarsOf(two)[1]);
  });

  it("shows the folder, with no field to type an id into", async () => {
    const { container: el } = await mount(native(calendar({ country: "DE", typePublic: true })));
    expect(byTestId(el, "cal-0-id")).toBeNull();
    expect(byTestId(el, "cal-0-folder")?.textContent).toBe("public-holidays.0.mine");
  });

  it("a typed name is the user's from then on and never moves the folder", async () => {
    const { container: el, writes } = await mount(
      native(calendar({ country: "DE", typePublic: true }, { name: "", nameAuto: true, id: "de-public-2" })),
    );
    typeInto(byTestId(el, "cal-0-name") as HTMLInputElement, "Heinz");
    await settle(100);

    expect(calendarsOf(writes[writes.length - 1])[0]).toMatchObject({
      name: "Heinz",
      nameAuto: false,
      id: "de-public-2",
    });
  });

  it("bridge days never move the folder — a -2 stays", async () => {
    const twin = native(
      calendar({ country: "DE", typePublic: true, includeBridgeDays: false }, { uid: "c2", id: "de-public-2" }),
    );
    const { container: el, writes } = await mount(twin);
    const box = Array.from(el.querySelectorAll("input[type=checkbox]")).find(c =>
      c.closest("label")?.textContent?.startsWith(en.ph_hc_bridge_label),
    );
    expect(box).toBeInstanceOf(HTMLInputElement);
    click(box!);
    await settle(100);

    expect(calendarsOf(writes[writes.length - 1])[0]).toMatchObject({ includeBridgeDays: true, id: "de-public-2" });
    expect(byTestId(el, "cal-0-moves")).toBeNull();
  });

  it("opening a list with an id held twice writes nothing, turns red and locks Save", async () => {
    const twice = native(
      calendar({ country: "DE", typePublic: true }, { uid: "c1", name: "One", id: "de-public" }),
      calendar({ country: "DE", typePublic: true }, { uid: "c2", name: "Two", id: "de-public" }),
    );
    const { container: el, writes, errors } = await mount(twice);
    await settle(200);

    expect(writes).toHaveLength(0);
    expect(errors[errors.length - 1]).toBe(en.ph_cal_id_taken);
    expect(byTestId(el, "cal-1-error")).not.toBeNull();
  });

  it("the button builds a new id for an id held twice and unlocks Save", async () => {
    const twice = native(
      calendar({ country: "DE", typePublic: true }, { uid: "c1", name: "One", id: "de-public" }),
      calendar({ country: "DE", typePublic: true }, { uid: "c2", name: "Two", id: "de-public" }),
    );
    const { container: el, writes, errors } = await mount(twice);
    click(byTestId(el, "cal-1")!.querySelector(".MuiAccordionSummary-root")!);
    await settle(50);
    click(byTestId(el, "cal-1-rebuild")!);
    await settle(100);

    expect(writes).toHaveLength(1);
    expect(calendarsOf(writes[0]).map(c => c.id)).toEqual(["de-public", "de-public-2"]);
    expect(errors[errors.length - 1]).toBeUndefined();
    expect(byTestId(el, "cal-1-error")).toBeNull();
  });

  it("the button builds the standard id for a missing one", async () => {
    const {
      container: el,
      writes,
      errors,
    } = await mount(native(calendar({ country: "AT", typePublic: true }, { id: "" })));
    expect(errors[errors.length - 1]).toBe(en.ph_cal_id_missing);
    click(byTestId(el, "cal-0-rebuild")!);
    await settle(100);

    expect(calendarsOf(writes[0])[0].id).toBe("at-public");
    expect(errors[errors.length - 1]).toBeUndefined();
  });

  it("a folder that would move shows in yellow under the folder and gathered below the list", async () => {
    const saved = native(calendar({ country: "DE", typePublic: true }, { id: "de-public" }));
    const { container: el } = await mount(
      native(calendar({ country: "DE", typePublic: true }, { id: "heinz" })),
      undefined,
      {
        saved,
      },
    );
    expect(byTestId(el, "cal-0-moves")?.textContent).toBe(
      en.ph_cal_id_moves.replace("%s", "public-holidays.0.de-public"),
    );
    expect(byTestId(el, "cal-moves")?.textContent).toContain("public-holidays.0.de-public → public-holidays.0.heinz");
  });
});

describe("the box above the Save button", () => {
  const saved = native(
    calendar({ country: "DE", typePublic: true }, { uid: "c1", name: "One", id: "one" }),
    calendar({ country: "AT", typeBank: true }, { uid: "c2", name: "Two", id: "two" }),
  );

  it("names every folder that moves and every folder that goes with a deleted calendar", async () => {
    const edited = native(calendar({ country: "DE", typePublic: true }, { uid: "c1", name: "One", id: "uno" }));
    const { container: el } = await mount(edited, undefined, { saved, component: TreeChanges });
    const box = byTestId(el, "tree-changes")?.textContent ?? "";
    expect(box).toContain(
      en.ph_tree_moves.replace("%s", "public-holidays.0.one").replace("%s", "public-holidays.0.uno"),
    );
    expect(box).toContain(en.ph_tree_deleted.replace("%s", "public-holidays.0.two").replace("%s", "Two"));
  });

  it("stays empty while saving changes nothing in the tree", async () => {
    const { container: el } = await mount(saved, undefined, { component: TreeChanges });
    expect(byTestId(el, "tree-changes")).toBeNull();
    expect(byTestId(el, "tree-changes-none")).not.toBeNull();
  });
});

describe("the calendar card shows what the runtime will publish (0.18.0)", () => {
  it("no country chosen: previews the detected system country instead of asking for one", async () => {
    const { container: el, writes } = await mount(
      native(calendar({ country: "", typePublic: true, excludeHolidays: [] })),
    );
    await settle(100);
    expect(el.textContent).not.toContain(en.ph_hc_preview_none);
    expect(el.textContent).toContain("New Year's Day");
    expect(writes).toHaveLength(0);
  });

  it("names holidays in the SYSTEM language, like the runtime — not in the admin language", async () => {
    const { container: el } = await mount(native(calendar({ country: "DE", typePublic: true, excludeHolidays: [] })), {
      country: "Germany",
      language: "de",
    });
    await settle(100);
    expect(el.textContent).toContain("Neujahr");
    expect(el.textContent).not.toContain("New Year's Day");
  });

  it("a system country without holiday data is named as the cause", async () => {
    const { container: el } = await mount(native(calendar({ country: "", typePublic: true, excludeHolidays: [] })), {
      country: "Qatar",
      language: "en",
    });
    await settle(100);
    expect(el.textContent).toContain(en.ph_hc_autodetect_nodata.replace("%s", "Qatar"));
  });

  it("the preview counts the year it shows", async () => {
    const { container: el } = await mount(native(calendar({ country: "DE", typePublic: true, excludeHolidays: [] })));
    await settle(100);
    const year = new Date().getFullYear();
    const count = buildPreviewHolidays(
      { country: "DE", state: "", region: "", types: ["public"], excludeHolidays: [], includeBridgeDays: false },
      { systemLanguage: "en", referenceYear: year },
    ).length;
    expect(el.textContent).toContain(en.ph_hc_preview_count.replace("%s", String(count)).replace("%s", String(year)));
  });

  it("editing the exclude list keeps orphans and excludes of switched-off types (audit M31)", async () => {
    const { container: el, writes } = await mount(
      native(
        calendar({
          country: "DE",
          state: "BY",
          typePublic: true,
          typeObservance: false,
          excludeHolidays: ["gone_forever", "08-15"],
        }),
      ),
    );
    await settle(100);
    // 08-15 (Assumption Day) is an observance in BY: kept apart, never offered for deletion as orphan.
    expect(el.textContent).toContain(en.ph_excludeInactive);
    pickNextOption(picker(el, en.ph_excludeLabel)!);
    await settle(100);

    expect(writes).toHaveLength(1);
    const excludes = calendarsOf(writes[0])[0].excludeHolidays as string[];
    expect(excludes).toEqual(expect.arrayContaining(["gone_forever", "08-15"]));
    expect(excludes.length).toBe(3);
  });

  it.each([
    ["lower-case", "by"],
    // The runtime trims the stored state (holiday-shared readTrimmed) — the card reads it the same way.
    ["surrounded by spaces", " BY "],
  ])("a hand-written %s state is the state, not a stale value", async (_how, state) => {
    const { container: el, writes } = await mount(
      native(calendar({ country: "DE", state, typePublic: true, excludeHolidays: [] })),
    );
    await settle(100);
    expect(el.textContent).not.toContain(en.ph_hc_scope_stale.split(":")[0]);
    expect(picker(el, en.ph_hc_state_label)?.value).toMatch(/\(BY\)$/);
    expect(writes).toHaveLength(0);
  });

  it("a hand-written lower-case region is the region, not a stale value", async () => {
    const { container: el, writes } = await mount(
      native(calendar({ country: "DE", state: "BY", region: "a", typePublic: true, excludeHolidays: [] })),
    );
    await settle(100);
    expect(el.textContent).not.toContain(en.ph_hc_scope_stale.split(":")[0]);
    expect(picker(el, en.ph_hc_region_label)?.value).toMatch(/\(A\)$/);
    expect(writes).toHaveLength(0);
  });

  it("no country stored and none in the system settings: the preview asks for one", async () => {
    const { container: el } = await mount(native(calendar({ typePublic: true, excludeHolidays: [] })), {
      country: "",
      language: "en",
    });
    await settle(100);
    expect(el.textContent).toContain(en.ph_hc_preview_none);
  });

  it("a stale state with no picker for it is cleared in ONE write", async () => {
    const { container: el, writes } = await mount(
      native(calendar({ country: "JP", state: "BY", region: "A", typePublic: true, excludeHolidays: [] })),
    );
    await settle(100);
    const del = Array.from(el.querySelectorAll(".MuiChip-root"))
      .find(c => c.textContent === "BY")
      ?.querySelector(".MuiChip-deleteIcon");
    expect(del).toBeTruthy();
    act(() => {
      del!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle(100);

    expect(writes).toHaveLength(1);
    expect(calendarsOf(writes[0])[0]).toMatchObject({ country: "JP", state: "", region: "" });
  });
});
