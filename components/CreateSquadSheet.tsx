import React, { useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { X } from "lucide-react-native";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useSquad } from "@/context/SquadContext";

interface CreateSquadSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userCoords: { latitude: number; longitude: number } | null;
  onSquadCreated: (squadId: string) => void;
}

export function CreateSquadSheet({ isOpen, onClose, userCoords, onSquadCreated }: CreateSquadSheetProps) {
  const { createSquad } = useSquad();
  const [name, setName] = useState("");
  const [sport, setSport] = useState("Soccer");
  const [venueName, setVenueName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setError("");
    if (!userCoords) {
      setError("Location is required to create a squad.");
      return;
    }
    if (!name.trim() || !venueName.trim()) {
      setError("Add a squad name and venue.");
      return;
    }

    setLoading(true);
    try {
      const squadId = await createSquad({
        name: name.trim(),
        sport: sport.trim() || "Soccer",
        venueName: venueName.trim(),
        venueLocation: userCoords,
      });
      setName("");
      setVenueName("");
      setSport("Soccer");
      onClose();
      onSquadCreated(squadId);
    } catch (nextError) {
      console.warn("[CreateSquadSheet] create error:", nextError);
      setError("Could not create this squad yet.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Create Squad</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={20} color={Colors.textHeading} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Squad name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Saturday sideline crew" style={styles.input} />

          <Text style={styles.label}>Sport</Text>
          <TextInput value={sport} onChangeText={setSport} placeholder="Soccer" style={styles.input} />

          <Text style={styles.label}>Venue</Text>
          <TextInput value={venueName} onChangeText={setVenueName} placeholder="Field 3" style={styles.input} />

          {!!error && <Text style={styles.error}>{error}</Text>}
          <PrimaryButton title="Create Squad" onPress={handleCreate} loading={loading} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(47, 65, 86, 0.35)",
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 22,
    color: Colors.textHeading,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: Typography.bodySemiBold,
    color: Colors.textHeading,
    fontSize: 13,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.background,
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
  },
  error: {
    color: Colors.primary,
    fontFamily: Typography.bodyRegular,
    textAlign: "center",
  },
});