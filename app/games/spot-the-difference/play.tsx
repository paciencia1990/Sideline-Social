import SpotDifferenceScreen from "@/src/game/spotDifference/SpotDifferenceScreen";
import SynchronizedGameStartGate from "@/components/SynchronizedGameStartGate";

export default function SpotDifferencePlayRoute() {
  return (
    <SynchronizedGameStartGate gameType="spotTheDifferences">
      <SpotDifferenceScreen />
    </SynchronizedGameStartGate>
  );
}
