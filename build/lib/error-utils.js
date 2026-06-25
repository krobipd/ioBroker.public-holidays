"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var error_utils_exports = {};
__export(error_utils_exports, {
  errText: () => errText,
  oneLine: () => oneLine
});
module.exports = __toCommonJS(error_utils_exports);
function errText(err) {
  if (err instanceof Error) {
    return oneLine(err.message);
  }
  if (typeof err === "string") {
    return oneLine(err);
  }
  return oneLine(String(err));
}
function oneLine(s) {
  return s.replace(/[\r\n\t]+/g, " ").trim();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  errText,
  oneLine
});
//# sourceMappingURL=error-utils.js.map
