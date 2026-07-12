import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Check, Plus, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  createChildProfile,
  deleteChildProfile,
  getCurrentUserChildren,
  type ParentChildProfile,
} from "@/services/childService";

export function ChildProfilePicker({
  onChange,
  onProfilesChange,
  selectedIds,
}: {
  onChange: (childIds: string[]) => void;
  onProfilesChange?: (children: ParentChildProfile[]) => void;
  selectedIds: string[];
}) {
  const { t } = useTranslation();
  const [children, setChildren] = useState<ParentChildProfile[]>([]);
  const [draftName, setDraftName] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextChildren = await getCurrentUserChildren();
      setChildren(nextChildren);
      onProfilesChange?.(nextChildren);
    } catch (nextError) {
      console.warn("[ChildProfiles] load error:", getErrorCode(nextError));
      setError(t("myTeams.childrenLoadError"));
    } finally {
      setLoading(false);
    }
  }, [onProfilesChange, t]);

  useEffect(() => {
    void loadChildren();
  }, [loadChildren]);

  const toggleChild = useCallback((childId: string) => {
    onChange(
      selectedIds.includes(childId)
        ? selectedIds.filter((selectedId) => selectedId !== childId)
        : [...selectedIds, childId],
    );
  }, [onChange, selectedIds]);

  const addChild = useCallback(async () => {
    if (!draftName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const child = await createChildProfile(draftName);
      const nextChildren = [...children, child]
        .sort((first, second) => first.displayName.localeCompare(second.displayName));
      setChildren(nextChildren);
      onProfilesChange?.(nextChildren);
      onChange([...selectedIds, child.id]);
      setDraftName("");
    } catch (nextError) {
      console.warn("[ChildProfiles] create error:", getErrorCode(nextError));
      setError(t("myTeams.childCreateError"));
    } finally {
      setCreating(false);
    }
  }, [children, draftName, onChange, onProfilesChange, selectedIds, t]);

  const confirmDelete = useCallback((child: ParentChildProfile) => {
    Alert.alert(
      t("myTeams.deleteChildTitle"),
      t("myTeams.deleteChildBody", { name: child.displayName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("myTeams.deleteChild"),
          style: "destructive",
          onPress: () => {
            setDeletingId(child.id);
            setError(null);
            deleteChildProfile(child.id)
              .then(() => {
                const nextChildren = children.filter((item) => item.id !== child.id);
                setChildren(nextChildren);
                onProfilesChange?.(nextChildren);
                onChange(selectedIds.filter((selectedId) => selectedId !== child.id));
              })
              .catch((nextError) => {
                const code = getErrorCode(nextError);
                console.warn("[ChildProfiles] delete error:", code);
                setError(code.includes("failed-precondition")
                  ? t("myTeams.childDeleteLinkedError")
                  : t("myTeams.childDeleteError"));
              })
              .finally(() => setDeletingId(null));
          },
        },
      ],
    );
  }, [children, onChange, onProfilesChange, selectedIds, t]);
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text style={styles.title}>{t("myTeams.selectChildren")}</Text>
        <Text style={styles.body}>{t("myTeams.selectChildrenBody")}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.body}>{t("myTeams.loadingChildren")}</Text>
        </View>
      ) : null}

      {!loading && children.length === 0 ? (
        <Text style={styles.emptyText}>{t("myTeams.noChildProfiles")}</Text>
      ) : null}

      {!loading ? children.map((child) => {
        const selected = selectedIds.includes(child.id);
        return (
          <View key={child.id} style={[styles.childRow, selected && styles.childRowSelected]}>
            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              activeOpacity={0.84}
              onPress={() => toggleChild(child.id)}
              style={styles.childSelectArea}
            >
              <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                {selected ? <Check color={Colors.surface} size={15} /> : null}
              </View>
              <Text style={styles.childName}>{child.displayName}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={t("myTeams.deleteChild")}
              accessibilityRole="button"
              disabled={deletingId === child.id}
              onPress={() => confirmDelete(child)}
              style={styles.deleteButton}
            >
              {deletingId === child.id
                ? <ActivityIndicator color={Colors.primary} size="small" />
                : <Trash2 color={Colors.primary} size={18} />}
            </TouchableOpacity>
          </View>
        );
      }) : null}

      <View style={styles.addSection}>
        <Text style={styles.addTitle}>{t("myTeams.addChildProfile")}</Text>
        <TextInput
          autoCapitalize="words"
          maxLength={80}
          onChangeText={setDraftName}
          placeholder={t("myTeams.childNamePlaceholder")}
          placeholderTextColor={Colors.textPrimary}
          style={styles.input}
          value={draftName}
        />
        <TouchableOpacity
          accessibilityRole="button"
          disabled={creating || !draftName.trim()}
          onPress={addChild}
          style={[styles.addButton, (creating || !draftName.trim()) && styles.disabled]}
        >
          {creating
            ? <ActivityIndicator color={Colors.surface} />
            : <><Plus color={Colors.surface} size={17} /><Text style={styles.addButtonText}>{t("myTeams.addChild")}</Text></>}
        </TouchableOpacity>
      </View>

      {selectedIds.length > 0 ? (
        <Text style={styles.selectedText}>{t("myTeams.childrenSelected", { count: selectedIds.length })}</Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  heading: { gap: 3 },
  title: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  emptyText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, fontStyle: "italic" },
  childRow: { alignItems: "center", borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, minHeight: 46, paddingHorizontal: Spacing.sm },
  childRowSelected: { backgroundColor: Colors.background, borderColor: Colors.primary },
  childSelectArea: { alignItems: "center", flex: 1, flexDirection: "row", gap: Spacing.sm, minHeight: 44 },
  deleteButton: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  checkbox: { alignItems: "center", borderColor: Colors.primary, borderRadius: 5, borderWidth: 1, height: 22, justifyContent: "center", width: 22 },
  checkboxSelected: { backgroundColor: Colors.primary },
  childName: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  addSection: { borderTopColor: Colors.secondary, borderTopWidth: 1, gap: Spacing.sm, paddingTop: Spacing.sm },
  addTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 46, paddingHorizontal: Spacing.md },
  addButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, minHeight: 42, paddingHorizontal: Spacing.md },
  addButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  selectedText: { color: Colors.accentGreen, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  disabled: { opacity: 0.55 },
});
