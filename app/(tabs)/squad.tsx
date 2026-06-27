import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Location from "expo-location";
import { router } from "expo-router";
import { Plus, RefreshCw } from "lucide-react-native";
import { CreateSquadSheet } from "@/components/CreateSquadSheet";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SquadCard } from "@/components/SquadCard";
import { SquadPermissionCard } from "@/components/SquadPermissionCard";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import { Squad } from "@/services/squadService";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function SquadScreen() {
  const { user } = useAuth();
  const { nearbySquads, mySquadIds, loading, fetchSquads, joinSquad } = useSquad();
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const loadSquads = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setPermissionDenied(true);
      return;
    }

    setPermissionDenied(false);
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const nextCoords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
    setCoords(nextCoords);
    await fetchSquads(nextCoords.latitude, nextCoords.longitude);
  }, [fetchSquads]);

  const handleJoin = async (squadId: string) => {
    if (!user?.uid) {
      router.push("/(auth)/sign-in");
      return;
    }
    setJoiningId(squadId);
    try {
      await joinSquad(squadId);
    } finally {
      setJoiningId(null);
    }
  };

  const renderItem = ({ item }: { item: Squad }) => (
    <SquadCard
      squad={item}
      isMember={mySquadIds.includes(item.squadId)}
      onJoin={() => handleJoin(item.squadId)}
      onPress={() => router.push(`/(social)/squad-detail?squadId=${item.squadId}`)}
      joining={joiningId === item.squadId}
    />
  );

  if (permissionDenied) {
    return <SquadPermissionCard onRetry={loadSquads} />;
  }

  return (
    <ScreenWrapper>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Squad</Text>
          <Text style={styles.subtitle}>{nearbySquads.length} squads near you</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} onPress={loadSquads}>
          {loading ? <ActivityIndicator color={Colors.primary} /> : <RefreshCw size={20} color={Colors.textHeading} />}
        </TouchableOpacity>
      </View>

      <FlatList
        data={nearbySquads}
        keyExtractor={(item) => item.squadId}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No squads loaded yet</Text>
            <Text style={styles.emptyText}>Refresh to find parents near your current field.</Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => setShowCreate(true)}>
        <Plus size={26} color="#FFFFFF" />
      </TouchableOpacity>

      <CreateSquadSheet
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        userCoords={coords}
        onSquadCreated={(squadId) => router.push(`/(social)/squad-detail?squadId=${squadId}`)}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: Spacing.lg, paddingBottom: Spacing.sm },
  title: { fontFamily: Typography.heading, fontSize: 30, color: Colors.textHeading },
  subtitle: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary, marginTop: 2 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: Colors.surface },
  list: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 100 },
  empty: { alignItems: "center", padding: Spacing.xl, gap: Spacing.sm },
  emptyTitle: { fontFamily: Typography.bodySemiBold, fontSize: 16, color: Colors.textHeading },
  emptyText: { fontFamily: Typography.bodyRegular, textAlign: "center", color: Colors.textPrimary },
  fab: { position: "absolute", right: Spacing.lg, bottom: Spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
});