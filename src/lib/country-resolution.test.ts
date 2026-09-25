import Holidays from "date-holidays";
import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_COUNTRY_CODES,
  COUNTRY_NAME_TO_CODE,
  resolveCountryName,
  WIZARD_COUNTRY_ALIASES,
} from "./country-codes";

// The country names of the ioBroker.admin first-run wizard (lists `COUNTRIES` + `TOP_COUNTRIES`),
// extracted from the Admin 8.0.11 bundle (adminWww/assets/index-*.js) on 2026-09-25. Up to Admin 8.0.14
// the wizard stores one of these ENGLISH names in system.config.common.country; 8.0.15 unified the
// lists without migrating stored values, so installations set up earlier keep them — frozen here.
const ADMIN_WIZARD_COUNTRIES: readonly string[] = [
  "Afghanistan",
  "Albania",
  "Algeria",
  "American Samoa",
  "Andorra",
  "Angola",
  "Anguilla",
  "Antarctica",
  "Antigua and Barbuda",
  "Argentina",
  "Armenia",
  "Aruba",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bahamas",
  "Bahrain",
  "Bangladesh",
  "Barbados",
  "Belarus",
  "Belgium",
  "Belize",
  "Benin",
  "Bermuda",
  "Bhutan",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Botswana",
  "Bouvet Island",
  "Brazil",
  "British Indian Ocean Territory",
  "Brunei Darussalam",
  "Bulgaria",
  "Burkina Faso",
  "Burundi",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Cape Verde",
  "Cayman Islands",
  "Central African Republic",
  "Chad",
  "Chile",
  "China",
  "Christmas Island",
  "Cocos Islands",
  "Colombia",
  "Comoros",
  "Congo",
  "Cook Islands",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Cyprus",
  "Czech Republic",
  "Denmark",
  "Djibouti",
  "Dominica",
  "Dominican Republic",
  "East Timor",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Equatorial Guinea",
  "Eritrea",
  "Estonia",
  "Ethiopia",
  "Falkland Islands (Malvinas)",
  "Faroe Islands",
  "Fiji",
  "Finland",
  "France",
  "French Guiana",
  "French Polynesia",
  "French Southern Territories",
  "Gabon",
  "Gambia",
  "Georgia",
  "Germany",
  "Ghana",
  "Gibraltar",
  "Greece",
  "Greenland",
  "Grenada",
  "Guadeloupe",
  "Guam",
  "Guatemala",
  "Guernsey",
  "Guinea",
  "Guinea-Bissau",
  "Guyana",
  "Haiti",
  "Heard and Mc Donald Islands",
  "Honduras",
  "Hong Kong",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Isle of Man",
  "Israel",
  "Italy",
  "Ivory Coast",
  "Jamaica",
  "Japan",
  "Jersey",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kiribati",
  "Korea",
  "Kosovo",
  "Kuwait",
  "Kyrgyzstan",
  "Lao People's Democratic Republic",
  "Latvia",
  "Lebanon",
  "Lesotho",
  "Liberia",
  "Libyan Arab Jamahiriya",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Macau",
  "Macedonia",
  "Madagascar",
  "Malawi",
  "Malaysia",
  "Maldives",
  "Mali",
  "Malta",
  "Marshall Islands",
  "Martinique",
  "Mauritania",
  "Mauritius",
  "Mayotte",
  "Mexico",
  "Micronesia",
  "Moldova",
  "Monaco",
  "Mongolia",
  "Montenegro",
  "Montserrat",
  "Morocco",
  "Mozambique",
  "Myanmar",
  "Namibia",
  "Nauru",
  "Nepal",
  "Netherlands",
  "Netherlands Antilles",
  "New Caledonia",
  "New Zealand",
  "Nicaragua",
  "Niger",
  "Nigeria",
  "Niue",
  "Norfolk Island",
  "Northern Mariana Islands",
  "Norway",
  "Oman",
  "Pakistan",
  "Palau",
  "Palestine",
  "Panama",
  "Papua New Guinea",
  "Paraguay",
  "Peru",
  "Philippines",
  "Pitcairn",
  "Poland",
  "Portugal",
  "Puerto Rico",
  "Qatar",
  "Reunion",
  "Romania",
  "Russian Federation",
  "Rwanda",
  "Saint Kitts and Nevis",
  "Saint Lucia",
  "Saint Vincent and the Grenadines",
  "Samoa",
  "San Marino",
  "Sao Tome and Principe",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Seychelles",
  "Sierra Leone",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "Solomon Islands",
  "Somalia",
  "South Africa",
  "South Georgia South Sandwich Islands",
  "Spain",
  "Sri Lanka",
  "St. Helena",
  "St. Pierre and Miquelon",
  "Sudan",
  "Suriname",
  "Svalbard and Jan Mayen Islands",
  "Swaziland",
  "Sweden",
  "Switzerland",
  "Syrian Arab Republic",
  "Taiwan",
  "Tajikistan",
  "Tanzania",
  "Thailand",
  "Togo",
  "Tokelau",
  "Tonga",
  "Trinidad and Tobago",
  "Tunisia",
  "Turkey",
  "Turkmenistan",
  "Turks and Caicos Islands",
  "Tuvalu",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "United States minor outlying islands",
  "Uruguay",
  "Uzbekistan",
  "Vanuatu",
  "Vatican City State",
  "Venezuela",
  "Vietnam",
  "Virgin Islands (British)",
  "Virgin Islands (U.S.)",
  "Wallis and Futuna Islands",
  "Western Sahara",
  "Yemen",
  "Zaire",
  "Zambia",
  "Zimbabwe",
];

