import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Dimensions,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { MapPin, Plus, RefreshCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { CreateSquadSheet } from "@/components/CreateSquadSheet";
import { SquadCard } from "@/components/SquadCard";
import { SquadPermissionCard } from "@/components/SquadPermissionCard";
import { SquadMarker } from "@/components/SquadMarker";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { SIDELINE_MAP_STYLE } from "@/constants/mapStyle";
import {
  getCurrentLocation,
  requestLocationPermission,
  updateUserLocation,
  type Coordinates,
  type Squad,
} from "@/services/squadService";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const MAP_HEIGHT = Math.min(360, Math.max(250, SCREEN_HEIGHT * 0.42));

type LocationPhase = "checking" | "granted" | "denied" | "unavailable" | "error";

export default function SquadScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { nearbySquads, mySquadIds, loading, error, fetchSquads, joinSquad, refreshLastActive } = useSquad();

  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [locationPhase, setLocationPhase] = useState<LocationPhase>("checking");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const mapRef = useRef<MapView | null>(null);
  const listRef = useRef<FlatList<Squad> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const loadSquads = useCallback(async () => {
    setLocationPhase("checking");
    setLocationError(null);

    const permission = await requestLocationPermission();
    if (permission !== "granted") {
      setLocationPhase("denied");
      setCoords(null);
      return;
    }

    const location = await getCurrentLocation();
    if (!location.coords) {
      setLocationPhase(location.error === "services_disabled" ? "unavailable" : "error");
      setLocationError(location.error);
      setCoords(null);
      return;
    }

    setLocationPhase("granted");
    setCoords(location.coords);
    if (user?.uid) {
      await updateUserLocation(user.uid, location.coords);
    }
    await fetchSquads(location.coords.latitude, location.coords.longitude);
  }, [fetchSquads, user?.uid]);

  useEffect(() => {
    void loadSquads();
  }, [loadSquads]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        void refreshLastActive();
      }
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [refreshLastActive]);

  const handleJoin = useCallback(async (squadId: string) => {
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
  }, [joinSquad, user?.uid]);

  const handleMarkerPress = useCallback((squad: Squad) => {
    setSelectedSquadId(squad.squadId);
    const index = nearbySquads.findIndex((item) => item.squadId === squad.squadId);
    if (index >= 0) {
      listRef.current?.scrollToIndex({ animated: true, index, viewPosition: 0.1 });
    }
  }, [nearbySquads]);

  const handleSquadCreated = useCallback((squadId: string) => {
    setShowCreate(false);
    router.push({ pathname: "/(social)/squad-detail", params: { squadId } });
  }, []);

  const recenterMap = useCallback(() => {
    if (!coords) return;
    mapRef.current?.animateToRegion(toRegion(coords), 400);
  }, [coords]);

  if (locationPhase === "denied") {
    return <SquadPermissionCard onRetry={loadSquads} />;
  }

  const isLooking = locationPhase === "checking" || loading;
  const showLocationIssue = locationPhase === "unavailable" || locationPhase === "error" || Boolean(error);
  const mapRegion = coords ? toRegion(coords) : undefined;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.mapContainer}>
        {mapRegion ? (
          <MapView
            ref={mapRef}
            customMapStyle={SIDELINE_MAP_STYLE}
            initialRegion={mapRegion}
            moveOnMarkerPress={false}
            provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
            region={mapRegion}
            showsCompass={false}
            showsMyLocationButton={false}
            showsUserLocation={false}
            style={styles.map}
            toolbarEnabled={false}
          >
            <Circle
              center={coords!}
              fillColor={Colors.textHeading}
              radius={14}
              strokeColor={Colors.surface}
              strokeWidth={3}
              zIndex={10}
            />
            {nearbySquads.map((squad) => (
              <Marker
                anchor={{ x: 0.5, y: 1 }}
                coordinate={squad.venueLocation}
                key={squad.squadId}
                onPress={() => handleMarkerPress(squad)}
                tracksViewChanges={false}
              >
                <SquadMarker squad={squad} isSelected={selectedSquadId === squad.squadId} />
              </Marker>
            ))}
          </MapView>
        ) : (
          <View style={styles.mapFallback}>
            {isLooking ? <ActivityIndicator color={Colors.primary} /> : <MapPin size={34} color={Colors.primary} />}
            <Text style={styles.mapFallbackTitle}>
              {isLooking ? t("location.loading") : t("squad.findNearby")}
            </Text>
            <Text style={styles.mapFallbackText}>
              {showLocationIssue ? t("location.errorBody") : t("squad.mapSubtitle")}
            </Text>
          </View>
        )}

        <View style={styles.mapHeaderCard}>
          <View style={styles.mapHeaderCopy}>
            <Text style={styles.kicker}>{t("app.name")}</Text>
            <Text style={styles.title}>{t("squad.nearbyTitle")}</Text>
            <Text style={styles.subtitle}>{t("squad.mapSubtitle")}</Text>
          </View>
          <TouchableOpacity activeOpacity={0.86} onPress={coords ? recenterMap : loadSquads} style={styles.iconButton}>
            {isLooking ? <ActivityIndicator color={Colors.primary} size="small" /> : <RefreshCw size={20} color={Colors.textHeading} />}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.listContainer}>
        <View style={styles.listHeader}>
          <View>
            <Text style={styles.listTitle}>
              {isLooking ? t("squad.loadingSquads") : t("squad.nearbyCount", { count: nearbySquads.length })}
            </Text>
            <Text style={styles.listSubtitle}>
              {coords ? t("squad.tapMarker") : t("squad.locationChecking")}
            </Text>
          </View>
          <TouchableOpacity activeOpacity={0.86} onPress={loadSquads} style={styles.refreshButton}>
            <RefreshCw size={17} color={Colors.primary} />
            <Text style={styles.refreshText}>{t("location.retry")}</Text>
          </TouchableOpacity>
        </View>

        {showLocationIssue ? (
          <View style={styles.inlineState}>
            <Text style={styles.inlineTitle}>
              {locationPhase === "unavailable" ? t("location.unavailableTitle") : t("location.errorTitle")}
            </Text>
            <Text style={styles.inlineText}>{error || locationError || t("location.errorBody")}</Text>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          contentContainerStyle={styles.list}
          data={nearbySquads}
          keyExtractor={(item) => item.squadId}
          ListEmptyComponent={!isLooking ? <EmptyNearbyState onCreate={() => setShowCreate(true)} /> : null}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item }) => (
            <SquadCard
              squad={item}
              isHighlighted={selectedSquadId === item.squadId}
              isMember={mySquadIds.includes(item.squadId)}
              joining={joiningId === item.squadId}
              onJoin={() => handleJoin(item.squadId)}
              onPress={() => router.push({ pathname: "/(social)/squad-detail", params: { squadId: item.squadId } })}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <TouchableOpacity activeOpacity={0.86} onPress={() => setShowCreate(true)} style={[styles.fab, { bottom: insets.bottom + Spacing.lg }]}>
        <Plus size={26} color={Colors.surface} />
      </TouchableOpacity>

      <CreateSquadSheet
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSquadCreated={handleSquadCreated}
        userCoords={coords}
      />
    </View>
  );
}

function EmptyNearbyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();

  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MapPin size={28} color={Colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{t("squad.noNearbyTitle")}</Text>
      <Text style={styles.emptyText}>{t("squad.noNearbyBody")}</Text>
      <TouchableOpacity activeOpacity={0.86} onPress={onCreate} style={styles.createButton}>
        <Plus size={16} color={Colors.surface} />
        <Text style={styles.createButtonText}>{t("squad.createNearby")}</Text>
      </TouchableOpacity>
    </View>
  );
}

function toRegion(coords: Coordinates): Region {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  mapContainer: {
    height: MAP_HEIGHT,
    overflow: "hidden",
    width: "100%",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapFallback: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    gap: Spacing.sm,
    height: "100%",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  mapFallbackTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
    textAlign: "center",
  },
  mapFallbackText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  mapHeaderCard: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    flexDirection: "row",
    gap: Spacing.md,
    left: Spacing.md,
    padding: Spacing.md,
    position: "absolute",
    right: Spacing.md,
    top: Spacing.md,
    ...Shadow.card,
  },
  mapHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 10,
    textTransform: "uppercase",
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 23,
  },
  subtitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  listContainer: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  listHeader: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderBottomColor: Colors.secondary,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  listTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
  },
  listSubtitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    marginTop: 2,
  },
  refreshButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.xs,
    minHeight: 38,
    paddingHorizontal: Spacing.sm,
  },
  refreshText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
  },
  inlineState: {
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    gap: Spacing.xs,
    margin: Spacing.md,
    padding: Spacing.md,
  },
  inlineTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  inlineText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xxl + 72,
    paddingTop: Spacing.sm,
  },
  empty: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    width: 56,
    ...Shadow.card,
  },
  emptyTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    textAlign: "center",
  },
  emptyText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  createButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
    minHeight: 42,
    paddingHorizontal: Spacing.md,
  },
  createButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  fab: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 28,
    elevation: 8,
    height: 56,
    justifyContent: "center",
    position: "absolute",
    right: Spacing.lg,
    shadowColor: Colors.primary,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    width: 56,
    zIndex: 20,
  },
});
