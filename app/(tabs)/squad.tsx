import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { router } from "expo-router";
import { MapPin, Plus, Search } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CreateSquadSheet } from "@/components/CreateSquadSheet";
import { SquadCard } from "@/components/SquadCard";
import { SquadMarker } from "@/components/SquadMarker";
import { SquadSelector } from "@/components/SquadSelector";
import { useAuth } from "@/context/AuthContext";
import { useSquad } from "@/context/SquadContext";
import { SIDELINE_MAP_STYLE } from "@/constants/mapStyle";
import { SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  getCurrentLocation,
  getLocationPermissionStatus,
  requestLocationPermission,
  type Coordinates,
  type Squad,
} from "@/services/squadService";

type LocationPhase = "idle" | "loading" | "granted" | "denied" | "permanent" | "unavailable" | "error";

export default function SquadScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    appConfig,
    error,
    fetchSquads,
    joinSquad,
    loading,
    mySquadIds,
    nearbySquads,
    refreshLastActive,
    searchSquads,
  } = useSquad();
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [radiusMiles, setRadiusMiles] = useState(appConfig.squadRadiusMiles);
  const [locationPhase, setLocationPhase] = useState<LocationPhase>("idle");
  const [selectedMapSquadId, setSelectedMapSquadId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [venueQuery, setVenueQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"nearby" | "venue">("nearby");
  const listRef = useRef<FlatList<Squad> | null>(null);

  const retrieveLocation = useCallback(async () => {
    setLocationPhase("loading");
    const location = await getCurrentLocation();
    if (!location.coords) {
      setCoords(null);
      setLocationPhase(location.error === "services_disabled" ? "unavailable" : "error");
      return;
    }
    setCoords(location.coords);
    setSearchMode("nearby");
    setLocationPhase("granted");
    try {
      await fetchSquads(location.coords.latitude, location.coords.longitude, radiusMiles);
    } catch {
      setLocationPhase("error");
    }
  }, [fetchSquads, radiusMiles]);

  useEffect(() => {
    let active = true;
    void getLocationPermissionStatus().then((permission) => {
      if (!active) return;
      if (permission.status === "granted") void retrieveLocation();
      else if (permission.status === "denied") setLocationPhase(permission.canAskAgain ? "denied" : "permanent");
    });
    return () => { active = false; };
  }, [retrieveLocation]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void refreshLastActive();
      if (locationPhase === "permanent") {
        void getLocationPermissionStatus().then((permission) => {
          if (permission.status === "granted") void retrieveLocation();
        });
      }
    });
    return () => subscription.remove();
  }, [locationPhase, refreshLastActive, retrieveLocation]);

  const askForLocation = useCallback(() => {
    Alert.alert(
      t("squad.findNearby"),
      t("squad.locationDisclosure"),
      [
        { text: t("squad.notNow"), style: "cancel" },
        {
          text: t("startMode.continue"),
          onPress: () => {
            void requestLocationPermission().then((permission) => {
              if (permission.status === "granted") void retrieveLocation();
              else setLocationPhase(permission.canAskAgain ? "denied" : "permanent");
            });
          },
        },
      ],
    );
  }, [retrieveLocation, t]);

  const handleUseMyLocation = useCallback(async () => {
    const permission = await getLocationPermissionStatus();
    if (permission.status === "granted") {
      await retrieveLocation();
      return;
    }
    if (permission.status === "denied" && !permission.canAskAgain) {
      setLocationPhase("permanent");
      return;
    }
    askForLocation();
  }, [askForLocation, retrieveLocation]);

  const handleVenueSearch = useCallback(async () => {
    if (venueQuery.trim().length < 2) return;
    setSearchMode("venue");
    try {
      await searchSquads(venueQuery);
    } catch {
      // Localized error state is rendered below.
    }
  }, [searchSquads, venueQuery]);

  const expandSearch = useCallback(async () => {
    if (!coords) return;
    const nextRadius = radiusMiles < 5 ? 5 : 10;
    setRadiusMiles(nextRadius);
    try {
      await fetchSquads(coords.latitude, coords.longitude, nextRadius);
    } catch {
      setLocationPhase("error");
    }
  }, [coords, fetchSquads, radiusMiles]);

  const handleJoin = useCallback(async (squadId: string) => {
    if (!user?.uid) {
      router.push(SIGN_IN_ROUTE as never);
      return;
    }
    setJoiningId(squadId);
    try {
      await joinSquad(squadId);
    } catch {
      Alert.alert(t("squad.joinErrorTitle"), t("squad.errorJoining"));
    } finally {
      setJoiningId(null);
    }
  }, [joinSquad, t, user?.uid]);

  const handleMarkerPress = useCallback((squad: Squad) => {
    setSelectedMapSquadId(squad.squadId);
    const index = nearbySquads.findIndex((item) => item.squadId === squad.squadId);
    if (index >= 0) listRef.current?.scrollToIndex({ animated: true, index, viewPosition: 0.1 });
  }, [nearbySquads]);

  const openCreate = () => {
    if (!coords) {
      Alert.alert(t("squad.locationRequiredTitle"), t("squad.locationRequired"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("squad.useMyLocation"), onPress: () => void handleUseMyLocation() },
      ]);
      return;
    }
    setShowCreate(true);
  };

  const isBusy = loading || locationPhase === "loading";
  const mapRegion = coords ? toRegion(coords) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>{t("app.name")}</Text>
          <Text style={styles.title}>{t("squad.nearbyTitle")}</Text>
        </View>
        <TouchableOpacity accessibilityLabel={t("squad.createThisSquad")} onPress={openCreate} style={styles.headerButton}>
          <Plus color={Colors.surface} size={21} />
        </TouchableOpacity>
      </View>

      <SquadSelector />

      <View style={styles.actionsCard}>
        <Text style={styles.actionTitle}>{t("squad.findNearby")}</Text>
        <Text style={styles.actionBody}>{t("squad.locationDisclosure")}</Text>
        <TouchableOpacity
          accessibilityLabel={t("squad.useMyLocationAccessibility")}
          accessibilityRole="button"
          activeOpacity={0.85}
          onPress={() => void handleUseMyLocation()}
          style={styles.locationButton}
        >
          <MapPin color={Colors.surface} size={18} />
          <Text style={styles.locationButtonText}>{t("squad.useMyLocation")}</Text>
        </TouchableOpacity>
        {locationPhase === "permanent" ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{t("squad.openSettings")}</Text>
          </TouchableOpacity>
        ) : null}
        {locationPhase === "denied" || locationPhase === "permanent" ? (
          <Text accessibilityLiveRegion="polite" style={styles.stateText}>{t("squad.permissionDeniedManual")}</Text>
        ) : locationPhase === "unavailable" ? (
          <Text accessibilityLiveRegion="assertive" style={styles.stateText}>{t("squad.locationServicesDisabled")}</Text>
        ) : locationPhase === "error" ? (
          <Text accessibilityLiveRegion="assertive" style={styles.stateText}>{t("squad.locationUnavailable")}</Text>
        ) : null}

        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel={t("squad.searchByVenue")}
            onChangeText={setVenueQuery}
            onSubmitEditing={() => void handleVenueSearch()}
            placeholder={t("squad.searchByVenue")}
            returnKeyType="search"
            style={styles.searchInput}
            value={venueQuery}
          />
          <TouchableOpacity accessibilityLabel={t("squad.searchByVenue")} accessibilityRole="button" onPress={() => void handleVenueSearch()} style={styles.searchButton}>
            <Search color={Colors.surface} size={20} />
          </TouchableOpacity>
        </View>
      </View>

      {mapRegion && searchMode === "nearby" ? (
        <MapView
          accessibilityElementsHidden
          customMapStyle={SIDELINE_MAP_STYLE}
          initialRegion={mapRegion}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          region={mapRegion}
          showsMyLocationButton={false}
          showsUserLocation={false}
          style={styles.map}
          toolbarEnabled={false}
        >
          {nearbySquads.map((squad) => (
            <Marker
              accessibilityLabel={`${squad.venueName}, ${squad.sportDisplayName}`}
              anchor={{ x: 0.5, y: 1 }}
              coordinate={squad.venueLocation}
              key={squad.squadId}
              onPress={() => handleMarkerPress(squad)}
              tracksViewChanges={false}
            >
              <SquadMarker isSelected={selectedMapSquadId === squad.squadId} squad={squad} />
            </Marker>
          ))}
        </MapView>
      ) : null}

      <View style={styles.listHeader}>
        <Text style={styles.listTitle} accessibilityLiveRegion="polite">
          {isBusy ? t("squad.loadingSquads") : t("squad.nearbyCount", { count: nearbySquads.length })}
        </Text>
        {coords && nearbySquads.length === 0 && !isBusy && radiusMiles < 10 ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => void expandSearch()}>
            <Text style={styles.expandText}>{t("squad.expandSearch")}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text accessibilityLiveRegion="assertive" style={styles.errorText}>{t("squad.loadNearbyError")}</Text> : null}
      <FlatList
        ref={listRef}
        contentContainerStyle={styles.list}
        data={nearbySquads}
        keyExtractor={(item) => item.squadId}
        ListEmptyComponent={isBusy ? <ActivityIndicator color={Colors.primary} style={styles.loader} /> : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("squad.noNearbyTitle")}</Text>
            <Text style={styles.emptyBody}>{t("squad.noResultOptions")}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={openCreate} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{t("squad.createThisSquad")}</Text>
            </TouchableOpacity>
          </View>
        )}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item }) => (
          <SquadCard
            isHighlighted={selectedMapSquadId === item.squadId}
            isMember={mySquadIds.includes(item.squadId)}
            joining={joiningId === item.squadId}
            onJoin={() => void handleJoin(item.squadId)}
            onPress={() => router.push({ pathname: "/(social)/squad-detail", params: { squadId: item.squadId } })}
            squad={item}
          />
        )}
        showsVerticalScrollIndicator={false}
      />

      <CreateSquadSheet
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onSquadCreated={(squadId) => router.push({ pathname: "/(social)/squad-detail", params: { squadId } })}
        userCoords={coords}
      />
    </View>
  );
}

