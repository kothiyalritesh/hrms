import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Switch, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { invalidatePermissionsCache } from "@/hooks/usePermissions";
import { GrantInput, PermissionsApi, RoleTemplate, minimalSelection } from "@/services/permissions.service";
import { Badge, CapabilityToggles, Hint, PrimaryButton, ScopePicker, capabilityLabel, st, useBase } from "./shared";

/**
 * Role templates: everyone with the role gets the template's access.
 *  - Managers: applies automatically to anyone with at least one report,
 *    always for their whole reporting tree (empty template = no manager access).
 *  - HR / HRD: "full data access" switch (on = everything, as before). Off =
 *    exactly the template, which starts as every data permission company-wide.
 *  - SYSTEM_ADMIN / ADMIN: always full access, not editable.
 */
export function TemplatesPanel() {
  const base = useBase();
  const { theme } = useTheme();
  const [state, setState] = useState<{ can_edit: boolean; templates: RoleTemplate[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("@MANAGER");

  const load = useCallback(async () => {
    try {
      setState(await PermissionsApi.roleTemplates());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Could not load templates.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Hint icon="alert-circle" tone="error" text={error} />;
  if (!state) return <ActivityIndicator color={theme.primary} style={{ marginTop: 24 }} />;

  const current = state.templates.find((t) => t.role === role) ?? state.templates[0];

  return (
    <View>
      <View style={st.chips}>
        {state.templates.map((t) => {
          const active = t.role === current?.role;
          return (
            <Pressable
              key={t.role}
              onPress={() => setRole(t.role)}
              style={[st.chip, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primary : "transparent" }]}
            >
              <ThemedText style={{ fontSize: 12, fontWeight: "700", color: active ? "#fff" : theme.text }}>
                {t.role === "@MANAGER" ? "Managers" : t.role} · {t.members}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {current ? <TemplateEditor key={current.role} template={current} canEdit={state.can_edit} onSaved={load} /> : null}
    </View>
  );
}

function TemplateEditor({ template, canEdit, onSaved }: { template: RoleTemplate; canEdit: boolean; onSaved: () => Promise<void> }) {
  const base = useBase();
  const { theme } = useTheme();
  const isManager = template.role === "@MANAGER";
  const existing = useMemo(() => new Set(template.grants.map((g) => g.capability)), [template]);
  const [selected, setSelected] = useState<Set<string>>(new Set(existing));
  const [scope, setScope] = useState("REPORTS_TO");
  const [scopeId, setScopeId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const added = [...selected].filter((k) => !existing.has(k));
  const removed = [...existing].filter((k) => !selected.has(k));
  const dirty = added.length > 0 || removed.length > 0;

  const save = async () => {
    if (reason.trim().length < 5) return setMessage({ text: "Enter a reason (5+ characters).", error: true });
    // keep the scope of entries that stay; new ones get the chosen scope
    const keep: GrantInput[] = template.grants
      .filter((g) => selected.has(g.capability))
      .map((g) => ({ capability: g.capability, scope: g.scope, scope_id: g.scope_id }));
    const fresh: GrantInput[] = minimalSelection(added, base.byKey).map((k) =>
      isManager
        ? { capability: k, scope: "REPORTS_TO" }
        : base.byKey.get(k)?.scoped
          ? { capability: k, scope, scope_id: scopeId || null }
          : { capability: k, scope: "GLOBAL" },
    );
    setBusy(true);
    setMessage(null);
    try {
      const res = await PermissionsApi.setRoleTemplate(template.role, [...keep, ...fresh], reason.trim());
      if (res.success === false) {
        setMessage({ text: res.message ?? "Not saved.", error: true });
      } else {
        setMessage({ text: `Saved: ${res.added ?? 0} added, ${res.removed ?? 0} removed. ${res.affected_people ?? template.members} people update within seconds.` });
        invalidatePermissionsCache();
        setReason("");
        await onSaved();
      }
    } catch (e: any) {
      setMessage({ text: e?.message ?? "Not saved.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const switchFullAccess = (enabled: boolean) => {
    if (reason.trim().length < 5) {
      setMessage({ text: "Enter a reason (5+ characters) before switching full access.", error: true });
      return;
    }
    Alert.alert(
      enabled ? `Give ${template.role} full data access?` : `Limit ${template.role} to its template?`,
      enabled
        ? `All ${template.members} people get every data permission for all employees.`
        : `All ${template.members} people keep only what the template below gives. Admin-only screens and functions that still check role names will stop working for them.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: enabled ? "Give full access" : "Limit access",
          style: enabled ? "default" : "destructive",
          onPress: async () => {
            try {
              const res = await PermissionsApi.setRoleFullAccess(template.role, enabled, reason.trim());
              if (res.success === false) setMessage({ text: res.message ?? "Not saved.", error: true });
              else {
                invalidatePermissionsCache();
                setReason("");
                await onSaved();
              }
            } catch (e: any) {
              setMessage({ text: e?.message ?? "Not saved.", error: true });
            }
          },
        },
      ],
    );
  };

  if (template.locked) {
    return (
      <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText style={st.cardTitle}>{template.role}</ThemedText>
        <Hint icon="shield" text="System Admin and Admin always have full access and manage permissions. This cannot be changed here." />
      </View>
    );
  }

  return (
    <View>
      <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText style={st.cardTitle}>{template.label}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {template.members} active {template.members === 1 ? "person" : "people"} · {template.grants.length} template entr{template.grants.length === 1 ? "y" : "ies"}
        </ThemedText>
        {isManager ? (
          <Hint
            icon="git-branch"
            text="Applies automatically to everyone who has at least one person reporting to them, for their whole reporting tree (direct and indirect reports). It follows the org chart: a new manager gets it, someone who loses all reports stops having it. Remove everything to turn manager access off."
          />
        ) : null}
        {!isManager ? (
          <View style={[st.toggleRow, { borderTopColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: "800" }}>Full data access</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {template.full_data_access
                  ? "On: every data permission for all employees (the template below is ignored)."
                  : "Off: only what the template below gives."}
              </ThemedText>
            </View>
            <Switch value={template.full_data_access} disabled={!canEdit} onValueChange={switchFullAccess} accessibilityLabel="Full data access" />
          </View>
        ) : null}
        {template.full_data_access ? <Badge text="Template not in use while full access is on" color="#7C3AED" /> : null}
      </View>

      {template.grants.length ? (
        <View style={[st.card, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText style={[st.moduleTitle, { color: theme.textSecondary }]}>CURRENT ENTRIES</ThemedText>
          {template.grants.map((g) => (
            <View key={g.id} style={[st.grantRow, { borderTopColor: theme.border }]}>
              <Feather name={selected.has(g.capability) ? "check" : "minus-circle"} size={15} color={selected.has(g.capability) ? "#047857" : "#DC2626"} />
              <ThemedText style={{ flex: 1 }}>
                {capabilityLabel(base, g.capability)} <ThemedText type="caption" style={{ color: theme.textSecondary }}>· {g.scope_label}</ThemedText>
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      <CapabilityToggles
        selected={selected}
        disabled={!canEdit}
        exclude={(cap) => cap.key.startsWith("permissions.") || (isManager && !cap.scoped)}
        onToggle={(key, on) => {
          setMessage(null);
          setSelected((prev) => {
            const next = new Set(prev);
            if (on) next.add(key);
            else next.delete(key);
            return next;
          });
        }}
      />

      {!isManager && added.some((k) => base.byKey.get(k)?.scoped) ? (
        <>
          <ThemedText style={st.label}>New entries cover</ThemedText>
          <ScopePicker
            scope={scope}
            scopeId={scopeId}
            holderIds={[]}
            treeLabel="Each person's own reporting tree"
            onChange={(s, id) => { setScope(s); setScopeId(id); }}
          />
        </>
      ) : null}

      {canEdit ? (
        <>
          <ThemedText style={st.label}>Reason (required)</ThemedText>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Team leads may approve leave"
            placeholderTextColor={theme.textSecondary}
            style={[st.input, { color: theme.text, borderColor: theme.border }]}
          />
          {dirty ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {added.length} to add, {removed.length} to remove · affects {template.members} people
            </ThemedText>
          ) : null}
          {message ? <Hint icon={message.error ? "alert-circle" : "check-circle"} tone={message.error ? "error" : undefined} text={message.text} /> : null}
          <PrimaryButton label="Save template" onPress={() => void save()} busy={busy} disabled={!dirty} />
        </>
      ) : (
        <Hint icon="lock" text="Only System Admin / Admin can change templates." />
      )}
    </View>
  );
}
