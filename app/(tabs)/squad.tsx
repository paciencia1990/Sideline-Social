import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  AppState,
  AppStateStatus,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw } from 'lucide-react-native';

import { Colors, Typography, Spacing, Radius } from '@/constants/theme';
import { SIDELINE_MAP_STYLE } from '@/constants/mapStyle';
import { useSquad } from '@/context/SquadContext';
import { useAuth } from '@/context/AuthContext';
import { Squad } from '@/services/squadService';
import { SquadCard } from '@/components/SquadCard';
import { SquadMarker } from '@/components/SquadMarker';
import { SquadPermissionCard } from '@/components/SquadPermissionCard';
import { CreateSquadSheet } from '@/components/CreateSquadSheet';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = SCREEN_HEIGHT * 0.45;

export default function SquadScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { nearbySquads, mySquadIds, loading, fetchSquads, joinSquad, refreshLastActive } =
    useSquad();

  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'granted' | 'denied'>(
    'unknown'
  );
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<Squad>>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Request location and load squads
  const initLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setPermissionStatus('denied');
      return;
    }
    setPermissionStatus('granted');
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserCoords(coords);
      await fetchSquads(coords.latitude, coords.longitude);
    } catch (err) {
      console.warn('[SquadScreen] location error:', err);
    }
  }, [fetchSquads]);

  useEffect(() => {
    initLocation();
  }, [initLocation]);

  // Update lastActiveAt when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        refreshLastActive();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [refreshLastActive]);

  // Tap a marker → scroll list to that squad
  const handleMarkerPress = useCallback(
    (squad: Squad) => {
      setSelectedSquadId(squad.squadId);
      const idx = nearbySquads.findIndex((s) => s.squadId === squad.squadId);
      if (idx !== -1 && listRef.current) {
        listRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
      }
    },
    [nearbySquads]
  );

  // Tap a squad card → navigate to detail
  const handleSquadPress = useCallback((squad: Squad) => {
    router.push(`/(social)/squad-detail?squadId=${squad.squadId}`);
  }, []);

  // Join a squad
  const handleJoin = useCallback(
    async (squadId: string) => {
      if (!user?.uid) return;
      setJoiningId(squadId);
      try {
        await joinSquad(squadId);
      } catch {
        // error already logged in service
      } finally {
        setJoiningId(null);
      }
    },
    [user, joinSquad]
  );

  // After squad created → navigate to detail
  const handleSquadCreated = useCallback((squadId: string) => {
    router.push(`/(social)/squad-detail?squadId=${squadId}`);
  }, []);

  // Permission denied state
  if (permissionStatus === 'denied') {
    return <SquadPermissionCard onRetry={initLocation} />;
  }

  // Still checking permission
  if (permissionStatus === 'unknown') {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const mapRegion = userCoords
    ? {
        latitude: userCoords.latitude,
        longitude: userCoords.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }
    : undefined;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── MAP (top 45%) ── */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          customMapStyle={SIDELINE_MAP_STYLE}
          region={mapRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          moveOnMarkerPress={false}
        >
          {/* "You Are Here" dot */}
          {userCoords && (
            <Circle
              center={userCoords}
              radius={12}
              fillColor={Colors.textHeading}
              strokeColor={Colors.surface}
              strokeWidth={2}
              zIndex={10}
            />
          )}

          {/* Squad markers */}
          {nearbySquads.map((squad) => (
            <Marker
              key={squad.squadId}
              coordinate={squad.venueLocation}
              onPress={() => handleMarkerPress(squad)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 1 }}
            >
              <SquadMarker
                squad={squad}
                isSelected={selectedSquadId === squad.squadId}
              />
            </Marker>
          ))}
        </MapView>

        {/* Recenter button */}
        {userCoords && (
          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={() => {
              mapRef.current?.animateToRegion(
                { ...userCoords, latitudeDelta: 0.04, longitudeDelta: 0.04 },
                400
              );
            }}
            activeOpacity={0.8}
          >
            <RefreshCw size={16} color={Colors.textHeading} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── SQUAD LIST (bottom 55%) ── */}
      <View style={styles.listContainer}>
        {/* Section header */}
        <View style={styles.listHeader}>
          <Text style={styles.listHeaderText}>
            {loading
              ? t('squad.loadingSquads')
              : t('squad.nearbyCount', { count: nearbySquads.length })}
          </Text>
          {loading && <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 8 }} />}
        </View>

        {/* Squad cards */}
        <FlatList
          ref={listRef}
          data={nearbySquads}
          keyExtractor={(item) => item.squadId}
          renderItem={({ item }) => (
            <SquadCard
              squad={item}
              isMember={mySquadIds.includes(item.squadId)}
              isHighlighted={selectedSquadId === item.squadId}
              onJoin={() => handleJoin(item.squadId)}
              onPress={() => handleSquadPress(item)}
              joining={joiningId === item.squadId}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={() => {}}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{t('squad.noSquads')}</Text>
              </View>
            ) : null
          }
        />
      </View>

      {/* ── FAB ── */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + Spacing.lg }]}
        onPress={() => setShowCreateSheet(true)}
        activeOpacity={0.85}
      >
        <Plus size={26} color="#FFFFFF" />
      </TouchableOpacity>

      {/* ── Create Squad Sheet ── */}
      <CreateSquadSheet
        isOpen={showCreateSheet}
        onClose={() => setShowCreateSheet(false)}
        userCoords={userCoords}
        onSquadCreated={handleSquadCreated}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  mapContainer: {
    height: MAP_HEIGHT,
    width: '100%',
    overflow: 'hidden',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  recenterBtn: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  listContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.secondary,
    backgroundColor: Colors.background,
  },
  listHeaderText: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.textHeading,
  },
  listContent: {
    paddingVertical: Spacing.sm,
    paddingBottom: Spacing.xl + 60, // space for FAB
  },
  empty: {
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 20,
  },
});