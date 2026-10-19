import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import LocationComparisonMap from "@/components/LocationComparisonMap";
import { supabase } from "@/lib/supabase";
import { firstRpcRow } from "@/utils/supabaseRpc";
import {
  CurrentLocationVisitService,
  VerificationStatus,
} from "@/services/current-location-visit.service";
import { BusinessClockService } from "@/services/business-clock.service";
import { businessMonthRange, formatBusinessDate } from "@/utils/businessDate";
import { formatHrmsDateTime, formatHrmsTime } from "@/utils/attendanceTimestamp";
import { fetchAllPages } from "@/utils/supabasePagination";
import { EvidencePhoto } from "@/components/EvidencePhoto";
import { useTheme } from "@/hooks/useTheme";

// ── constants ────────────────────────────────────────────────────────────────
type Theme = ReturnType<typeof useTheme>["theme"];
type IconName = React.ComponentProps<typeof Feather>["name"];
type StatusKey =
  | "ALL"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_INFORMATION"
  | "FLAGGED";
type PhotoKey = "ALL" | "ADDED" | "NONE";

const statuses: StatusKey[] = [
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "NEEDS_INFORMATION",
  "FLAGGED",
];
const reasons = [
  "ALL",
  "Visiting a different project site",
  "Client meeting",
  "Channel partner meeting",
  "Property inspection",
  "Event duty",
  "Temporary office location",
  "The saved site pin appears incorrect",
  "Site location is not available in the predefined list",
  "Other official work",
];
const photoOptions: { key: PhotoKey; label: string; icon: IconName }[] = [
  { key: "ALL", label: "All Photos", icon: "layers" },
  { key: "ADDED", label: "Photo Added", icon: "camera" },
  { key: "NONE", label: "No Photo", icon: "camera-off" },
];
const MARKED_MATCH_STATUSES = [
  "CURRENT_LOCATION_MARKED",
  "LOW_ACCURACY",
  "MOCK_LOCATION_FLAGGED",
];
const VISIT_SELECT =
  "*, profiles:user_id(name,employee_number,role,office_id,reports_to,team,office:office_id(name)), selected_site:selected_site_id(id,site_label,address,project_name,latitude,longitude,checkin_radius_m)";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TWO_COLUMN_MIN_WIDTH = 760;
const CARD_GAP = 12;

