/**
 * The shape of the 12 state objects, separate from {@link state-publisher} so a guard can import
 * it without pulling in `@iobroker/adapter-core` (which calls `process.exit` outside a real
 * js-controller install). The manifest declares the same 12 a second time;
 * instance-objects-reach.test.ts holds the two together.
 */
export interface StateSpec {
  type: ioBroker.CommonType;
  role: string;
  read: boolean;
  write: boolean;
  unit?: string;
  /** The initial value js-controller writes on a fresh install — kept identical to the manifest. */
  def: string | boolean | number;
}

export const FIELD_SPECS: Record<string, StateSpec> = {
  name: { type: "string", role: "text", read: true, write: false, def: "" },
  isHoliday: { type: "boolean", role: "indicator", read: true, write: false, def: false },
  date: { type: "string", role: "date", read: true, write: false, def: "" },
  daysUntil: { type: "number", role: "value.interval", read: true, write: false, unit: "days", def: 0 },
};
