// K15 — a value orphaned on opening is shown, never saved automatically.
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

describe("K15 an orphaned value is shown, not saved", () => {
  it("K15: a state the country does not have is shown and nothing is written", async () => {
    const { el, writes } = await mount({
      country: "JP",
      state: "BY",
      region: "",
      typePublic: true,
      excludeHolidays: [],
    });
    await settle(300);
    expect(writes).toEqual([]);
    expect(el.textContent).toContain("BY");
  });

  it("K15: a region the state does not have is shown and nothing is written", async () => {
    const { el, writes } = await mount({
      country: "DE",
      state: "BY",
      region: "ZZ",
      typePublic: true,
      excludeHolidays: [],
    });
    await settle(300);
    expect(writes).toEqual([]);
    expect(el.textContent).toContain("ZZ");
  });
});
