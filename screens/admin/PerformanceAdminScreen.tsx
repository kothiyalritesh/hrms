import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PerformanceService, Goal, PerformanceReview } from "@/services/performance.service";

type Tab = "goals" | "reviews" | "feedback";

const REVIEW_CRITERIA = ["Communication", "Teamwork", "Productivity", "Leadership", "Punctuality"];

export default function PerformanceAdminScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("goals");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Goal modal
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [editGoal, setEditGoal] = useState<Partial<Goal> | null>(null);
  const [goalForm, setGoalForm] = useState({
    user_id: "", title: "", description: "", category: "individual" as Goal["category"],
    period: "quarterly" as Goal["period"], start_date: "", end_date: "",
    target_value: "", unit: "%", weight: "100",
  });

  // Review modal
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewForm, setReviewForm] = useState({
    reviewee_id: "", period: "", strengths: "", improvements: "", comments: "",
    ratings: {} as Record<string, number>,
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [g, r, empRes] = await Promise.all([
      PerformanceService.getGoals(),
      PerformanceService.getReviews(),
      supabase.from("profiles").select("id, name").eq("is_active", true).order("name"),
    ]);
    setGoals(g);
    setReviews(r);
    setEmployees(empRes.data || []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openGoalModal = (goal?: Goal) => {
    if (goal) {
      setEditGoal(goal);
      setGoalForm({
        user_id: goal.user_id, title: goal.title, description: goal.description || "",
        category: goal.category, period: goal.period,
        start_date: goal.start_date, end_date: goal.end_date,
        target_value: String(goal.target_value || ""), unit: goal.unit, weight: String(goal.weight),
      });
    } else {
      setEditGoal(null);
      setGoalForm({ user_id: "", title: "", description: "", category: "individual", period: "quarterly", start_date: "", end_date: "", target_value: "", unit: "%", weight: "100" });
    }
    setShowGoalModal(true);
  };

  const handleSaveGoal = async () => {
    if (!goalForm.user_id || !goalForm.title || !goalForm.start_date || !goalForm.end_date) {
      Alert.alert("Error", "Employee, title, and dates are required.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await PerformanceService.saveGoal({
        ...(editGoal?.id ? { id: editGoal.id } : {}),
        user_id: goalForm.user_id,
        title: goalForm.title,
        description: goalForm.description,
        category: goalForm.category,
        period: goalForm.period,
        start_date: goalForm.start_date,
        end_date: goalForm.end_date,
        target_value: parseFloat(goalForm.target_value) || undefined,
        unit: goalForm.unit,
        weight: parseInt(goalForm.weight) || 100,
        created_by: user!.id,
      });
      if (error) throw error;
      setShowGoalModal(false);
      await load();
      Alert.alert("✅ Goal saved.");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateProgress = (goal: Goal) => {
    Alert.prompt(
      "Update Progress",
      `Current: ${goal.current_value} ${goal.unit}\nTarget: ${goal.target_value} ${goal.unit}`,
      async (value) => {
        if (!value) return;
        const num = parseFloat(value);
        if (isNaN(num)) { Alert.alert("Error", "Enter a valid number."); return; }
        await PerformanceService.updateGoalProgress(goal.id, num);
        await load();
      },
      "plain-text",
      String(goal.current_value),
    );
  };

  const handleSaveReview = async () => {
    if (!reviewForm.reviewee_id || !reviewForm.period) {
      Alert.alert("Error", "Select employee and enter review period.");
      return;
    }
    setSaving(true);
    try {
      const scores = Object.values(reviewForm.ratings);
      const overall = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
      const { error } = await PerformanceService.saveReview({
        reviewee_id: reviewForm.reviewee_id,
        reviewer_id: user!.id,
        review_type: "manager",
        period: reviewForm.period,
        overall_score: overall ? parseFloat(overall.toFixed(1)) : undefined,
        ratings: reviewForm.ratings,
        strengths: reviewForm.strengths,
        improvements: reviewForm.improvements,
        comments: reviewForm.comments,
      });
      if (error) throw error;
      setShowReviewModal(false);
      setReviewForm({ reviewee_id: "", period: "", strengths: "", improvements: "", comments: "", ratings: {} });
      await load();
      Alert.alert("✅ Review submitted.");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const progressPct = (g: Goal) =>
    g.target_value ? Math.min(100, Math.round((g.current_value / g.target_value) * 100)) : 0;

  const scoreColor = (s?: number) => {
    if (!s) return theme.textSecondary;
    if (s >= 4) return Colors.light.success;
    if (s >= 3) return Colors.light.warning;
    return Colors.light.error;
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      {/* Tabs */}
      <View style={[s.tabRow, { borderBottomColor: theme.border }]}>
        {(["goals", "reviews", "feedback"] as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={[s.tab, tab === t && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]} onPress={() => setTab(t)}>
            <ThemedText style={[s.tabTxt, { color: tab === t ? theme.primary : theme.textSecondary }]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator color={theme.primary} style={{ marginTop: 40 }} /> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>

          {/* ── GOALS TAB ── */}
          {tab === "goals" && (
            <>
              <TouchableOpacity style={[s.addBtn, { backgroundColor: theme.primary }]} onPress={() => openGoalModal()}>
                <Feather name="plus" size={16} color="#fff" />
                <ThemedText style={s.addBtnTxt}>Add Goal / KPI</ThemedText>
              </TouchableOpacity>
              <Spacer height={16} />
              {goals.length === 0 ? (
                <View style={s.empty}><Feather name="target" size={40} color={theme.textSecondary} /><Spacer height={12} /><ThemedText style={{ color: theme.textSecondary }}>No goals set yet</ThemedText></View>
              ) : goals.map((g) => {
                const pct = progressPct(g);
                return (
                  <View key={g.id} style={[s.card, { backgroundColor: theme.backgroundDefault }]}>
                    <View style={s.cardRow}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={s.cardTitle}>{g.title}</ThemedText>
                        <ThemedText style={[s.cardMeta, { color: theme.textSecondary }]}>
                          {(g.employee as any)?.name} · {g.period} · {g.category}
                        </ThemedText>
                      </View>
                      <View style={[s.badge, { backgroundColor: g.status === "completed" ? Colors.light.successBg : "#F3F4F6" }]}>
                        <ThemedText style={[s.badgeTxt, { color: g.status === "completed" ? Colors.light.successText : theme.textSecondary }]}>
                          {g.status.toUpperCase()}
                        </ThemedText>
                      </View>
                    </View>
                    {/* Progress bar */}
                    <View style={s.progressRow}>
                      <View style={[s.progressBg, { backgroundColor: theme.backgroundSecondary }]}>
                        <View style={[s.progressFill, { width: `${pct}%` as any, backgroundColor: pct >= 100 ? Colors.light.success : theme.primary }]} />
                      </View>
                      <ThemedText style={[s.progressTxt, { color: theme.textSecondary }]}>
                        {g.current_value}/{g.target_value} {g.unit} ({pct}%)
                      </ThemedText>
                    </View>
                    <View style={s.cardActions}>
                      <TouchableOpacity style={s.actionBtn} onPress={() => handleUpdateProgress(g)}>
                        <Feather name="edit-2" size={13} color={theme.primary} />
                        <ThemedText style={[s.actionTxt, { color: theme.primary }]}>Update</ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.actionBtn} onPress={() => openGoalModal(g)}>
                        <Feather name="settings" size={13} color={theme.textSecondary} />
                        <ThemedText style={[s.actionTxt, { color: theme.textSecondary }]}>Edit</ThemedText>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </>
          )}

          {/* ── REVIEWS TAB ── */}
          {tab === "reviews" && (
            <>
              <TouchableOpacity style={[s.addBtn, { backgroundColor: theme.primary }]} onPress={() => setShowReviewModal(true)}>
                <Feather name="plus" size={16} color="#fff" />
                <ThemedText style={s.addBtnTxt}>New Performance Review</ThemedText>
              </TouchableOpacity>
              <Spacer height={16} />
              {reviews.length === 0 ? (
                <View style={s.empty}><Feather name="star" size={40} color={theme.textSecondary} /><Spacer height={12} /><ThemedText style={{ color: theme.textSecondary }}>No reviews yet</ThemedText></View>
              ) : reviews.map((r) => (
                <View key={r.id} style={[s.card, { backgroundColor: theme.backgroundDefault }]}>
                  <View style={s.cardRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={s.cardTitle}>{(r.reviewee as any)?.name}</ThemedText>
                      <ThemedText style={[s.cardMeta, { color: theme.textSecondary }]}>
                        Period: {r.period} · By: {(r.reviewer as any)?.name}
                      </ThemedText>
                    </View>
                    {r.overall_score != null && (
                      <View style={[s.scoreBadge, { backgroundColor: scoreColor(r.overall_score) + "20" }]}>
                        <ThemedText style={[s.scoreText, { color: scoreColor(r.overall_score) }]}>
                          ★ {r.overall_score}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                  {r.strengths ? <ThemedText style={[s.cardMeta, { color: theme.textSecondary, marginTop: 6 }]}>💪 {r.strengths}</ThemedText> : null}
                  {r.improvements ? <ThemedText style={[s.cardMeta, { color: theme.textSecondary }]}>📈 {r.improvements}</ThemedText> : null}
                </View>
              ))}
            </>
          )}

          {/* ── FEEDBACK TAB ── */}
          {tab === "feedback" && (
            <View style={s.empty}>
              <Feather name="message-circle" size={40} color={theme.textSecondary} />
              <Spacer height={12} />
              <ThemedText style={{ color: theme.textSecondary, textAlign: "center" }}>
                Peer feedback is submitted by employees from their profile.{"\n"}Admin can view aggregated feedback here.
              </ThemedText>
            </View>
          )}
        </ScrollView>
      )}

      {/* Goal Modal */}
      <Modal visible={showGoalModal} transparent animationType="slide" onRequestClose={() => setShowGoalModal(false)}>
        <View style={s.overlay}>
          <ThemedView style={s.modal}>
            <View style={s.modalHeader}>
              <ThemedText style={s.modalTitle}>{editGoal?.id ? "Edit Goal" : "Add Goal / KPI"}</ThemedText>
              <TouchableOpacity onPress={() => setShowGoalModal(false)}><Feather name="x" size={22} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <ThemedText style={s.label}>Employee</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {employees.map((e) => (
                    <TouchableOpacity key={e.id} style={[s.chip, goalForm.user_id === e.id && { backgroundColor: theme.primary }]} onPress={() => setGoalForm({ ...goalForm, user_id: e.id })}>
                      <ThemedText style={{ color: goalForm.user_id === e.id ? "#fff" : theme.text, fontSize: 12 }}>{e.name}</ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <ThemedText style={s.label}>Goal Title</ThemedText>
              <TextInput style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={goalForm.title} onChangeText={(t) => setGoalForm({ ...goalForm, title: t })} placeholder="e.g. Achieve 20 site visits" placeholderTextColor={theme.textSecondary} />

              <ThemedText style={s.label}>Period</ThemedText>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {(["monthly", "quarterly", "yearly"] as Goal["period"][]).map((p) => (
                  <TouchableOpacity key={p} style={[s.chip, goalForm.period === p && { backgroundColor: theme.primary }]} onPress={() => setGoalForm({ ...goalForm, period: p })}>
                    <ThemedText style={{ color: goalForm.period === p ? "#fff" : theme.text, fontSize: 12 }}>{p}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={s.label}>Target Value</ThemedText>
                  <TextInput style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={goalForm.target_value} onChangeText={(t) => setGoalForm({ ...goalForm, target_value: t })} keyboardType="numeric" placeholder="100" placeholderTextColor={theme.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={s.label}>Unit</ThemedText>
                  <TextInput style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={goalForm.unit} onChangeText={(t) => setGoalForm({ ...goalForm, unit: t })} placeholder="% / visits / ₹" placeholderTextColor={theme.textSecondary} />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={s.label}>Start Date</ThemedText>
                  <TextInput style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={goalForm.start_date} onChangeText={(t) => setGoalForm({ ...goalForm, start_date: t })} placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={s.label}>End Date</ThemedText>
                  <TextInput style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={goalForm.end_date} onChangeText={(t) => setGoalForm({ ...goalForm, end_date: t })} placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary} />
                </View>
              </View>

              <Spacer height={16} />
              <TouchableOpacity style={[s.saveBtn, { backgroundColor: theme.primary }]} onPress={handleSaveGoal} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <ThemedText style={s.saveBtnTxt}>Save Goal</ThemedText>}
              </TouchableOpacity>
              <Spacer height={24} />
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>

      {/* Review Modal */}
      <Modal visible={showReviewModal} transparent animationType="slide" onRequestClose={() => setShowReviewModal(false)}>
        <View style={s.overlay}>
          <ThemedView style={s.modal}>
            <View style={s.modalHeader}>
              <ThemedText style={s.modalTitle}>Performance Review</ThemedText>
              <TouchableOpacity onPress={() => setShowReviewModal(false)}><Feather name="x" size={22} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <ThemedText style={s.label}>Employee</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {employees.map((e) => (
                    <TouchableOpacity key={e.id} style={[s.chip, reviewForm.reviewee_id === e.id && { backgroundColor: theme.primary }]} onPress={() => setReviewForm({ ...reviewForm, reviewee_id: e.id })}>
                      <ThemedText style={{ color: reviewForm.reviewee_id === e.id ? "#fff" : theme.text, fontSize: 12 }}>{e.name}</ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <ThemedText style={s.label}>Review Period (e.g. Q1 2025)</ThemedText>
              <TextInput style={[s.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={reviewForm.period} onChangeText={(t) => setReviewForm({ ...reviewForm, period: t })} placeholder="Q1 2025" placeholderTextColor={theme.textSecondary} />

              <ThemedText style={s.label}>Ratings (1–5)</ThemedText>
              {REVIEW_CRITERIA.map((criterion) => (
                <View key={criterion} style={s.ratingRow}>
                  <ThemedText style={{ flex: 1, fontSize: 13, color: theme.text }}>{criterion}</ThemedText>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <TouchableOpacity
                        key={n}
                        style={[s.ratingBtn, { backgroundColor: reviewForm.ratings[criterion] === n ? theme.primary : theme.backgroundSecondary }]}
                        onPress={() => setReviewForm({ ...reviewForm, ratings: { ...reviewForm.ratings, [criterion]: n } })}
                      >
                        <ThemedText style={{ color: reviewForm.ratings[criterion] === n ? "#fff" : theme.text, fontSize: 12, fontWeight: "700" }}>{n}</ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              <Spacer height={8} />
              <ThemedText style={s.label}>Strengths</ThemedText>
              <TextInput style={[s.input, s.textArea, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={reviewForm.strengths} onChangeText={(t) => setReviewForm({ ...reviewForm, strengths: t })} placeholder="Key strengths..." placeholderTextColor={theme.textSecondary} multiline numberOfLines={3} />

              <ThemedText style={s.label}>Areas for Improvement</ThemedText>
              <TextInput style={[s.input, s.textArea, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={reviewForm.improvements} onChangeText={(t) => setReviewForm({ ...reviewForm, improvements: t })} placeholder="Areas to improve..." placeholderTextColor={theme.textSecondary} multiline numberOfLines={3} />

              <ThemedText style={s.label}>Overall Comments</ThemedText>
              <TextInput style={[s.input, s.textArea, { backgroundColor: theme.backgroundSecondary, color: theme.text }]} value={reviewForm.comments} onChangeText={(t) => setReviewForm({ ...reviewForm, comments: t })} placeholder="Summary comments..." placeholderTextColor={theme.textSecondary} multiline numberOfLines={3} />

              <Spacer height={16} />
              <TouchableOpacity style={[s.saveBtn, { backgroundColor: theme.primary }]} onPress={handleSaveReview} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <ThemedText style={s.saveBtnTxt}>Submit Review</ThemedText>}
              </TouchableOpacity>
              <Spacer height={24} />
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabTxt: { fontSize: 13, fontWeight: "600" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 10 },
  addBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  card: { borderRadius: 12, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#111", marginBottom: 2 },
  cardMeta: { fontSize: 12 },
  cardActions: { flexDirection: "row", gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionTxt: { fontSize: 13, fontWeight: "600" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeTxt: { fontSize: 11, fontWeight: "700" },
  scoreBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  scoreText: { fontSize: 14, fontWeight: "800" },
  progressRow: { marginTop: 8, gap: 4 },
  progressBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  progressTxt: { fontSize: 11 },
  empty: { alignItems: "center", paddingTop: 60 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 8, color: "#374151" },
  input: { borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12 },
  textArea: { height: 80, textAlignVertical: "top", paddingTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  ratingRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  ratingBtn: { width: 30, height: 30, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  saveBtn: { height: 50, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  saveBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
