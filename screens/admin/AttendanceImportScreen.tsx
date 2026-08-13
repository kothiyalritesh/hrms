import React, { useState } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, Platform,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { PageHeader } from '@/components/PageHeader';
import { useTheme } from '@/hooks/useTheme';
import {
  attendanceImportService,
  AttendanceRecord,
  EmployeeMatchResult,
  AttendanceImportResult,
} from '@/services/attendance-import.service';
import { Colors, Spacing, BorderRadius } from '@/constants/theme';
import * as Crypto from 'expo-crypto';

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PARSED_RECORDS = 25_000;

async function sha256File(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure file hashing is unavailable in this browser.");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

const STATUS_COLOR: Record<string, string> = {
  Present:    '#C6EFCE',
  Absent:     '#FFC7CE',
  'Week Off': '#FFEB9C',
  'Not Marked':'#D9D9D9',
  Incomplete: '#FCE4D6',
};
const STATUS_TEXT: Record<string, string> = {
  Present:    '#1A5C2A',
  Absent:     '#9C0006',
  'Week Off': '#7D6608',
  'Not Marked':'#444',
  Incomplete: '#BE4B03',
};

type Tab = 'preview' | 'match';

export function AttendanceImportScreen() {
  const { theme } = useTheme();

  const [stage, setStage]       = useState<'idle' | 'parsing' | 'done'>('idle');
  const [records, setRecords]   = useState<AttendanceRecord[]>([]);
  const [matched, setMatched]   = useState<EmployeeMatchResult[]>([]);
  const [tab, setTab]           = useState<Tab>('preview');
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState<'all' | 'matched' | 'unmatched'>('all');
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importDone, setImportDone] = useState<AttendanceImportResult | null>(null);
  const [importContext, setImportContext] = useState<{
    batchId: string;
    sourceFileHash: string;
  } | null>(null);
  const [error, setError]       = useState('');

  // ── File pick ────────────────────────────────────────────────────────────
  const handleFileSelect = (e: any) => {
    const file: File = e.target?.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = async (file: File) => {
    setStage('parsing');
    setError('');
    setImportDone(null);
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error(
          'The file is larger than 10 MB. Split it into smaller date ranges before importing.',
        );
      }
      const sourceFileHash = await sha256File(file);
      setImportContext({
        batchId: Crypto.randomUUID(),
        sourceFileHash,
      });
      const parsed = await attendanceImportService.parseExcelFile(file);
      if (!parsed.length) throw new Error('No records found. Check the file format.');
      if (parsed.length > MAX_PARSED_RECORDS) {
        throw new Error(
          'The file contains more than 25,000 attendance rows. Split it into smaller date ranges.',
        );
      }
      setRecords(parsed);

      const matchResults = await attendanceImportService.matchEmployees(parsed);
      setMatched(matchResults);
      setStage('done');
    } catch (err: any) {
      setError(err.message);
      setStage('idle');
    }
  };

  // ── Summary stats ─────────────────────────────────────────────────────────
  const statusCounts = records.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const matchedCount   = matched.filter(m => m.matched).length;
  const unmatchedCount = matched.filter(m => !m.matched).length;

  // ── Filtered preview rows ─────────────────────────────────────────────────
  const visibleRecords = records.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.employeeName.toLowerCase().includes(q) ||
           r.employeeCode.toLowerCase().includes(q) ||
           r.department.toLowerCase().includes(q);
  }).slice(0, 200); // cap at 200 rows for performance

  // ── Filtered match rows ────────────────────────────────────────────────────
  const visibleMatched = matched.filter(m => {
    if (filter === 'matched'   && !m.matched) return false;
    if (filter === 'unmatched' &&  m.matched) return false;
    if (search) {
      const q = search.toLowerCase();
      return m.systemEmployee.name.toLowerCase().includes(q) ||
             (m.smartOfficeName?.toLowerCase().includes(q) ?? false);
    }
    return true;
  });

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = async () => {
    setDownloading(true);
    try {
      await attendanceImportService.downloadNormalizedExcel(records);
    } finally {
      setDownloading(false);
    }
  };

  // ── Import to HRMS ────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!importContext) {
      setError("Upload the source file again so its import identity can be verified.");
      return;
    }
    setImporting(true);
    try {
      const result = await attendanceImportService.importAttendance(
        matched,
        importContext,
      );
      setImportDone(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ThemedView style={s.root}>
      <PageHeader title="Import Attendance" />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── Upload Zone ── */}
        <label htmlFor="att-file" style={{ cursor: 'pointer' }}>
          <View style={[s.uploadBox, { borderColor: theme.primary, backgroundColor: theme.backgroundDefault }]}>
            <Feather name="upload-cloud" size={36} color={theme.primary} />
            <ThemedText style={s.uploadTitle}>
              {stage === 'parsing' ? 'Processing…' : 'Click to upload Excel file'}
            </ThemedText>
            <ThemedText style={[s.uploadHint, { color: theme.textSecondary }]}>
              Wide format: Emp Code · Emp Name · Dept · 01-May-2026 · 02-May-2026 …
            </ThemedText>
            <ThemedText style={[s.uploadHint, { color: theme.textSecondary }]}>
              Only a unique verified device code is auto-matched. Name-only rows require Employee Match review.
            </ThemedText>
          </View>
        </label>
        <input id="att-file" type="file" accept=".xlsx,.xls"
          onChange={handleFileSelect} style={{ display: 'none' }} />

        {stage === 'parsing' && (
          <View style={s.center}>
            <ActivityIndicator color={theme.primary} size="large" />
            <ThemedText style={{ color: theme.textSecondary, marginTop: 10 }}>Parsing…</ThemedText>
          </View>
        )}

        {error ? (
          <View style={[s.errorBox, { borderColor: Colors.light.error }]}>
            <Feather name="alert-circle" size={14} color={Colors.light.error} />
            <ThemedText style={{ color: Colors.light.error, flex: 1, marginLeft: 8 }}>{error}</ThemedText>
          </View>
        ) : null}

        {stage === 'done' && (
          <>
            {/* ── Stats Row ── */}
            <View style={s.statsRow}>
              {([ 
                { label: 'Records',   value: records.length,          color: theme.primary },
                { label: 'Present',   value: statusCounts['Present']   ?? 0, color: '#1A5C2A' },
                { label: 'Absent',    value: statusCounts['Absent']    ?? 0, color: '#9C0006' },
                { label: 'Week Off',  value: statusCounts['Week Off']  ?? 0, color: '#7D6608' },
                { label: 'Not Marked',value: statusCounts['Not Marked']?? 0, color: '#444'    },
              ] as any[]).map(item => (
                <View key={item.label} style={[s.statBox, { backgroundColor: theme.backgroundDefault }]}>
                  <ThemedText style={[s.statNum, { color: item.color }]}>{item.value}</ThemedText>
                  <ThemedText style={[s.statLabel, { color: theme.textSecondary }]}>{item.label}</ThemedText>
                </View>
              ))}
            </View>

            {/* ── Action Buttons ── */}
            <View style={s.actionRow}>
              <Pressable style={[s.btn, { backgroundColor: '#16A34A', flex: 1, opacity: downloading ? 0.7 : 1 }]} onPress={handleDownload} disabled={downloading}>
                {downloading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather name="download" size={15} color="#fff" />
                }
                <ThemedText style={s.btnText}>{downloading ? 'Preparing…' : 'Download Excel (4 Sheets)'}</ThemedText>
              </Pressable>
              <Pressable
                style={[s.btn, { backgroundColor: theme.primary, flex: 1, opacity: matchedCount === 0 ? 0.5 : 1 }]}
                onPress={handleImport}
                disabled={matchedCount === 0 || importing}
              >
                {importing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather name="database" size={15} color="#fff" />
                }
                <ThemedText style={s.btnText}>
                  {importing ? 'Importing…' : `Import ${matchedCount} to HRMS`}
                </ThemedText>
              </Pressable>
            </View>

            {/* Import result */}
            {importDone && (
              <View style={[s.importResult, { backgroundColor: importDone.errors.length ? '#FFF7ED' : '#F0FDF4',
                borderColor: importDone.errors.length ? '#F97316' : '#16A34A' }]}>
                <Feather name={importDone.errors.length ? 'alert-triangle' : 'check-circle'}
                  size={15} color={importDone.errors.length ? '#F97316' : '#16A34A'} />
                <ThemedText style={{ marginLeft: 8, flex: 1, color: importDone.errors.length ? '#9A3412' : '#14532D' }}>
                  {`Committed batch ${importDone.batchId.slice(0, 8)}: ${importDone.imported} attendance days, ${importDone.insertedPunches} punches inserted, ${importDone.duplicatePunches} duplicates, ${importDone.rejectedPunches} rejected.`}
                </ThemedText>
              </View>
            )}

            {/* ── Tab bar ── */}
            <View style={[s.tabBar, { backgroundColor: theme.backgroundDefault }]}>
              {(['preview', 'match'] as Tab[]).map(t => (
                <Pressable key={t} style={[s.tabBtn, tab === t && { borderBottomColor: theme.primary }]}
                  onPress={() => setTab(t)}>
                  <ThemedText style={[s.tabLabel, { color: tab === t ? theme.primary : theme.textSecondary }]}>
                    {t === 'preview' ? `Normalized (${records.length > 200 ? '200+' : records.length})` : `HRMS Match (${matchedCount}✓ ${unmatchedCount}✗)`}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            {/* ── Search ── */}
            <View style={[s.searchRow, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="search" size={14} color={theme.textSecondary} />
              <TextInput
                style={[s.searchInput, { color: theme.text }]}
                placeholder="Search by name, emp code or dept…"
                placeholderTextColor={theme.textSecondary}
                value={search} onChangeText={setSearch}
              />
              {search ? <Pressable onPress={() => setSearch('')}><Feather name="x" size={14} color={theme.textSecondary} /></Pressable> : null}
            </View>

            {/* ── Preview Tab ── */}
            {tab === 'preview' && (
              <View style={[s.table, { backgroundColor: theme.backgroundDefault }]}>
                {/* Table header */}
                <View style={[s.tRow, s.tHead, { backgroundColor: '#1F3864' }]}>
                  {['Code','Name','Dept','Date','In','Out','Status','Hrs'].map((h, i) => (
                    <ThemedText key={h} style={[s.tCell, s.tHeadText, COL_FLEX[i]]}>{h}</ThemedText>
                  ))}
                </View>
                {visibleRecords.map((r, i) => (
                  <View key={`${r.employeeCode}_${r.attendanceDate}`}
                    style={[s.tRow, { backgroundColor: STATUS_COLOR[r.status] ?? '#fff' }]}>
                    <ThemedText style={[s.tCell, COL_FLEX[0], { color: STATUS_TEXT[r.status] }]} numberOfLines={1}>{r.employeeCode}</ThemedText>
                    <ThemedText style={[s.tCell, COL_FLEX[1], { color: STATUS_TEXT[r.status] }]} numberOfLines={1}>{r.employeeName}</ThemedText>
                    <ThemedText style={[s.tCell, COL_FLEX[2], { color: STATUS_TEXT[r.status] }]} numberOfLines={1}>{r.department}</ThemedText>
                    <ThemedText style={[s.tCell, COL_FLEX[3], { color: STATUS_TEXT[r.status] }]} numberOfLines={1}>{r.attendanceDateLabel}</ThemedText>
                    <ThemedText style={[s.tCell, COL_FLEX[4], { color: STATUS_TEXT[r.status] }]} numberOfLines={1}>{r.actualInTime || '—'}</ThemedText>
                    <ThemedText style={[s.tCell, COL_FLEX[5], { color: STATUS_TEXT[r.status] }]} numberOfLines={1}>{r.actualOutTime || '—'}</ThemedText>
                    <ThemedText style={[s.tCell, COL_FLEX[6], { color: STATUS_TEXT[r.status], fontWeight: '700' }]} numberOfLines={1}>{r.status}</ThemedText>
                    <ThemedText style={[s.tCell, COL_FLEX[7], { color: STATUS_TEXT[r.status] }]} numberOfLines={1}>{r.workingHours}</ThemedText>
                  </View>
                ))}
                {records.length > 200 && (
                  <View style={s.truncNote}>
                    <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>
                      Showing first 200 of {records.length} rows. Download Excel for full data.
                    </ThemedText>
                  </View>
                )}
              </View>
            )}

            {/* ── Match Tab ── */}
            {tab === 'match' && (
              <>
                <View style={s.filterRow}>
                  {(['all','matched','unmatched'] as const).map(f => (
                    <Pressable key={f}
                      style={[s.filterChip, filter === f && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                      onPress={() => setFilter(f)}>
                      <ThemedText style={[s.filterText, filter === f && { color: '#fff' }]}>
                        {f === 'all' ? `All (${matched.length})` : f === 'matched' ? `✓ Matched (${matchedCount})` : `✗ Not found (${unmatchedCount})`}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
                {visibleMatched.map(m => (
                  <View key={m.systemEmployee.id || m.smartOfficeName || Math.random().toString()}
                    style={[s.matchRow, { backgroundColor: theme.backgroundDefault,
                      borderLeftColor: m.matched ? Colors.light.success : Colors.light.error }]}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={s.matchName}>{m.systemEmployee.name || m.smartOfficeName || '—'}</ThemedText>
                      {m.smartOfficeName && m.smartOfficeName !== m.systemEmployee.name && (
                        <ThemedText style={[s.matchSub, { color: theme.textSecondary }]}>
                          File: {m.smartOfficeName}
                        </ThemedText>
                      )}
                      {m.systemEmployee.email ? (
                        <ThemedText style={[s.matchSub, { color: theme.textSecondary }]}>{m.systemEmployee.email}</ThemedText>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Feather name={m.matched ? 'check-circle' : 'x-circle'}
                        size={18} color={m.matched ? Colors.light.success : Colors.light.error} />
                      {m.matched && (
                        <ThemedText style={[s.matchDays, { color: Colors.light.success }]}>{m.recordCount} days</ThemedText>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const COL_FLEX = [
  { flex: 0.7 }, // Code
  { flex: 1.4 }, // Name
  { flex: 1.1 }, // Dept
  { flex: 1.1 }, // Date
  { flex: 0.9 }, // In
  { flex: 0.9 }, // Out
  { flex: 1.0 }, // Status
  { flex: 0.8 }, // Hrs
];

const s = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 80 },

  uploadBox: {
    borderWidth: 2, borderStyle: 'dashed', borderRadius: 14,
    padding: 28, alignItems: 'center', marginBottom: 16,
  },
  uploadTitle: { fontSize: 15, fontWeight: '600', marginTop: 10 },
  uploadHint:  { fontSize: 12, marginTop: 4, textAlign: 'center' },

  center: { alignItems: 'center', padding: 32 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 10, borderWidth: 1,
    marginBottom: 12, backgroundColor: '#FEF2F2',
  },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  statBox: {
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, alignItems: 'center', minWidth: 72, flex: 1,
  },
  statNum:   { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 10, marginTop: 2, textAlign: 'center' },

  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  importResult: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12,
  },

  tabBar: {
    flexDirection: 'row', borderRadius: 10, marginBottom: 12,
    overflow: 'hidden',
  },
  tabBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabLabel: { fontSize: 13, fontWeight: '600' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: 10, marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 13 },

  // Table
  table: { borderRadius: 10, overflow: 'hidden', marginBottom: 20 },
  tRow:  { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6 },
  tHead: { paddingVertical: 10 },
  tHeadText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  tCell: { fontSize: 11, paddingHorizontal: 3 },
  truncNote: { padding: 12, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' },

  // Match tab
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB',
  },
  filterText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  matchRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, borderRadius: 10, borderLeftWidth: 4, marginBottom: 6,
  },
  matchName: { fontSize: 14, fontWeight: '600' },
  matchSub:  { fontSize: 11, marginTop: 2 },
  matchDays: { fontSize: 12, fontWeight: '700' },
});