const isNum = (n: unknown) =>
  n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const fmtDistance = (n: unknown) => {
  if (!isNum(n)) return "—";
  const v = Number(n);
  return v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`;
};
const fmtAccuracy = (n: unknown) =>
  isNum(n) ? `±${Math.round(Number(n))} m` : "—";
const humanize = (value: string) =>
  String(value || "")
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
const showError = (message: string) =>
  Platform.OS === "web"
    ? window.alert(message)
    : Alert.alert("Unable to continue", message);

function statusTone(value: string, t: Theme) {
  switch (value) {
    case "ALL":
      return { fg: t.primary, bg: `${t.primary}1F`, label: "All", icon: "list" as IconName };
    case "PENDING":
      return { fg: t.warningText, bg: t.warningBg, label: "Pending", icon: "clock" as IconName };
    case "APPROVED":
      return { fg: t.successText, bg: t.successBg, label: "Approved", icon: "check-circle" as IconName };
    case "REJECTED":
      return { fg: t.errorText, bg: t.errorBg, label: "Rejected", icon: "x-circle" as IconName };
    case "NEEDS_INFORMATION":
      return { fg: t.infoText, bg: t.infoBg, label: "Needs Information", icon: "help-circle" as IconName };
    case "FLAGGED":
      return { fg: t.accent4, bg: `${t.accent4}24`, label: "Flagged", icon: "flag" as IconName };
    default:
      return { fg: t.textSecondary, bg: t.backgroundSecondary, label: humanize(value), icon: "circle" as IconName };
  }
}

// ── main panel ───────────────────────────────────────────────────────────────
export default function MarkedLocationReviewPanel() {
  const { theme: t } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusKey>("PENDING");
  const [reason, setReason] = useState("ALL");
  const [photo, setPhoto] = useState<PhotoKey>("ALL");
  const [employee, setEmployee] = useState("");
  const [team, setTeam] = useState("");
  const [office, setOffice] = useState("");
  const [selectedSite, setSelectedSite] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [defaultRange, setDefaultRange] = useState<{ from: string; to: string } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(windowWidth >= 900);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const [selected, setSelected] = useState<any>(null);

  const datesValid = DATE_RE.test(fromDate) && DATE_RE.test(toDate);

  // Status and the text filters are applied on the client so that every
  // status chip can show a count from the same result set.
  const load = useCallback(async () => {
    if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await fetchAllPages<any>((from, to) => {
      let query = supabase
        .from("field_visits")
        .select(VISIT_SELECT)
        .in("location_match_status", MARKED_MATCH_STATUSES)
        .gte("date", fromDate)
        .lte("date", toDate)
        .order("submitted_at", { ascending: false })
        .order("id", { ascending: true });
      if (reason !== "ALL") query = query.eq("location_mismatch_reason", reason);
      if (photo !== "ALL")
        query = query.eq("evidence_photo_added", photo === "ADDED");
      return query.range(from, to);
    });
    if (error) setLoadError(String(error?.message || error));
    setRows(data || []);
    setLoading(false);
  }, [reason, photo, fromDate, toDate]);

  useEffect(() => {
    let active = true;
    void BusinessClockService.getDate(true)
      .then((date) => {
        if (!active) return;
        const start = businessMonthRange(date).start;
        setFromDate(start);
        setToDate(date);
        setDefaultRange({ from: start, to: date });
      })
      .catch((error) => {
        if (active) showError(String(error?.message || error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const textFiltered = useMemo(() => {
    const term = (value: string) => value.trim().toLocaleLowerCase();
    const has = (value: unknown, q: string) =>
      !term(q) || String(value || "").toLocaleLowerCase().includes(term(q));
    return rows.filter(
      (row: any) =>
        has(row.profiles?.name, employee) &&
        has(row.profiles?.team, team) &&
        has(row.profiles?.office?.name, office) &&
        has(row.selected_site?.site_label, selectedSite),
    );
  }, [rows, employee, team, office, selectedSite]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: textFiltered.length };
    for (const row of textFiltered) {
      const k = String(row.verification_status || "");
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [textFiltered]);

  const visible = useMemo(
    () =>
      status === "ALL"
        ? textFiltered
        : textFiltered.filter((row: any) => row.verification_status === status),
    [textFiltered, status],
  );

  const datesChanged =
    !!defaultRange && (fromDate !== defaultRange.from || toDate !== defaultRange.to);
  const activeFilters: { key: string; label: string; clear: () => void }[] = [];
  if (employee.trim())
    activeFilters.push({ key: "employee", label: `Employee: ${employee.trim()}`, clear: () => setEmployee("") });
  if (team.trim())
    activeFilters.push({ key: "team", label: `Team: ${team.trim()}`, clear: () => setTeam("") });
  if (office.trim())
    activeFilters.push({ key: "office", label: `Office: ${office.trim()}`, clear: () => setOffice("") });
  if (selectedSite.trim())
    activeFilters.push({ key: "site", label: `Site: ${selectedSite.trim()}`, clear: () => setSelectedSite("") });
  if (photo !== "ALL")
    activeFilters.push({
      key: "photo",
      label: photo === "ADDED" ? "Photo Added" : "No Photo",
      clear: () => setPhoto("ALL"),
    });
  if (reason !== "ALL")
    activeFilters.push({ key: "reason", label: reason, clear: () => setReason("ALL") });
  if (datesChanged && defaultRange)
    activeFilters.push({
      key: "dates",
      label: `Dates: ${fromDate || "?"} → ${toDate || "?"}`,
      clear: () => {
        setFromDate(defaultRange.from);
        setToDate(defaultRange.to);
      },
    });
  const panelFilterCount = activeFilters.filter((f) => f.key !== "employee").length;

  const clearFilters = () => {
    setEmployee("");
    setTeam("");
    setOffice("");
    setSelectedSite("");
    setPhoto("ALL");
    setReason("ALL");
    setReasonOpen(false);
    if (defaultRange) {
      setFromDate(defaultRange.from);
      setToDate(defaultRange.to);
    }
  };

  const twoColumns = listWidth >= TWO_COLUMN_MIN_WIDTH;
  const cardWidth = twoColumns ? (listWidth - CARD_GAP) / 2 : undefined;
  const rangeLabel =
    fromDate && toDate
      ? `${formatBusinessDate(fromDate)} – ${formatBusinessDate(toDate)}`
      : "Loading date range…";
  const inputStyle = [
    s.input,
    { borderColor: t.border, backgroundColor: t.backgroundSecondary, color: t.text },
  ];
  const initialLoading = loading && rows.length === 0 && !loadError;

  return (
    <View>
      {/* ── header ── */}
      <View style={[s.panel, { backgroundColor: t.backgroundDefault, borderColor: t.border }]}>
        <View style={s.headerRow}>
          <View style={[s.headerIcon, { backgroundColor: `${t.primary}1F` }]}>
            <Feather name="map-pin" size={18} color={t.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={[s.title, { color: t.text }]}>Current Locations Marked</ThemedText>
            <ThemedText style={[s.subtitle, { color: t.textSecondary }]}>
              Field visits where the employee marked a location away from the selected site.
            </ThemedText>
          </View>
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: t.border, backgroundColor: t.backgroundSecondary }]}
            onPress={() => void load()}
            disabled={loading || !datesValid}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
          >
            {loading ? (
              <ActivityIndicator size="small" color={t.primary} />
            ) : (
              <Feather name="refresh-cw" size={16} color={t.primary} />
            )}
          </TouchableOpacity>
        </View>
        <View style={s.metaLine}>
          <Feather name="calendar" size={12} color={t.textSecondary} />
          <ThemedText style={[s.metaText, { color: t.textSecondary }]}>{rangeLabel}</ThemedText>
          <View style={[s.dot, { backgroundColor: t.textTertiary }]} />
          <ThemedText style={[s.metaText, { color: t.text, fontWeight: "700" }]}>
            {loading && rows.length === 0
              ? "Loading…"
              : `${visible.length} ${visible.length === 1 ? "request" : "requests"}`}
          </ThemedText>
        </View>

        {/* ── status chips ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipRow}
          style={{ marginTop: 12, marginHorizontal: -2 }}
        >
          {statuses.map((key) => {
            const tone = statusTone(key, t);
            const active = status === key;
            const flagged = key === "FLAGGED";
            const count = counts[key] || 0;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setStatus(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  s.statusChip,
                  {
                    borderColor: active ? tone.fg : flagged ? `${tone.fg}66` : t.border,
                    backgroundColor: active ? tone.bg : t.backgroundDefault,
                  },
                  flagged && !active && { borderStyle: "dashed" },
                ]}
              >
                <Feather
                  name={tone.icon}
                  size={13}
                  color={active || flagged ? tone.fg : t.textSecondary}
                />
                <ThemedText
                  style={[
                    s.statusChipText,
                    { color: active ? tone.fg : flagged ? tone.fg : t.text },
                    active && { fontWeight: "800" },
                  ]}
                >
                  {key === "ALL" ? "All" : tone.label}
                </ThemedText>
                <View
                  style={[
                    s.countBadge,
                    { backgroundColor: active ? tone.fg : t.backgroundSecondary },
                  ]}
                >
                  <ThemedText
                    style={[
                      s.countText,
                      { color: active ? t.backgroundDefault : t.textSecondary },
                    ]}
                  >
                    {count}
                  </ThemedText>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* ── search + filters toggle ── */}
        <View style={s.searchRow}>
          <View
            style={[
              s.searchBox,
              { borderColor: t.border, backgroundColor: t.backgroundSecondary },
            ]}
          >
            <Feather name="search" size={15} color={t.textSecondary} />
            <TextInput
              style={[s.searchInput, { color: t.text }]}
              value={employee}
              onChangeText={setEmployee}
              placeholder="Search employee name"
              placeholderTextColor={t.textTertiary}
            />
            {!!employee && (
              <TouchableOpacity onPress={() => setEmployee("")} hitSlop={8} accessibilityLabel="Clear search">
                <Feather name="x" size={15} color={t.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={() => setFiltersOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersOpen }}
            style={[
              s.filterToggle,
              {
                borderColor: filtersOpen || panelFilterCount ? t.primary : t.border,
                backgroundColor: filtersOpen ? `${t.primary}1F` : t.backgroundSecondary,
              },
            ]}
          >
            <Feather name="sliders" size={15} color={t.primary} />
            <ThemedText style={[s.filterToggleText, { color: t.primary }]}>Filters</ThemedText>
            {panelFilterCount > 0 && (
              <View style={[s.countBadge, { backgroundColor: t.primary }]}>
                <ThemedText style={[s.countText, { color: "#FFFFFF" }]}>{panelFilterCount}</ThemedText>
              </View>
            )}
            <Feather name={filtersOpen ? "chevron-up" : "chevron-down"} size={15} color={t.primary} />
          </TouchableOpacity>
        </View>

        {/* ── secondary filters ── */}
        {filtersOpen && (
          <View style={[s.filterPanel, { borderTopColor: t.borderLight }]}>
            <FilterLabel text="Date range" />
            <View style={s.wrapRow}>
              <TextInput
                style={[inputStyle, s.gridField]}
                value={fromDate}
                onChangeText={setFromDate}
                placeholder="From YYYY-MM-DD"
                placeholderTextColor={t.textTertiary}
              />
              <TextInput
                style={[inputStyle, s.gridField]}
                value={toDate}
                onChangeText={setToDate}
                placeholder="To YYYY-MM-DD"
                placeholderTextColor={t.textTertiary}
              />
            </View>
            {!datesValid && (fromDate !== "" || toDate !== "") && (
              <ThemedText style={[s.hint, { color: t.warning }]}>
                Enter both dates as YYYY-MM-DD to update the results.
              </ThemedText>
            )}

            <FilterLabel text="Team, office & site" />
            <View style={s.wrapRow}>
              <TextInput
                style={[inputStyle, s.gridField]}
                value={team}
                onChangeText={setTeam}
                placeholder="Team"
                placeholderTextColor={t.textTertiary}
              />
              <TextInput
                style={[inputStyle, s.gridField]}
                value={office}
                onChangeText={setOffice}
                placeholder="Office"
                placeholderTextColor={t.textTertiary}
              />
              <TextInput
                style={[inputStyle, s.gridField]}
                value={selectedSite}
                onChangeText={setSelectedSite}
                placeholder="Selected site"
                placeholderTextColor={t.textTertiary}
              />
            </View>

            <FilterLabel text="Photo evidence" />
            <View style={[s.segment, { backgroundColor: t.backgroundSecondary, borderColor: t.border }]}>
              {photoOptions.map((opt) => {
                const active = photo === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setPhoto(opt.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      s.segmentBtn,
                      active && { backgroundColor: t.primary },
                    ]}
                  >
                    <Feather name={opt.icon} size={13} color={active ? "#FFFFFF" : t.textSecondary} />
                    <ThemedText
                      numberOfLines={1}
                      style={[s.segmentText, { color: active ? "#FFFFFF" : t.text }]}
                    >
                      {opt.label}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>

            <FilterLabel text="Mismatch reason" />
            <TouchableOpacity
              onPress={() => setReasonOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: reasonOpen }}
              style={[
                s.select,
                {
                  borderColor: reasonOpen || reason !== "ALL" ? t.primary : t.border,
                  backgroundColor: t.backgroundSecondary,
                },
              ]}
            >
              <Feather name="help-circle" size={15} color={t.textSecondary} />
              <ThemedText numberOfLines={1} style={[s.selectText, { color: t.text }]}>
                {reason === "ALL" ? "All mismatch reasons" : reason}
              </ThemedText>
              <Feather name={reasonOpen ? "chevron-up" : "chevron-down"} size={16} color={t.textSecondary} />
            </TouchableOpacity>
            {reasonOpen && (
              <View style={[s.selectList, { borderColor: t.border, backgroundColor: t.backgroundDefault }]}>
                {reasons.map((v, i) => {
                  const active = reason === v;
                  return (
                    <TouchableOpacity
                      key={v}
                      onPress={() => {
                        setReason(v);
                        setReasonOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        s.selectOption,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
                        active && { backgroundColor: `${t.primary}14` },
                      ]}
                    >
                      <ThemedText
                        style={[
                          s.selectOptionText,
                          { color: active ? t.primary : t.text },
                          active && { fontWeight: "700" },
                        ]}
                      >
                        {v === "ALL" ? "All mismatch reasons" : v}
                      </ThemedText>
                      {active && <Feather name="check" size={15} color={t.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── active filter summary ── */}
        {activeFilters.length > 0 && (
          <View style={[s.activeRow, { borderTopColor: t.borderLight }]}>
            {activeFilters.map((f) => (
              <TouchableOpacity
                key={f.key}
                onPress={f.clear}
                accessibilityRole="button"
                accessibilityLabel={`Remove filter ${f.label}`}
                style={[s.activeChip, { backgroundColor: `${t.primary}14`, borderColor: `${t.primary}40` }]}
              >
                <ThemedText numberOfLines={1} style={[s.activeChipText, { color: t.primary }]}>
                  {f.label}
                </ThemedText>
                <Feather name="x" size={12} color={t.primary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={clearFilters} accessibilityRole="button" style={s.clearBtn}>
              <Feather name="rotate-ccw" size={12} color={t.error} />
              <ThemedText style={[s.clearText, { color: t.error }]}>Clear filters</ThemedText>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── results ── */}
      {loadError && (
        <View style={[s.errorBox, { backgroundColor: t.errorBg, borderColor: `${t.error}55` }]}>
          <Feather name="alert-triangle" size={15} color={t.errorText} />
          <ThemedText style={[s.errorText, { color: t.errorText }]}>
            Could not load marked locations: {loadError}
          </ThemedText>
          <TouchableOpacity onPress={() => void load()} hitSlop={8}>
            <ThemedText style={[s.errorText, { color: t.errorText, fontWeight: "800" }]}>Retry</ThemedText>
          </TouchableOpacity>
        </View>
      )}
      {initialLoading ? (
        <View style={[s.stateBox, { backgroundColor: t.backgroundDefault, borderColor: t.border }]}>
          <ActivityIndicator color={t.primary} />
          <ThemedText style={[s.stateText, { color: t.textSecondary }]}>Loading marked locations…</ThemedText>
        </View>
      ) : visible.length === 0 ? (
        loadError ? null : (
          <View style={[s.stateBox, { backgroundColor: t.backgroundDefault, borderColor: t.border }]}>
            <View style={[s.stateIcon, { backgroundColor: t.backgroundSecondary }]}>
              <Feather name="map" size={24} color={t.textSecondary} />
            </View>
            <ThemedText style={[s.stateTitle, { color: t.text }]}>
              No marked locations match these filters
            </ThemedText>
            <ThemedText style={[s.stateText, { color: t.textSecondary }]}>
              {status !== "ALL"
                ? `Showing ${statusTone(status, t).label.toLowerCase()} requests only. `
                : ""}
              Try another status, widen the date range, or clear the filters.
            </ThemedText>
            <View style={s.stateActions}>
              {activeFilters.length > 0 && (
                <TouchableOpacity
                  onPress={clearFilters}
                  style={[s.stateBtn, { backgroundColor: t.primary }]}
                >
                  <ThemedText style={s.stateBtnText}>Clear filters</ThemedText>
                </TouchableOpacity>
              )}
              {status !== "ALL" && (
                <TouchableOpacity
                  onPress={() => setStatus("ALL")}
                  style={[s.stateBtn, { borderWidth: 1, borderColor: t.primary }]}
                >
                  <ThemedText style={[s.stateBtnText, { color: t.primary }]}>Show all statuses</ThemedText>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )
      ) : (
        <View
          onLayout={(e: LayoutChangeEvent) => setListWidth(e.nativeEvent.layout.width)}
          style={s.grid}
        >
          {visible.map((row) => (
            <RequestCard
              key={row.id}
              row={row}
              width={cardWidth}
              onOpen={() => setSelected(row)}
            />
          ))}
        </View>
      )}
      <ReviewModal
        visit={selected}
        onClose={() => setSelected(null)}
        onUpdated={load}
      />
    </View>
  );
}

function FilterLabel({ text }: { text: string }) {
  const { theme: t } = useTheme();
  return <ThemedText style={[s.filterLabel, { color: t.textSecondary }]}>{text.toUpperCase()}</ThemedText>;
}

function StatusPill({ value }: { value: string }) {
  const { theme: t } = useTheme();
  const tone = statusTone(value, t);
  return (
    <View style={[s.pill, { backgroundColor: tone.bg }]}>
      <Feather name={tone.icon} size={11} color={tone.fg} />
      <ThemedText style={[s.pillText, { color: tone.fg }]}>{tone.label}</ThemedText>
    </View>
  );
}

// ── request card ─────────────────────────────────────────────────────────────
function RequestCard({
  row,
  width,
  onOpen,
}: {
  row: any;
  width?: number;
  onOpen: () => void;
}) {
  const { theme: t } = useTheme();
  const name = String(row.profiles?.name || "Unknown employee");
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p: string) => p[0]?.toUpperCase())
    .join("");
  const subline = [row.profiles?.employee_number, row.profiles?.team]
    .filter(Boolean)
    .join(" · ");
  const lowAccuracy = row.location_match_status === "LOW_ACCURACY";
  const mock =
    row.location_match_status === "MOCK_LOCATION_FLAGGED" || !!row.mocked_location_detected;
  const hasPhoto = !!row.evidence_photo_added;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Review marked location for ${name}`}
      style={[
        s.card,
        { backgroundColor: t.backgroundDefault, borderColor: t.border },
        width ? { width } : { width: "100%" },
      ]}
    >
      {/* identity */}
      <View style={s.cardTop}>
        <View style={[s.avatar, { backgroundColor: `${t.primary}1F` }]}>
          <ThemedText style={[s.avatarText, { color: t.primary }]}>{initials || "?"}</ThemedText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText numberOfLines={1} style={[s.name, { color: t.text }]}>{name}</ThemedText>
          {!!subline && (
            <ThemedText numberOfLines={1} style={[s.small, { color: t.textSecondary }]}>{subline}</ThemedText>
          )}
        </View>
        <StatusPill value={row.verification_status} />
      </View>

      <View style={s.metaLine}>
        <Feather name="calendar" size={12} color={t.textSecondary} />
        <ThemedText style={[s.metaText, { color: t.textSecondary }]}>{formatBusinessDate(row.date)}</ThemedText>
        <View style={[s.dot, { backgroundColor: t.textTertiary }]} />
        <Feather name="clock" size={12} color={t.textSecondary} />
        <ThemedText style={[s.metaText, { color: t.textSecondary }]}>
          {formatHrmsTime(row.submitted_at || row.actual_location_captured_at, "—")}
        </ThemedText>
      </View>

      {/* locations */}
      <View style={[s.locBox, { backgroundColor: t.backgroundSecondary }]}>
        <View style={s.locRow}>
          <Feather name="crosshair" size={14} color={t.primary} style={s.locIcon} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={[s.locLabel, { color: t.textSecondary }]}>MARKED LOCATION</ThemedText>
            <ThemedText numberOfLines={2} style={[s.locValue, { color: t.text }]}>
              {row.actual_location_name || "Location name not available"}
            </ThemedText>
            {!!row.actual_location_address && (
              <ThemedText numberOfLines={1} style={[s.small, { color: t.textSecondary }]}>
                {row.actual_location_address}
              </ThemedText>
            )}
          </View>
        </View>
        <View style={[s.locDivider, { backgroundColor: t.border }]} />
        <View style={s.locRow}>
          <Feather name="flag" size={14} color={t.textSecondary} style={s.locIcon} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText style={[s.locLabel, { color: t.textSecondary }]}>SELECTED SITE</ThemedText>
            <ThemedText numberOfLines={1} style={[s.locValue, { color: t.text }]}>
              {row.selected_site?.site_label || "Unknown"}
            </ThemedText>
          </View>
          <View style={[s.distance, { backgroundColor: t.warningBg }]}>
            <ThemedText style={[s.distanceText, { color: t.warningText }]}>
              {fmtDistance(row.selected_site_distance_metres)} away
            </ThemedText>
          </View>
        </View>
      </View>

      {/* reason + note */}
      {!!row.location_mismatch_reason && (
        <View style={s.reasonRow}>
          <ThemedText style={[s.reasonLabel, { color: t.textSecondary }]}>Reason</ThemedText>
          <View style={[s.reasonChip, { borderColor: `${t.primary}40`, backgroundColor: `${t.primary}12` }]}>
            <ThemedText numberOfLines={2} style={[s.reasonText, { color: t.primary }]}>
              {row.location_mismatch_reason}
            </ThemedText>
          </View>
        </View>
      )}
      {!!row.location_mismatch_explanation && (
        <ThemedText numberOfLines={3} style={[s.note, { color: t.text, borderLeftColor: t.border }]}>
          {row.location_mismatch_explanation}
        </ThemedText>
      )}

      {/* indicators + action */}
      <View style={[s.cardFooter, { borderTopColor: t.borderLight }]}>
        <View style={s.badges}>
          <Badge
            icon={hasPhoto ? "camera" : "camera-off"}
            text={hasPhoto ? "Photo added" : "No photo"}
            fg={hasPhoto ? t.successText : t.textSecondary}
            bg={hasPhoto ? t.successBg : t.backgroundSecondary}
          />
          <Badge
            icon="navigation"
            text={`GPS ${fmtAccuracy(row.actual_location_accuracy_metres)}`}
            fg={lowAccuracy ? t.warningText : t.textSecondary}
            bg={lowAccuracy ? t.warningBg : t.backgroundSecondary}
          />
          {mock && (
            <Badge icon="alert-triangle" text="Mock location" fg={t.errorText} bg={t.errorBg} />
          )}
        </View>
        <View style={[s.reviewBtn, { backgroundColor: t.primary }]}>
          <ThemedText style={s.reviewBtnText}>Review</ThemedText>
          <Feather name="chevron-right" size={14} color="#FFFFFF" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Badge({ icon, text, fg, bg }: { icon: IconName; text: string; fg: string; bg: string }) {
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Feather name={icon} size={11} color={fg} />
      <ThemedText style={[s.badgeText, { color: fg }]}>{text}</ThemedText>
    </View>
  );
}

