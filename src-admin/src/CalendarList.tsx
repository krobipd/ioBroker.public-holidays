import React from "react";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { I18n } from "@iobroker/gui-components";

import Holidays from "date-holidays";
import { readCalendarList } from "../../src/lib/holiday-shared.js";
import { resolveCountryName } from "../../src/lib/country-codes.js";
import {
  addCalendar,
  type CalendarRecord,
  copyCalendar,
  displayName,
  type FolderMove,
  idProblem,
  moveCalendar,
  type NamingContext,
  patchCalendar,
  rebuildCalendarId,
  removeCalendar,
  setCalendarName,
  treeChanges,
} from "./calendar-list";
import { HolidayPanel } from "./HolidayPanel";
import type { Translate } from "./Tiers";

/** The card's date-holidays — the area names of the standard name and id. */
const HOLIDAYS = new Holidays();

/** The codes the card's date-holidays has data for — the set country resolution checks against. */
const SUPPORTED_COUNTRIES = new Set(Object.keys(HOLIDAYS.getCountries()));

/**
 * What the standard name and id are built from — the same system country, language and data the
 * runtime takes.
 *
 * @param systemCountry `system.config.common.country` — a country NAME from one of the two admin lists
 * @param systemLanguage `system.config.common.language`
 * @returns the naming context
 */
export function namingContext(systemCountry: string, systemLanguage: string): NamingContext {
  return {
    systemCountry: systemCountry ? resolveCountryName(systemCountry, SUPPORTED_COUNTRIES).code : "",
    language: systemLanguage,
    source: HOLIDAYS,
    supported: SUPPORTED_COUNTRIES,
  };
}

/**
 * A text field with its own draft: the admin feeds `props.data` back asynchronously, so a purely
 * controlled field would fight the cursor. A value that changes from outside (the standard name
 * following the location) replaces the draft; the echo of what was typed does not.
 *
 * @param root0 the field's props
 * @param root0.label the field label
 * @param root0.value the stored value
 * @param root0.onType called with what the field shows after each keystroke
 * @param root0.helperText the line below the field
 * @param root0.placeholder the placeholder while it is empty
 * @param root0.testId the data-testid of the input
 */
function DraftField({
  label,
  value,
  onType,
  helperText,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onType: (value: string) => void;
  helperText?: React.ReactNode;
  placeholder?: string;
  testId: string;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(value);
  const sent = React.useRef(value);
  React.useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setDraft(value);
    }
  }, [value]);
  return (
    <TextField
      fullWidth
      size="small"
      variant="standard"
      label={label}
      value={draft}
      helperText={helperText}
      placeholder={placeholder}
      slotProps={{ htmlInput: { "data-testid": testId } }}
      onChange={e => {
        const v = e.target.value;
        setDraft(v);
        sent.current = v;
        onType(v);
      }}
    />
  );
}

/** Props of the calendar list. */
export interface CalendarListProps {
  /** The jsonConfig `native` record. */
  data: Record<string, unknown>;
  /** The `native` record as saved — what the tree holds today. */
  originalData: Record<string, unknown>;
  /** The instance namespace, e.g. `public-holidays.0`. */
  namespace: string;
  /** `system.config.common.country` — a country NAME from one of the two admin lists. */
  systemCountry: string;
  /** `system.config.common.language`. */
  systemLanguage: string;
  /** `system.config.common.dateFormat`. */
  dateFormat: string;
  /** Write the whole list in ONE write (K14). */
  onWriteList: (list: CalendarRecord[]) => void;
}

/**
 * The calendars as a list that folds open, like lists in the admin elsewhere: a calendar open shows
 * its name (the one field the user types) and its folder in the object tree on top, below them the
 * five tiers of the single-calendar card. The folder's id is never typed — it follows location and
 * types; a folder that would move on saving shows in yellow below it and gathered below the list.
 *
 * @param props the native records, the instance and the write callback
 */