function toRegion(coords: Coordinates): Region {
  return { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.04, longitudeDelta: 0.04 };
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.background, flex: 1 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerCopy: { flex: 1 },
  kicker: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 24 },
  headerButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  actionsCard: { backgroundColor: Colors.surface, borderRadius: Radius.card, gap: Spacing.sm, margin: Spacing.md, padding: Spacing.md, ...Shadow.card },
  actionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 },
  actionBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  locationButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  locationButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  secondaryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  secondaryButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  stateText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  searchRow: { flexDirection: "row", gap: Spacing.sm },
  searchInput: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textPrimary, flex: 1, fontFamily: Typography.bodyRegular, minHeight: 46, paddingHorizontal: Spacing.md },
  searchButton: { alignItems: "center", backgroundColor: Colors.textHeading, borderRadius: Radius.button, justifyContent: "center", width: 48 },
  map: { height: 190, marginHorizontal: Spacing.md },
  listHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  listTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  expandText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  errorText: { color: Colors.primary, fontFamily: Typography.bodyRegular, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  list: { flexGrow: 1, paddingBottom: Spacing.xxl, paddingTop: Spacing.xs },
  loader: { marginTop: Spacing.lg },
  empty: { gap: Spacing.sm, margin: Spacing.md, padding: Spacing.lg },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 18, textAlign: "center" },
  emptyBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 20, textAlign: "center" },
});