// ── review modal ─────────────────────────────────────────────────────────────
function ReviewModal({
  visit,
  onClose,
  onUpdated,
}: {
  visit: any;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { theme: t } = useTheme();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteReview, setSiteReview] = useState(false);
  const [sameSiteCount, setSameSiteCount] = useState(0);
  const [siteLat, setSiteLat] = useState("");
  const [siteLon, setSiteLon] = useState("");
  const [siteRadius, setSiteRadius] = useState("");
  useEffect(() => {
    setNotes(visit?.reviewer_notes || "");
    setSiteReview(false);
    setSiteLat(String(visit?.selected_site_latitude ?? ""));
    setSiteLon(String(visit?.selected_site_longitude ?? ""));
    setSiteRadius(String(visit?.selected_site_radius_metres ?? ""));
    if (visit?.selected_site_id)
      supabase
        .from("field_visits")
        .select("id", { count: "exact", head: true })
        .eq("selected_site_id", visit.selected_site_id)
        .in("location_match_status", MARKED_MATCH_STATUSES)
        .then((result: { count: number | null }) =>
          setSameSiteCount(Math.max(0, (result.count || 0) - 1)),
        );
  }, [
    visit?.id,
    visit?.reviewer_notes,
    visit?.selected_site_latitude,
    visit?.selected_site_longitude,
    visit?.selected_site_radius_metres,
    visit?.evidence_photo_path,
    visit?.selected_site_id,
  ]);
  if (!visit) return null;
  const act = async (decision: Exclude<VerificationStatus, "PENDING">) => {
    if (decision !== "APPROVED" && !notes.trim()) {
      showError("Reviewer notes are required.");
      return;
    }
    setBusy(true);
    const { error } = await CurrentLocationVisitService.review(
      visit.id,
      decision,
      notes,
    );
    setBusy(false);
    if (error) {
      showError(error.message);
      return;
    }
    onUpdated();
    onClose();
  };
  const saveSiteReview = async (keepExisting: boolean) => {
    if (!notes.trim()) {
      showError("Add site-review notes first.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("rpc_review_predefined_site_location_v2", {
      p_field_visit_id: visit.id,
      p_new_latitude: Number(siteLat),
      p_new_longitude: Number(siteLon),
      p_new_radius_metres: Number(siteRadius),
      p_notes: notes.trim(),
      p_keep_existing: keepExisting,
    });
    setBusy(false);
    if (error) {
      showError(error.message);
      return;
    }
    const response = firstRpcRow<any>(data);
    if (
      response?.success !== true ||
      response?.field_visit_id !== visit.id
    ) {
      showError("The server did not confirm the site-location review.");
      return;
    }
    setSiteReview(false);
    onUpdated();
  };
  const cardStyle = [s.mCard, { backgroundColor: t.backgroundDefault, borderColor: t.border }];
  const inputStyle = [
    s.input,
    { borderColor: t.border, backgroundColor: t.backgroundSecondary, color: t.text },
  ];
  const fmtStamp = (v: string | null | undefined) => formatHrmsDateTime(v, "—");
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.backgroundRoot }}>
        <View
          style={[
            s.modalHeader,
            { backgroundColor: t.backgroundDefault, borderBottomColor: t.border },
          ]}
        >
          <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <Feather name="x" size={22} color={t.text} />
          </TouchableOpacity>
          <ThemedText style={[s.modalTitle, { color: t.text }]}>Marked Location Review</ThemedText>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={s.modalBody}>
          <View style={s.modalInner}>
            {/* summary */}
            <View style={cardStyle}>
              <View style={s.cardTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ThemedText style={[s.name, { color: t.text }]}>
                    {visit.profiles?.name}
                  </ThemedText>
                  <ThemedText style={[s.small, { color: t.textSecondary }]}>
                    {[visit.profiles?.employee_number, formatBusinessDate(visit.date)]
                      .filter(Boolean)
                      .join(" · ")}
                  </ThemedText>
                </View>
                <StatusPill value={visit.verification_status} />
              </View>
              <SectionTitle text="Employee" />
              <Info label="Team" value={visit.profiles?.team || "—"} />
              <Info label="Office" value={visit.profiles?.office?.name || "—"} />
            </View>

            <View style={cardStyle}>
              <SectionTitle text="Location comparison" />
              <Info
                label="Selected predefined site"
                value={visit.selected_site?.site_label || "—"}
              />
              <Info
                label="Selected-site address"
                value={visit.selected_site?.address || "—"}
              />
              <Info
                label="Actual marked location"
                value={visit.actual_location_name || "—"}
              />
              <Info
                label="Detected address"
                value={visit.actual_location_address || "Address not detected"}
              />
              <Info
                label="Distance / allowed"
                value={`${fmtDistance(visit.selected_site_distance_metres)} / ${isNum(visit.selected_site_radius_metres) ? `${visit.selected_site_radius_metres} m` : "—"}`}
              />
              <Info
                label="GPS accuracy"
                value={fmtAccuracy(visit.actual_location_accuracy_metres)}
              />
              <Info
                label="Captured / submitted"
                value={`${fmtStamp(visit.actual_location_captured_at)} / ${fmtStamp(visit.submitted_at)}`}
                last
              />
            </View>

            <LocationComparisonMap
              selected={{
                latitude: visit.selected_site_latitude,
                longitude: visit.selected_site_longitude,
                name: visit.selected_site?.site_label || "Selected site",
              }}
              actual={{
                latitude: visit.actual_latitude,
                longitude: visit.actual_longitude,
                name: visit.actual_location_name,
              }}
              radiusMetres={visit.selected_site_radius_metres}
            />

            <View style={cardStyle}>
              <SectionTitle text="Request details" />
              <Info
                label="Mismatch reason"
                value={visit.location_mismatch_reason || "—"}
              />
              <Info
                label="Explanation"
                value={visit.location_mismatch_explanation || "—"}
              />
              <Info label="Visit purpose" value={visit.visit_purpose || "—"} />
              <Info
                label="Client/project/company"
                value={visit.client_project_company_name || "—"}
              />
              <Info
                label="Expected duration"
                value={isNum(visit.expected_duration_minutes) ? `${visit.expected_duration_minutes} minutes` : "—"}
              />
              <Info
                label="Additional notes"
                value={visit.additional_notes || "—"}
                last
              />
            </View>

            <View style={cardStyle}>
              <SectionTitle text="Risk signals" />
              <Info
                label="Mock-location indicator"
                value={visit.mocked_location_detected ? "FLAGGED" : "Not detected"}
                valueColor={visit.mocked_location_detected ? t.error : undefined}
              />
              <Info label="Risk score" value={String(visit.location_risk_score ?? "—")} />
              <Info label="Verification status" value={humanize(visit.verification_status)} />
              <Info
                label="Other mismatches at this site"
                value={String(sameSiteCount)}
                last
              />
            </View>

            <View style={cardStyle}>
              <SectionTitle text="Photo evidence" />
              {visit.evidence_photo_path ? (
                <EvidencePhoto
                  path={visit.evidence_photo_path}
                  height={260}
                  caption={visit.actual_location_accuracy_metres != null
                    ? `GPS accuracy ±${Math.round(visit.actual_location_accuracy_metres)} m`
                    : null}
                />
              ) : (
                <View style={[s.noPhoto, { backgroundColor: t.backgroundSecondary }]}>
                  <Feather name="camera-off" size={18} color={t.textSecondary} />
                  <ThemedText style={[s.small, { color: t.textSecondary }]}>
                    No photo evidence provided
                  </ThemedText>
                </View>
              )}
            </View>

            {visit.location_mismatch_reason ===
              "The saved site pin appears incorrect" && (
              <>
                <TouchableOpacity
                  style={[s.siteReview, { backgroundColor: t.warningBg }]}
                  onPress={() => setSiteReview((v) => !v)}
                >
                  <Feather name="map-pin" size={16} color={t.warningText} />
                  <ThemedText style={{ color: t.warningText, fontWeight: "700" }}>
                    Review Predefined Site Location
                  </ThemedText>
                </TouchableOpacity>
                {siteReview && (
                  <View style={cardStyle}>
                    <ThemedText style={[s.small, { color: t.textSecondary }]}>
                      Compare employee evidence before changing the trusted site. A
                      change is never applied automatically.
                    </ThemedText>
                    <TextInput
                      style={inputStyle}
                      value={siteLat}
                      onChangeText={setSiteLat}
                      keyboardType="decimal-pad"
                      placeholder="Latitude"
                      placeholderTextColor={t.textTertiary}
                    />
                    <TextInput
                      style={inputStyle}
                      value={siteLon}
                      onChangeText={setSiteLon}
                      keyboardType="decimal-pad"
                      placeholder="Longitude"
                      placeholderTextColor={t.textTertiary}
                    />
                    <TextInput
                      style={inputStyle}
                      value={siteRadius}
                      onChangeText={setSiteRadius}
                      keyboardType="number-pad"
                      placeholder="Radius in metres"
                      placeholderTextColor={t.textTertiary}
                    />
                    <TouchableOpacity
                      style={[s.siteReview, { backgroundColor: t.warningBg, marginBottom: 0 }]}
                      onPress={() =>
                        Linking.openURL(
                          `https://www.google.com/maps/search/?api=1&query=${visit.selected_site_latitude},${visit.selected_site_longitude}`,
                        )
                      }
                    >
                      <ThemedText style={{ color: t.warningText, fontWeight: "700" }}>
                        Open Saved Pin in Maps
                      </ThemedText>
                    </TouchableOpacity>
                    <View style={s.actions}>
                      <TouchableOpacity
                        style={[s.action, { backgroundColor: "#6B7280" }]}
                        disabled={busy}
                        onPress={() => saveSiteReview(true)}
                      >
                        <ThemedText style={s.actionText}>
                          Keep Existing Pin
                        </ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.action, { backgroundColor: t.primary }]}
                        disabled={busy}
                        onPress={() => saveSiteReview(false)}
                      >
                        <ThemedText style={s.actionText}>
                          Update Site Pin
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}

            <View style={cardStyle}>
              <SectionTitle text="Reviewer notes" />
              <TextInput
                style={[inputStyle, { minHeight: 90, textAlignVertical: "top" }]}
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Required for reject, flag, or request information"
                placeholderTextColor={t.textTertiary}
              />
              <View style={s.actions}>
                {(
                  [
                    ["Approve", "APPROVED", "#059669", "check"],
                    ["Reject", "REJECTED", "#DC2626", "x"],
                    ["Request Information", "NEEDS_INFORMATION", "#D97706", "help-circle"],
                    ["Flag", "FLAGGED", "#7C3AED", "flag"],
                  ] as const
                ).map(([label, value, color, icon]) => (
                  <TouchableOpacity
                    key={value}
                    disabled={busy}
                    style={[s.action, { backgroundColor: color, opacity: busy ? 0.7 : 1 }]}
                    onPress={() => act(value)}
                  >
                    {busy ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Feather name={icon} size={15} color="#FFFFFF" />
                        <ThemedText style={s.actionText}>{label}</ThemedText>
                      </>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionTitle({ text }: { text: string }) {
  const { theme: t } = useTheme();
  return (
    <ThemedText style={[s.sectionTitle, { color: t.primary }]}>
      {text.toUpperCase()}
    </ThemedText>
  );
}

function Info({
  label,
  value,
  last,
  valueColor,
}: {
  label: string;
  value: string;
  last?: boolean;
  valueColor?: string;
}) {
  const { theme: t } = useTheme();
  return (
    <View
      style={[
        s.info,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
      ]}
    >
      <ThemedText style={[s.infoLabel, { color: t.textSecondary }]}>{label}</ThemedText>
      <ThemedText style={[s.infoValue, { color: valueColor || t.text }]}>{value}</ThemedText>
    </View>
  );
}

const s = StyleSheet.create({
  // panel
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "800", lineHeight: 22 },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  metaText: { fontSize: 12, lineHeight: 16 },
  dot: { width: 3, height: 3, borderRadius: 2 },
  chipRow: { gap: 8, paddingHorizontal: 2, paddingVertical: 2 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingLeft: 11,
    paddingRight: 6,
    paddingVertical: 6,
  },
  statusChipText: { fontSize: 13, fontWeight: "600", lineHeight: 17 },
  countBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 11, fontWeight: "800", lineHeight: 14 },
  searchRow: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center" },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 42,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    paddingVertical: 0,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
  },
  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 42,
  },
  filterToggleText: { fontSize: 13, fontWeight: "700" },
  filterPanel: { marginTop: 12, paddingTop: 4, borderTopWidth: 1 },
  filterLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 6,
  },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridField: { flexGrow: 1, flexBasis: 140, minWidth: 130 },
  hint: { fontSize: 11.5, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 14,
  },
  segment: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  segmentText: { fontSize: 12.5, fontWeight: "700", flexShrink: 1 },
  select: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    height: 44,
  },
  selectText: { flex: 1, fontSize: 14 },
  selectList: { borderWidth: 1, borderRadius: 10, marginTop: 6, overflow: "hidden" },
  selectOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  selectOptionText: { flex: 1, fontSize: 13.5 },
  activeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  activeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
    maxWidth: "100%",
  },
  activeChipText: { fontSize: 12, fontWeight: "600", flexShrink: 1 },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  clearText: { fontSize: 12, fontWeight: "700" },
  // states
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 12.5 },
  stateBox: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 8,
  },
  stateIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  stateTitle: { fontSize: 15, fontWeight: "800", textAlign: "center" },
  stateText: { fontSize: 12.5, textAlign: "center", lineHeight: 18 },
  stateActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
  stateBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  stateBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  // cards
  grid: { flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "800" },
  name: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 17 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 0,
  },
  pillText: { fontSize: 11, fontWeight: "800", lineHeight: 14 },
  locBox: { borderRadius: 10, padding: 10, gap: 8 },
  locRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  locIcon: { marginTop: 2 },
  locLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, lineHeight: 14 },
  locValue: { fontSize: 13.5, fontWeight: "700", lineHeight: 18 },
  locDivider: { height: StyleSheet.hairlineWidth, marginLeft: 22 },
  distance: {
    alignSelf: "center",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  distanceText: { fontSize: 11, fontWeight: "800" },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  reasonLabel: { fontSize: 11, fontWeight: "700" },
  reasonChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 3,
    flexShrink: 1,
  },
  reasonText: { fontSize: 12, fontWeight: "700" },
  note: {
    fontSize: 12.5,
    lineHeight: 18,
    fontStyle: "italic",
    borderLeftWidth: 3,
    paddingLeft: 9,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: "auto",
  },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 1 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  reviewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: 9,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    marginLeft: "auto",
  },
  reviewBtnText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "800" },
  // modal
  modalHeader: {
    paddingTop: Platform.OS === "ios" ? 58 : 18,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  modalBody: { padding: 16, paddingBottom: 50 },
  modalInner: { width: "100%", maxWidth: 820, alignSelf: "center", gap: 12 },
  mCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  info: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 7,
  },
  infoLabel: { width: 135, fontSize: 12, lineHeight: 17 },
  infoValue: { flex: 1, fontSize: 12.5, fontWeight: "600", lineHeight: 17 },
  noPhoto: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    padding: 14,
  },
  siteReview: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    borderRadius: 10,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  action: {
    flexGrow: 1,
    flexBasis: 150,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  actionText: { color: "#fff", fontWeight: "800", fontSize: 13.5 },
});