export function CalendarList(props: CalendarListProps): React.JSX.Element {
  const { data, originalData, namespace, systemCountry, systemLanguage, dateFormat, onWriteList } = props;
  const t: Translate = (key, ...args) => I18n.t(key, ...args);
  const list = readCalendarList(data) ?? [];
  const original = readCalendarList(originalData) ?? [];
  const ctx = React.useMemo(() => namingContext(systemCountry, systemLanguage), [systemCountry, systemLanguage]);
  const { moves } = treeChanges(original, list);
  const moveOf = (uid: unknown): FolderMove | undefined => moves.find(m => m.uid === uid);

  // A single calendar starts open — it is what the card showed before there were several.
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() =>
    list.length === 1 && typeof list[0].uid === "string" ? new Set([list[0].uid]) : new Set(),
  );
  const toggle = (uid: string, expanded: boolean): void =>
    setOpen(prev => {
      const next = new Set(prev);
      if (expanded) {
        next.add(uid);
      } else {
        next.delete(uid);
      }
      return next;
    });
  const write = (next: CalendarRecord[], openUid?: unknown): void => {
    if (typeof openUid === "string") {
      toggle(openUid, true);
    }
    onWriteList(next);
  };

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Typography
        variant="h6"
        sx={{ mb: 1 }}
      >
        {t("ph_cal_title")}
      </Typography>
      {list.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1 }}
        >
          {t("ph_cal_empty")}
        </Typography>
      ) : null}
      {list.map((cal, index) => {
        const uid = typeof cal.uid === "string" ? cal.uid : `#${index}`;
        const id = typeof cal.id === "string" ? cal.id : "";
        const problem = idProblem(list, index);
        const move = moveOf(cal.uid);
        const name = displayName(cal, ctx);
        return (
          <Accordion
            key={uid}
            expanded={open.has(uid)}
            onChange={(_e, expanded) => toggle(uid, expanded)}
            disableGutters
            data-testid={`cal-${index}`}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", minWidth: 0 }}
              >
                {problem ? (
                  <ErrorIcon
                    color="error"
                    fontSize="small"
                    data-testid={`cal-${index}-error`}
                  />
                ) : null}
                <Typography noWrap>{name || t("ph_cal_no_name")}</Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  noWrap
                >
                  {id}
                </Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <DraftField
                label={t("ph_cal_name")}
                value={cal.nameAuto === true ? name : typeof cal.name === "string" ? cal.name : ""}
                placeholder={name}
                helperText={t("ph_cal_name_help")}
                onType={v => write(setCalendarName(list, index, v))}
                testId={`cal-${index}-name`}
              />
              <Box sx={{ mt: 1.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                >
                  {t("ph_cal_folder")}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
                  data-testid={`cal-${index}-folder`}
                >
                  {`${namespace}.${id}`}
                </Typography>
                {problem ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <Typography
                      variant="caption"
                      color="error"
                    >
                      {t(problem === "taken" ? "ph_cal_id_taken" : "ph_cal_id_missing")}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => write(rebuildCalendarId(list, index, ctx))}
                      data-testid={`cal-${index}-rebuild`}
                    >
                      {t("ph_cal_id_rebuild")}
                    </Button>
                  </Stack>
                ) : move ? (
                  <Typography
                    variant="caption"
                    sx={{ color: "warning.main" }}
                    data-testid={`cal-${index}-moves`}
                  >
                    {t("ph_cal_id_moves", `${namespace}.${move.from}`)}
                  </Typography>
                ) : null}
              </Box>
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ justifyContent: "flex-end" }}
              >
                <Tooltip title={t("ph_cal_up")}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={index === 0}
                      onClick={() => write(moveCalendar(list, index, -1))}
                      data-testid={`cal-${index}-up`}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t("ph_cal_down")}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={index === list.length - 1}
                      onClick={() => write(moveCalendar(list, index, 1))}
                      data-testid={`cal-${index}-down`}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t("ph_cal_copy")}>
                  <IconButton
                    size="small"
                    onClick={() => {
                      const next = copyCalendar(list, index, original, `${name}${t("ph_cal_copy_suffix")}`, ctx);
                      write(next, next[index + 1].uid);
                    }}
                    data-testid={`cal-${index}-copy`}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("ph_cal_delete")}>
                  <IconButton
                    size="small"
                    onClick={() => write(removeCalendar(list, index))}
                    data-testid={`cal-${index}-delete`}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <HolidayPanel
                data={cal}
                systemCountry={systemCountry}
                systemLanguage={systemLanguage}
                dateFormat={dateFormat}
                onChange={(attr, value) => write(patchCalendar(list, index, { [attr]: value }, original, ctx))}
                onChangeMany={patch => write(patchCalendar(list, index, patch, original, ctx))}
              />
            </AccordionDetails>
          </Accordion>
        );
      })}
      <Button
        startIcon={<AddIcon />}
        sx={{ mt: 1 }}
        onClick={() => {
          const next = addCalendar(list, original, ctx);
          write(next, next[next.length - 1].uid);
        }}
        data-testid="cal-add"
      >
        {t("ph_cal_add")}
      </Button>
      {moves.length > 0 ? (
        <Box
          sx={{ mt: 2, p: 1.5, border: 1, borderColor: "warning.main", borderRadius: 1 }}
          data-testid="cal-moves"
        >
          <Typography
            variant="subtitle2"
            color="warning.main"
          >
            {moves.length === 1 ? t("ph_cal_moves_one") : t("ph_cal_moves_many", moves.length)}
          </Typography>
          {moves.map(m => (
            <Typography
              key={m.uid}
              variant="body2"
              sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
            >
              {`${namespace}.${m.from} → ${namespace}.${m.to}`}
            </Typography>
          ))}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            {t("ph_cal_moves_note")}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}

/** Props of the box at the end of the page. */
export interface TreeChangesBoxProps {
  /** The jsonConfig `native` record. */
  data: Record<string, unknown>;
  /** The `native` record as saved. */
  originalData: Record<string, unknown>;
  /** The instance namespace. */
  namespace: string;
  /** `system.config.common.country`. */
  systemCountry: string;
  /** `system.config.common.language`. */
  systemLanguage: string;
}

/**
 * The red box right above the Save button: what saving changes in the object tree — every folder
 * that moves and every folder that goes with a deleted calendar. Empty while nothing changes.
 *
 * @param props the native records and the instance
 */
export function TreeChangesBox(props: TreeChangesBoxProps): React.JSX.Element {
  const { data, originalData, namespace, systemCountry, systemLanguage } = props;
  const t: Translate = (key, ...args) => I18n.t(key, ...args);
  const ctx = React.useMemo(() => namingContext(systemCountry, systemLanguage), [systemCountry, systemLanguage]);
  const original = readCalendarList(originalData) ?? [];
  const { moves, removals } = treeChanges(original, readCalendarList(data) ?? []);
  if (moves.length === 0 && removals.length === 0) {
    return <Box data-testid="tree-changes-none" />;
  }
  return (
    <Box
      sx={{ p: 1.5, border: 1, borderColor: "error.main", borderRadius: 1, maxWidth: 760 }}
      data-testid="tree-changes"
    >
      <Typography
        variant="subtitle2"
        color="error.main"
      >
        {t("ph_tree_title")}
      </Typography>
      {moves.map(m => (
        <Typography
          key={`m-${m.uid}`}
          variant="body2"
          sx={{ wordBreak: "break-all" }}
        >
          {t("ph_tree_moves", `${namespace}.${m.from}`, `${namespace}.${m.to}`)}
        </Typography>
      ))}
      {removals.map(r => {
        const saved = original.find(c => c.id === r.id) ?? {};
        return (
          <Typography
            key={`r-${r.id}`}
            variant="body2"
            sx={{ wordBreak: "break-all" }}
          >
            {t("ph_tree_deleted", `${namespace}.${r.id}`, r.name || displayName(saved, ctx))}
          </Typography>
        );
      })}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mt: 0.5 }}
      >
        {t("ph_tree_note")}
      </Typography>
    </Box>
  );
}