const SUPPORTED = new Set(Object.keys(new Holidays().getCountries()));

describe("resolveCountryName — a stored country value to the code date-holidays expects", () => {
  it("resolves names of both admin lists, codes, and odd spellings", () => {
    expect(resolveCountryName("Austria", SUPPORTED)).toEqual({ code: "AT" });
    expect(resolveCountryName("Viet Nam", SUPPORTED)).toEqual({ code: "VN" });
    expect(resolveCountryName("Vietnam", SUPPORTED)).toEqual({ code: "VN" });
    expect(resolveCountryName("korea", SUPPORTED)).toEqual({ code: "KR" });
    expect(resolveCountryName(" de ", SUPPORTED)).toEqual({ code: "DE" });
  });

  it("names the reason when it cannot resolve", () => {
    expect(resolveCountryName("", SUPPORTED)).toEqual({ code: "", reason: "empty" });
    expect(resolveCountryName("Atlantis", SUPPORTED)).toEqual({ code: "", reason: "unknown" });
    expect(resolveCountryName("Qatar", SUPPORTED)).toEqual({ code: "", reason: "no-data" });
    expect(resolveCountryName("Serbia and Montenegro", SUPPORTED)).toEqual({ code: "", reason: "ambiguous" });
    expect(resolveCountryName("Netherlands Antilles", SUPPORTED)).toEqual({ code: "", reason: "ambiguous" });
  });
});

describe("every country name ioBroker.admin can store is decided", () => {
  // Until 0.17.0 the map held only the system-settings list; 20 countries with holiday data were
  // silently not detected for installations set up in the wizard (Korea, Vietnam, Serbia …).
  it.each(ADMIN_WIZARD_COUNTRIES)("wizard name %s resolves, or says why not", name => {
    const r = resolveCountryName(name, SUPPORTED);
    expect(r.code !== "" || r.reason === "no-data" || r.reason === "ambiguous", `${name} → ${JSON.stringify(r)}`).toBe(
      true,
    );
  });

  it.each(Object.keys(COUNTRY_NAME_TO_CODE))("settings name %s resolves, or says why not", name => {
    const r = resolveCountryName(name, SUPPORTED);
    expect(r.code !== "" || r.reason === "no-data" || r.reason === "ambiguous", `${name} → ${JSON.stringify(r)}`).toBe(
      true,
    );
  });

  it("the wizard aliases cover exactly the wizard names the settings list spells differently", () => {
    const settings = new Set(Object.keys(COUNTRY_NAME_TO_CODE).map(n => n.toLowerCase()));
    const differing = ADMIN_WIZARD_COUNTRIES.filter(n => !settings.has(n.toLowerCase())).sort();
    expect(Object.keys(WIZARD_COUNTRY_ALIASES).sort()).toEqual(differing);
  });

  it("an ambiguous admin code splits only into countries the holiday data has", () => {
    for (const [code, parts] of Object.entries(AMBIGUOUS_COUNTRY_CODES)) {
      expect(SUPPORTED.has(code), code).toBe(false);
      for (const p of parts) {
        expect(SUPPORTED.has(p), `${code} → ${p}`).toBe(true);
      }
    }
  });

  it("every holiday country without any admin name is known — they can only be chosen by hand", () => {
    const named = new Set([...Object.values(COUNTRY_NAME_TO_CODE), ...Object.values(WIZARD_COUNTRY_ALIASES)]);
    const unnamed = [...SUPPORTED].filter(c => !named.has(c)).sort();
    // README "Country detection" names these; a date-holidays update that adds one fails here.
    expect(unnamed).toEqual(["BL", "BQ", "CW", "IC", "MF", "SS", "SX"]);
  });
});
