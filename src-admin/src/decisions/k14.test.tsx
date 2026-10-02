// K14 — the card writes several fields in one write.
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18n } from "@iobroker/gui-components";

import HolidayConfig from "../HolidayConfig";
import en from "../i18n/en.json";

type Data = Record<string, unknown>;

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
I18n.setLanguage("en");
I18n.extendTranslations(en, "en");

/** Stands in for admin's JsonConfigComponent: owns the record and adopts every whole-record write. */
class Parent extends React.Component<{ initial: Data; onWrite: (data: Data) => void }, { data: Data }> {
  state = { data: { ...this.props.initial } };

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

let root: Root | null = null;
let container: HTMLElement | null = null;

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

async function mount(initial: Data): Promise<{ el: HTMLElement; writes: Data[] }> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const writes: Data[] = [];
  act(() => {
    root!.render(React.createElement(Parent, { initial, onWrite: (data: Data) => void writes.push(data) }));
  });
  // ConfigGeneric renders nothing until its calculatedValues timeout (50 ms) has fired.
  await settle(200);
  return { el: container, writes };
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
 * The text input of the picker with the given label.
 *
 * @param el the mounted card
 * @param label the picker's label text
 * @returns the input
 */
function picker(el: HTMLElement, label: string): HTMLInputElement {
  const tag = Array.from(el.querySelectorAll("label")).find(l => l.textContent?.startsWith(label));
  const input = tag ? document.getElementById(tag.htmlFor) : null;
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

/**
 * Picks the option after the current one, the way a keyboard user does.
 *
 * @param input the picker's text input
 */
function pickNext(input: HTMLInputElement): void {
  for (const key of ["ArrowDown", "ArrowDown", "Enter"]) {
    act(() => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }
}

describe("K14 several fields, one write", () => {
  it("K14: a new country clears state and region in the same single write", async () => {
    const { el, writes } = await mount({
      country: "DE",
      state: "BY",
      region: "A",
      typePublic: true,
      excludeHolidays: [],
    });
    pickNext(picker(el, en.ph_hc_country_label));
    await settle(100);
    expect(writes).toHaveLength(1);
    expect(writes[0].country).not.toBe("DE");
    expect(writes[0]).toMatchObject({ state: "", region: "" });
  });

  it("K14: a new state clears the region in the same single write", async () => {
    const { el, writes } = await mount({
      country: "DE",
      state: "BY",
      region: "A",
      typePublic: true,
      excludeHolidays: [],
    });
    pickNext(picker(el, en.ph_hc_state_label));
    await settle(100);
    expect(writes).toHaveLength(1);
    expect(writes[0].state).not.toBe("BY");
    expect(writes[0]).toMatchObject({ country: "DE", region: "" });
  });
});
